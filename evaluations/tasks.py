"""Background work owned by the evaluations app: the two scoring passes.

The seam between Django and the hosted model, mirroring ``interviews.tasks``:

    one answer                     ->  Gemini  ->  AnswerEvaluation row
    every evaluation in a session  ->  Gemini  ->  SessionReport row
"""

import logging

from celery import shared_task

from agents import AgentError
from agents.evaluator import build_report, evaluate_answer

logger = logging.getLogger(__name__)


@shared_task
def run_answer_evaluation(evaluation_id):
    """Score the one answer belonging to ``AnswerEvaluation`` ``evaluation_id``.

    Pass one. Dispatched the moment an answer is submitted, because the candidate is
    watching the screen and feedback is worth most while they still remember what
    they wrote.
    """
    from .models import AnswerEvaluation

    try:
        evaluation = AnswerEvaluation.objects.select_related(
            "answer__question__session__job_description"
        ).get(pk=evaluation_id)
    except AnswerEvaluation.DoesNotExist:
        logger.warning("AnswerEvaluation %s vanished before its task ran", evaluation_id)
        return None

    if evaluation.is_terminal:
        logger.info(
            "AnswerEvaluation %s is already %s; skipping", evaluation_id, evaluation.status
        )
        return evaluation.status

    answer = evaluation.answer
    question = answer.question
    role = question.session.job_description

    try:
        result = evaluate_answer(
            question.text,
            answer.text,
            focus=question.focus,
            job_title=role.title,
            company=role.company,
        )
    except AgentError as exc:
        logger.warning("AnswerEvaluation %s failed: %s", evaluation_id, exc)
        evaluation.mark_failed(exc)
        return evaluation.status
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("AnswerEvaluation %s crashed", evaluation_id)
        evaluation.mark_failed(f"Unexpected error: {exc}")
        return evaluation.status

    evaluation.mark_complete(result)
    logger.info("AnswerEvaluation %s complete, score %s", evaluation_id, evaluation.score)
    return evaluation.status


@shared_task
def run_report_build(report_id):
    """Write the debrief for ``SessionReport`` ``report_id``.

    Pass two. Reads the *pass-one results* rather than the answers themselves - see
    ``agents/evaluator.py`` - so the report cannot contradict the per-answer
    feedback the candidate has already read.

    Answers whose own evaluation failed or is still running are skipped rather than
    waited for. A report over seven of eight answers is worth having; blocking on a
    single answer that Gemini refused would deny the candidate all of it.
    """
    from .models import AnswerEvaluation, SessionReport

    try:
        report = SessionReport.objects.select_related("session__job_description").get(pk=report_id)
    except SessionReport.DoesNotExist:
        logger.warning("SessionReport %s vanished before its task ran", report_id)
        return None

    if report.is_terminal:
        logger.info("SessionReport %s is already %s; skipping", report_id, report.status)
        return report.status

    session = report.session
    evaluations = (
        AnswerEvaluation.objects.filter(
            answer__question__session=session, status=AnswerEvaluation.Status.COMPLETE
        )
        .select_related("answer__question")
        .order_by("answer__question__order")
    )

    scored_answers = [
        {
            "question": evaluation.answer.question.text,
            "category": evaluation.answer.question.category,
            "score": evaluation.score,
            "verdict": evaluation.verdict,
            "improvements": evaluation.improvements,
        }
        for evaluation in evaluations
    ]

    if not scored_answers:
        # Not an agent failure, but still terminal: something has to stop the client
        # polling, and this message is actionable where a generic one would not be.
        report.mark_failed(
            "None of your answers have been scored yet, so there is nothing to report on. "
            "Answer at least one question and wait for its feedback."
        )
        return report.status

    role = session.job_description
    try:
        result = build_report(scored_answers, job_title=role.title, company=role.company)
    except AgentError as exc:
        logger.warning("SessionReport %s failed: %s", report_id, exc)
        report.mark_failed(exc)
        return report.status
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("SessionReport %s crashed", report_id)
        report.mark_failed(f"Unexpected error: {exc}")
        return report.status

    report.mark_complete(result, answers_covered=len(scored_answers))
    logger.info("SessionReport %s complete, overall %s", report_id, report.overall_score)
    return report.status
