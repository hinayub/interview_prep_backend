"""The interview question agent. Runs on the local model.

One public function, ``generate_questions``. Generation from documents already in
hand is what a 3B model is genuinely good at, and a rehearsal is worth nothing if
every run costs an API call, so this stays local. Judging the answers does not -
see ``agents/evaluator.py``.

The questions are asked in a fixed shape rather than left to the model's mood:

    resume + posting + the gaps the matcher already found  ->  Llama 3  ->  8 questions

Feeding the matcher's ``missing_skills`` back in is what makes this a rehearsal
for *this* application rather than a generic question bank. A gap the matcher
found is precisely what a real interviewer will probe.
"""

import logging

from django.conf import settings

from . import AgentError
from .ollama_client import call_llama
from .text import collapse, truncate

logger = logging.getLogger(__name__)

# The mix is prescribed, not requested, because a small model left to choose will
# write eight variations of "tell me about yourself". Each category earns its slot:
#
#   technical   - can they do the job's core work
#   experience  - is the resume's claim real, in their own words
#   behavioural - how they work with people, which the resume cannot show
#   gap         - the missing skills, asked directly, because the real interview will
CATEGORIES = ("technical", "experience", "behavioural", "gap")

CATEGORY_LABELS = {
    "technical": "Technical",
    "experience": "Experience",
    "behavioural": "Behavioural",
    "gap": "Gap",
}

QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "category": {"type": "string", "enum": list(CATEGORIES)},
                    "focus": {"type": "string"},
                },
                "required": ["text", "category", "focus"],
            },
        }
    },
    "required": ["questions"],
}

SYSTEM_PROMPT = (
    "You are an experienced technical interviewer preparing to interview a "
    "specific candidate for a specific role. You ask questions grounded in what "
    "the resume and the job description actually say - you name their real "
    "projects and the role's real requirements. You never ask a question that "
    "could be asked of any candidate for any job. Reply with JSON only."
)

PROMPT_TEMPLATE = """Write {count} interview questions for this candidate and this role.

=== JOB DESCRIPTION ===
{jd_text}

=== RESUME ===
{resume_text}
{gaps_block}
=== TASK ===
Return a JSON object with one key, "questions": an array of exactly {count}
objects, each with:
- "text": the question, asked directly to the candidate as "you". One question,
    not two joined by "and". No preamble.
- "category": one of "technical", "experience", "behavioural", "gap".
- "focus": 2-6 words naming what the question is testing ("Celery retry
    semantics", "handling a missed deadline"). This is a label, not a sentence.

Use this mix, in this order:
{plan}

Rules:
- Name specifics from the documents above. "You migrated Acme's monolith to
    Celery - what broke first?" is right. "Describe a challenging project" is wrong.
- A "gap" question asks how they would handle a requirement their resume does not
    evidence. Ask it plainly and without judgement; do not imply they lied.
- Do not ask anything answerable from the resume alone. The point is what the
    resume does not already say."""

GAPS_TEMPLATE = """
=== REQUIREMENTS THE RESUME DOES NOT EVIDENCE ===
{gaps}
"""

# What a run must produce to be usable. Fewer than this is not an interview, and a
# model that returns three questions has misread the task rather than been concise.
MIN_QUESTIONS = 4

# Focus labels are asked for as 2-6 words; this is the hard stop for a model that
# writes a sentence anyway, cutting on a word boundary.
MAX_FOCUS_CHARS = 60


def _plan(count):
    """The category for each slot, as a numbered list the model can follow.

    Cycling the categories rather than blocking them (four technical, then four
    behavioural) keeps the rehearsal varied in the order it is actually taken,
    since the candidate answers these one at a time and in order.
    """
    return "\n".join(
        f"{index + 1}. {CATEGORY_LABELS[CATEGORIES[index % len(CATEGORIES)]]}"
        for index in range(count)
    )


def _trim_focus(value):
    """Shorten an over-long focus label without cutting a word in half."""
    label = collapse(value).strip(" .,;-")
    if len(label) <= MAX_FOCUS_CHARS:
        return label

    head = label[:MAX_FOCUS_CHARS]
    cut = head.rfind(" ")
    return (head[:cut] if cut > 0 else head).rstrip(" ,;-")


def build_prompt(resume_text, jd_text, missing_skills=(), count=None):
    """Exposed separately so prompt changes are testable without an LLM."""
    count = count or settings.INTERVIEW_QUESTION_COUNT

    # Only ever advisory: an empty list (no matcher run yet, or a resume that
    # covered everything) just means the block is absent and the model works from
    # the two documents alone.
    gaps = ", ".join(collapse(skill) for skill in missing_skills if collapse(skill))
    gaps_block = GAPS_TEMPLATE.format(gaps=gaps) if gaps else ""

    return PROMPT_TEMPLATE.format(
        count=count,
        jd_text=truncate(jd_text, settings.AGENT_MAX_JD_CHARS, "job description"),
        resume_text=truncate(resume_text, settings.AGENT_MAX_RESUME_CHARS, "resume"),
        gaps_block=gaps_block,
        plan=_plan(count),
    )


def _clean(questions, count):
    """Drop unusable questions, de-duplicate, and cap at the requested count.

    A small model asked for eight questions will sometimes return seven good ones
    and a repeat of the third. Silently dropping the repeat gives the candidate a
    shorter but honest interview, which beats making them answer it twice.
    """
    seen, cleaned = set(), []
    for raw in questions:
        text = collapse(raw.get("text"))
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())

        category = raw.get("category")
        cleaned.append(
            {
                "text": text,
                # The schema's enum makes a bad category unlikely, not impossible -
                # and a question with a wrong label is still worth answering, so
                # this falls back rather than dropping it.
                "category": category if category in CATEGORIES else "technical",
                "focus": _trim_focus(raw.get("focus")),
            }
        )

    return cleaned[:count]


def generate_questions(resume_text, jd_text, missing_skills=(), count=None):
    """Write interview questions for one resume against one posting.

    Returns a list of ``{"text": str, "category": str, "focus": str}`` in the order
    they should be asked. Raises ``AgentError`` if the model could not produce a
    usable set.
    """
    if not (resume_text or "").strip():
        raise AgentError("Cannot write questions without a resume.")
    if not (jd_text or "").strip():
        raise AgentError("Cannot write questions without a job description.")

    count = count or settings.INTERVIEW_QUESTION_COUNT

    result = call_llama(
        build_prompt(resume_text, jd_text, missing_skills, count),
        QUESTION_SCHEMA,
        system=SYSTEM_PROMPT,
        # Higher than the matcher's 0.2: eight questions at near-zero temperature
        # come out as eight rewordings of the same one. Scoring wants determinism,
        # generation wants range.
        temperature=0.7,
    )

    questions = _clean(result["questions"], count)
    if len(questions) < MIN_QUESTIONS:
        raise AgentError(
            f"The model returned only {len(questions)} usable question(s). Try again."
        )

    logger.info("Generated %d interview questions", len(questions))
    return questions
