"""The scoring agents. These prefer the hosted model.

Two public functions, and the split between them is the two-pass design the
package docstring promises:

    evaluate_answer(question, answer)  ->  one answer scored, immediately
    build_report(session_summary)      ->  the whole rehearsal, once at the end

Pass one runs per answer, as soon as it is submitted, so feedback arrives while
the candidate still remembers what they said. Pass two reads only the *scores and
notes from pass one*, never the raw answers again - which keeps the final prompt
small and, more importantly, makes the report agree with the per-answer feedback
the candidate already read instead of re-judging from scratch and contradicting it.

Both prefer the hosted model because this is the judgement the product is
ultimately selling. A 3B model can write a question; telling someone their answer
was evasive, and why, is a different job.

Both are still raced (see ``agents/race.py``), and that matters most here: this is
the one place the app used to stop dead without a ``GEMINI_API_KEY``. Llama now
takes the lane when the hosted model is unconfigured, blocked or retired, and the
row records which model scored the answer so a candidate is never shown a number
without being told who wrote it.
"""

import logging

from django.conf import settings

from . import AgentError
from .race import GEMINI, call_race
from .text import clean_list, collapse, truncate

logger = logging.getLogger(__name__)

# --- pass one: a single answer ------------------------------------------------

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer", "minimum": 0, "maximum": 100},
        "verdict": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "improvements": {"type": "array", "items": {"type": "string"}},
        "model_answer": {"type": "string"},
    },
    "required": ["score", "verdict", "strengths", "improvements", "model_answer"],
}

ANSWER_SYSTEM_PROMPT = (
    "You are a senior engineer giving a candidate honest feedback on one "
    "interview answer, in private, so they can do better in the real interview. "
    "You are specific and you are kind, but you do not inflate. A vague answer is "
    "told it was vague. You judge only the answer given - never the person, never "
    "their resume. Reply with JSON only."
)

ANSWER_PROMPT_TEMPLATE = """Score this one interview answer.

=== THE ROLE ===
{role}

=== THE QUESTION ===
{question}
(This question was testing: {focus})

=== THEIR ANSWER ===
{answer}

=== TASK ===
Return a JSON object with exactly these keys:
- "score": integer 0-100 for this answer alone.
    0-39 does not answer the question, or is too vague to assess.
    40-69 answers it, but is missing specifics, structure or depth.
    70-100 a strong answer an interviewer would be satisfied by.
- "verdict": 1-2 sentences addressed to them as "you", saying what this answer
    did and did not do. Lead with the single most useful observation.
- "strengths": array of what the answer genuinely did well. Each item a short
    phrase, not a sentence. Empty array if there is nothing honest to put here -
    do not invent one.
- "improvements": array of specific, actionable changes. "Name the actual
    database and the actual row count" - not "add more detail".
- "model_answer": 3-5 sentences showing how a strong candidate would answer this
    same question, using only facts the candidate themselves gave above. Where
    they gave no specifics, write [your number here] rather than inventing one.

Judge the substance, not the grammar. This was spoken practice, not an essay."""

MAX_POINTS = 6

# --- pass two: the whole rehearsal -------------------------------------------

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "overall_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "headline": {"type": "string"},
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "priorities": {"type": "array", "items": {"type": "string"}},
        "readiness": {
            "type": "string",
            "enum": ["not ready", "nearly ready", "ready"],
        },
    },
    "required": [
        "overall_score",
        "headline",
        "summary",
        "strengths",
        "priorities",
        "readiness",
    ],
}

REPORT_SYSTEM_PROMPT = (
    "You are writing the debrief a candidate takes away from a practice "
    "interview. You have already given them feedback on each answer; this is "
    "where you tell them what it adds up to and what to work on first. You are "
    "direct about whether they are ready. Reply with JSON only."
)

REPORT_PROMPT_TEMPLATE = """Write the debrief for this practice interview.

=== THE ROLE ===
{role}

=== WHAT THEY WERE ASKED, AND HOW EACH ANSWER SCORED ===
{answers_block}

=== TASK ===
Return a JSON object with exactly these keys:
- "overall_score": integer 0-100 for the interview as a whole. The average of the
    answer scores is your starting point, but you may depart from it - say so in
    the summary if you do. An interview with one catastrophic answer is worse than
    its average suggests.
- "headline": one short sentence, under 12 words, naming the single most important
    thing they should take away.
- "summary": 3-5 sentences addressed to them as "you". What pattern runs through
    these answers? Name it, and point at the specific questions that show it.
- "strengths": array of what they can rely on in the real interview. Short phrases.
- "priorities": array of what to work on, hardest-hitting first. Each item names
    what to do, not just what was wrong.
- "readiness": "not ready", "nearly ready" or "ready" for the real interview.

Base this only on the answers above. Do not introduce a weakness that none of the
per-answer feedback mentioned - they have already read that feedback, and this
must agree with it."""

# One line per question in the pass-two prompt. Deliberately carries the *notes*
# rather than the answer text: see the module docstring.
ANSWER_LINE_TEMPLATE = """{index}. [{category}] {question}
   scored {score}/100 - {verdict}
   they should improve: {improvements}"""


def _role_line(job_title, company):
    """Name the role the way the rest of the app does."""
    role = collapse(job_title) or "the role"
    company = collapse(company)
    return f"{role} at {company}" if company else role


def build_answer_prompt(question_text, answer_text, *, focus="", job_title="", company=""):
    """Exposed separately so prompt changes are testable without an LLM."""
    return ANSWER_PROMPT_TEMPLATE.format(
        role=_role_line(job_title, company),
        question=collapse(question_text),
        focus=collapse(focus) or "not recorded",
        answer=truncate(answer_text, settings.AGENT_MAX_ANSWER_CHARS, "answer"),
    )


def evaluate_answer(question_text, answer_text, *, focus="", job_title="", company=""):
    """Score one answer to one question.

    Returns ``{"score": int, "verdict": str, "strengths": [str],
    "improvements": [str], "model_answer": str, "model_used": str,
    "race_note": str}``. Raises ``AgentError`` only if neither model could produce
    a usable judgement.
    """
    if not collapse(question_text):
        raise AgentError("Cannot evaluate an answer without the question.")
    if not collapse(answer_text):
        # Guarded here as well as at the serializer: an empty answer would get a
        # confident zero and a hallucinated critique of nothing.
        raise AgentError("Cannot evaluate an empty answer.")

    race = call_race(
        build_answer_prompt(
            question_text, answer_text, focus=focus, job_title=job_title, company=company
        ),
        ANSWER_SCHEMA,
        system=ANSWER_SYSTEM_PROMPT,
        # Low: two candidates who gave the same answer should get the same score.
        temperature=0.2,
        prefer=GEMINI,
    )
    result = race.data

    return {
        "score": result["score"],
        "verdict": collapse(result["verdict"]),
        "strengths": clean_list(result["strengths"], MAX_POINTS),
        "improvements": clean_list(result["improvements"], MAX_POINTS),
        "model_answer": collapse(result["model_answer"]),
        "model_used": race.winner,
        "race_note": race.note,
    }


def build_report_prompt(scored_answers, *, job_title="", company=""):
    """Render the pass-two prompt from pass-one results."""
    lines = []
    for index, entry in enumerate(scored_answers, start=1):
        improvements = "; ".join(entry.get("improvements") or ()) or "nothing recorded"
        lines.append(
            ANSWER_LINE_TEMPLATE.format(
                index=index,
                category=entry.get("category") or "general",
                question=collapse(entry.get("question")),
                score=entry.get("score"),
                verdict=collapse(entry.get("verdict")),
                improvements=collapse(improvements),
            )
        )

    return REPORT_PROMPT_TEMPLATE.format(
        role=_role_line(job_title, company), answers_block="\n\n".join(lines)
    )


def build_report(scored_answers, *, job_title="", company=""):
    """Summarise a finished rehearsal into the report the candidate takes away.

    ``scored_answers`` is one dict per evaluated answer, in the order they were
    asked, each with ``question``, ``category``, ``score``, ``verdict`` and
    ``improvements`` - that is, the output of pass one joined to its question.

    Returns ``{"overall_score": int, "headline": str, "summary": str,
    "strengths": [str], "priorities": [str], "readiness": str, "model_used": str,
    "race_note": str}``.
    """
    if not scored_answers:
        raise AgentError("There are no evaluated answers to report on yet.")

    race = call_race(
        build_report_prompt(scored_answers, job_title=job_title, company=company),
        REPORT_SCHEMA,
        system=REPORT_SYSTEM_PROMPT,
        temperature=0.3,
        prefer=GEMINI,
    )
    result = race.data

    logger.info(
        "Built report over %d answers via %s, overall %s",
        len(scored_answers),
        race.winner,
        result["overall_score"],
    )
    return {
        "overall_score": result["overall_score"],
        "headline": collapse(result["headline"]),
        "summary": collapse(result["summary"]),
        "strengths": clean_list(result["strengths"], MAX_POINTS),
        "priorities": clean_list(result["priorities"], MAX_POINTS),
        "readiness": result["readiness"],
        "model_used": race.winner,
        "race_note": race.note,
    }
