"""The resume-vs-job-description matching agent.

One public function, ``analyze_match``. It owns the prompt, the response schema
and the tidying of whatever the model hands back, so the Django task that calls
it stays a five-line "load row, call agent, save row".
"""

import logging

from django.conf import settings

from . import AgentError
from .ollama_client import call_llama
from .text import clean_list, collapse, truncate

logger = logging.getLogger(__name__)

MATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "match_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "reasoning": {"type": "string"},
        "matched_skills": {"type": "array", "items": {"type": "string"}},
        "missing_skills": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["match_score", "reasoning", "matched_skills", "missing_skills"],
}

SYSTEM_PROMPT = (
    "You are a precise technical recruiter. You compare a candidate's resume "
    "against a job description and report only what the documents actually say. "
    "Never invent skills or experience that do not appear in the resume. "
    "Reply with JSON only."
)

PROMPT_TEMPLATE = """Compare this resume against this job description.

=== JOB DESCRIPTION ===
{jd_text}

=== RESUME ===
{resume_text}

=== TASK ===
Return a JSON object with exactly these keys:
- "match_score": integer 0-100. How well the resume fits this role.
    0-39 weak, 40-69 partial, 70-100 strong.
- "reasoning": 2-4 sentences, addressed to the candidate as "you", explaining
    the score by pointing at specific requirements and specific resume content.
- "matched_skills": array of skills the job asks for that the resume evidences.
- "missing_skills": array of skills the job asks for that the resume does not
    evidence. Empty array if none.

Use short skill names ("PostgreSQL", "Kubernetes"), not sentences. Judge only
what is written above."""

# Skills lists longer than this are the model padding rather than finding, and
# the UI has nowhere to put them.
MAX_SKILLS = 15


def build_prompt(resume_text, jd_text):
    """Exposed separately so prompt changes are testable without an LLM."""
    return PROMPT_TEMPLATE.format(
        jd_text=truncate(jd_text, settings.AGENT_MAX_JD_CHARS, "job description"),
        resume_text=truncate(resume_text, settings.AGENT_MAX_RESUME_CHARS, "resume"),
    )


def analyze_match(resume_text, jd_text):
    """Score ``resume_text`` against ``jd_text``.

    Returns ``{"match_score": int, "reasoning": str, "matched_skills": [str],
    "missing_skills": [str]}``. Raises ``AgentError`` if the model could not
    produce a usable answer.
    """
    if not (resume_text or "").strip():
        raise AgentError("Cannot analyse an empty resume.")
    if not (jd_text or "").strip():
        raise AgentError("Cannot analyse an empty job description.")

    result = call_llama(
        build_prompt(resume_text, jd_text), MATCH_SCHEMA, system=SYSTEM_PROMPT
    )

    return {
        "match_score": result["match_score"],
        "reasoning": collapse(result["reasoning"]),
        "matched_skills": clean_list(result["matched_skills"], MAX_SKILLS),
        "missing_skills": clean_list(result["missing_skills"], MAX_SKILLS),
    }
