"""Background work owned by the interviews app: writing the questions.

Same seam as ``resumes.tasks`` - the only module that knows both that
``InterviewSession`` is a table and that ``generate_questions`` is an LLM call.

    resume text + JD text + the matcher's gaps  ->  Llama 3  ->  Question rows

"Llama 3" there is the preference, not a guarantee: the prompt goes to both
backends and the local one wins unless it fails (see ``agents/race.py``). Which
model actually wrote a session's questions is recorded on the row.
"""

import logging

from celery import shared_task

from agents import AgentError
from agents.question_generator import generate_questions

logger = logging.getLogger(__name__)


@shared_task
def run_question_generation(session_id):
    """Fill in the pending ``InterviewSession`` with id ``session_id``.

    Takes an id, not an instance, for the same reasons as ``run_match_analysis``:
    the argument must survive JSON serialisation under Celery, and re-reading gives
    the task the row as it is now.

    Never raises for an agent failure - the failure is the result, recorded on the
    row so the polling endpoint can report it.
    """
    # Imported here, not at module scope: Celery's autodiscovery imports tasks
    # modules early, and a top-level model import can run before the app registry
    # is ready.
    from .models import InterviewSession

    try:
        session = InterviewSession.objects.select_related(
            "resume", "job_description", "match_analysis"
        ).get(pk=session_id)
    except InterviewSession.DoesNotExist:
        logger.warning("InterviewSession %s vanished before its task ran", session_id)
        return None

    if session.is_terminal:
        # A duplicate dispatch must not write a second question set into a session
        # the candidate may already be answering.
        logger.info("InterviewSession %s is already %s; skipping", session_id, session.status)
        return session.status

    # Only a *finished* analysis has gaps worth feeding in. A pending or failed one
    # is not an error here - the questions are simply written from the two documents
    # alone, which is what happens when no analysis was linked at all.
    analysis = session.match_analysis
    missing_skills = (
        analysis.missing_skills
        if analysis and analysis.status == analysis.Status.COMPLETE
        else []
    )

    try:
        result = generate_questions(
            session.resume.parsed_text,
            session.job_description.raw_text,
            missing_skills=missing_skills,
        )
    except AgentError as exc:
        logger.warning("InterviewSession %s failed: %s", session_id, exc)
        session.mark_failed(exc)
        return session.status
    except Exception as exc:  # pragma: no cover - defensive
        # A bug in the agent layer must still leave the row terminal, or the
        # frontend polls "pending" forever.
        logger.exception("InterviewSession %s crashed", session_id)
        session.mark_failed(f"Unexpected error: {exc}")
        return session.status

    questions = result["questions"]
    session.mark_complete(questions, result)
    logger.info(
        "InterviewSession %s ready with %d questions from %s",
        session_id,
        len(questions),
        result.get("model_used") or "an unrecorded model",
    )
    return session.status
