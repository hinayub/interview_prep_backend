"""Background work owned by the resumes app.

This module is the seam between Django and the agents package: it is the only
thing that knows both that ``MatchAnalysis`` is a table and that
``analyze_match`` is an LLM call. ``agents/`` stays model-free, views stay
LLM-free.

The pipeline is three steps, and step two is the only one that can be slow or
flaky:

    already-extracted resume text + JD text  ->  Llama 3  ->  MatchAnalysis row
"""

import logging

from celery import shared_task

from agents import AgentError
from agents.resume_analyzer import analyze_match

logger = logging.getLogger(__name__)


@shared_task
def run_match_analysis(analysis_id):
    """Fill in the pending ``MatchAnalysis`` with id ``analysis_id``.

    Takes an id, not an instance: under Celery the argument has to survive JSON
    serialisation, and re-reading gives the task the row as it is *now* rather
    than as it was when the request thread built it.

    Never raises for an agent failure - the failure is the result, recorded on
    the row so the polling endpoint can report it. Only a genuinely missing row
    is allowed to propagate, since there is nowhere to write that down.
    """
    # Imported here rather than at module scope: Celery's autodiscovery imports
    # tasks modules early, and a top-level model import can run before the app
    # registry is ready.
    from .models import MatchAnalysis

    try:
        analysis = MatchAnalysis.objects.select_related("resume", "job_description").get(
            pk=analysis_id
        )
    except MatchAnalysis.DoesNotExist:
        logger.warning("MatchAnalysis %s vanished before its task ran", analysis_id)
        return None

    if analysis.is_terminal:
        # A duplicate dispatch (thread runner plus a manual retry, say) must not
        # overwrite a finished result with a second, different one.
        logger.info("MatchAnalysis %s is already %s; skipping", analysis_id, analysis.status)
        return analysis.status

    try:
        result = analyze_match(analysis.resume.parsed_text, analysis.job_description.raw_text)
    except AgentError as exc:
        logger.warning("MatchAnalysis %s failed: %s", analysis_id, exc)
        analysis.mark_failed(exc)
        return analysis.status
    except Exception as exc:  # pragma: no cover - defensive
        # A bug in the agent layer must still leave the row terminal, or the
        # frontend polls "pending" forever.
        logger.exception("MatchAnalysis %s crashed", analysis_id)
        analysis.mark_failed(f"Unexpected error: {exc}")
        return analysis.status

    analysis.mark_complete(result)
    logger.info("MatchAnalysis %s complete, score %s", analysis_id, analysis.match_score)
    return analysis.status
