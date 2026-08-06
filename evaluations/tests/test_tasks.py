"""The two scoring passes, from the task side.

Same never-raise contract as question generation. The interesting behaviour unique
to this file is what the report does about answers that are not scored: it skips
them rather than waiting, because a report over seven of eight answers beats
denying the candidate all of it.
"""

import pytest

from agents import AgentError
from conftest import ANSWER_EVALUATION
from evaluations.models import AnswerEvaluation, SessionReport
from evaluations.tasks import run_answer_evaluation, run_report_build
from interviews.models import Answer

pytestmark = pytest.mark.django_db


@pytest.fixture
def evaluation(open_session):
    """A submitted answer with a pending evaluation, as the endpoint would leave it."""
    answer = Answer.objects.create(
        question=open_session.questions.first(),
        text="Task idempotency broke first. We were retrying non-idempotent tasks.",
    )
    return AnswerEvaluation.objects.create(answer=answer)


# --- pass one -----------------------------------------------------------------


def test_a_successful_run_fills_in_the_evaluation(evaluation, stub_answer_evaluator):
    run_answer_evaluation(evaluation.pk)
    evaluation.refresh_from_db()

    assert evaluation.status == AnswerEvaluation.Status.COMPLETE
    assert evaluation.score == ANSWER_EVALUATION["score"]
    assert evaluation.model_answer == ANSWER_EVALUATION["model_answer"]


def test_the_question_its_focus_and_the_role_all_reach_the_agent(
    evaluation, stub_answer_evaluator
):
    """Scoring an answer without the question it answered is not scoring."""
    run_answer_evaluation(evaluation.pk)

    question_text, answer_text = stub_answer_evaluator.call_args.args
    kwargs = stub_answer_evaluator.call_args.kwargs

    assert question_text == evaluation.answer.question.text
    assert answer_text == evaluation.answer.text
    assert kwargs["focus"] == evaluation.answer.question.focus
    assert kwargs["job_title"] == evaluation.answer.question.session.job_description.title


def test_an_answer_scored_by_the_standby_records_that_it_was(evaluation, mocker):
    """Scoring used to die outright without a key. Now it degrades and says so."""
    mocker.patch(
        "evaluations.tasks.evaluate_answer",
        return_value={
            **ANSWER_EVALUATION,
            "model_used": "llama",
            "race_note": "Gemini (hosted) failed, so Llama 3 (local) answered instead.",
        },
    )

    assert run_answer_evaluation(evaluation.pk) == AnswerEvaluation.Status.COMPLETE

    evaluation.refresh_from_db()
    assert evaluation.score == ANSWER_EVALUATION["score"]
    assert evaluation.model_used == "llama"
    assert "Gemini (hosted) failed" in evaluation.race_note


def test_rescoring_clears_the_previous_attribution(evaluation, mocker):
    """The re-run races again and may land elsewhere, so last run's badge must go."""
    evaluation.mark_complete({**ANSWER_EVALUATION, "model_used": "llama"})

    evaluation.reset()
    evaluation.refresh_from_db()

    assert evaluation.model_used == ""
    assert evaluation.race_note == ""


def test_an_agent_failure_is_recorded_not_raised(evaluation, mocker):
    mocker.patch(
        "evaluations.tasks.evaluate_answer", side_effect=AgentError("No Gemini API key")
    )

    assert run_answer_evaluation(evaluation.pk) == AnswerEvaluation.Status.FAILED

    evaluation.refresh_from_db()
    assert "No Gemini API key" in evaluation.error_message


def test_an_unexpected_crash_still_leaves_the_row_terminal(evaluation, mocker):
    mocker.patch("evaluations.tasks.evaluate_answer", side_effect=TypeError("boom"))

    run_answer_evaluation(evaluation.pk)
    evaluation.refresh_from_db()

    assert evaluation.status == AnswerEvaluation.Status.FAILED
    assert "Unexpected error" in evaluation.error_message


def test_a_missing_row_is_logged_not_raised(stub_answer_evaluator):
    assert run_answer_evaluation(999999) is None
    stub_answer_evaluator.assert_not_called()


def test_a_duplicate_dispatch_does_not_rescore(evaluation, stub_answer_evaluator):
    evaluation.mark_complete(dict(ANSWER_EVALUATION))

    run_answer_evaluation(evaluation.pk)

    stub_answer_evaluator.assert_not_called()


# --- pass two -----------------------------------------------------------------


def test_a_successful_run_fills_in_the_report(answered_session, stub_report_builder):
    report = SessionReport.objects.create(session=answered_session)

    run_report_build(report.pk)
    report.refresh_from_db()

    assert report.status == SessionReport.Status.COMPLETE
    assert report.overall_score == 68
    assert report.readiness == "nearly ready"


def test_the_report_records_how_many_answers_it_covered(answered_session, stub_report_builder):
    report = SessionReport.objects.create(session=answered_session)

    run_report_build(report.pk)
    report.refresh_from_db()

    assert report.answers_covered == answered_session.questions.count()


def test_the_report_reads_pass_one_notes_in_question_order(
    answered_session, stub_report_builder
):
    report = SessionReport.objects.create(session=answered_session)

    run_report_build(report.pk)

    scored = stub_report_builder.call_args.args[0]
    assert [entry["question"] for entry in scored] == [
        question.text for question in answered_session.questions.all()
    ]
    assert all("score" in entry and "verdict" in entry for entry in scored)


def test_an_unscored_answer_is_skipped_rather_than_waited_for(
    answered_session, stub_report_builder
):
    """Blocking on one refused answer would deny the candidate the whole report."""
    stranded = AnswerEvaluation.objects.first()
    stranded.status = AnswerEvaluation.Status.PENDING
    stranded.save(update_fields=["status"])

    report = SessionReport.objects.create(session=answered_session)
    run_report_build(report.pk)
    report.refresh_from_db()

    assert report.status == SessionReport.Status.COMPLETE
    assert report.answers_covered == answered_session.questions.count() - 1


def test_a_failed_evaluation_is_left_out_of_the_report(answered_session, stub_report_builder):
    failed = AnswerEvaluation.objects.first()
    failed.mark_failed("Gemini declined")

    report = SessionReport.objects.create(session=answered_session)
    run_report_build(report.pk)

    scored = stub_report_builder.call_args.args[0]
    assert len(scored) == answered_session.questions.count() - 1


def test_nothing_scored_yet_fails_with_something_actionable(open_session, stub_report_builder):
    """Terminal, so the client stops polling, and it says what to do about it."""
    report = SessionReport.objects.create(session=open_session)

    run_report_build(report.pk)
    report.refresh_from_db()

    assert report.status == SessionReport.Status.FAILED
    assert "Answer at least one question" in report.error_message
    stub_report_builder.assert_not_called()


def test_an_agent_failure_is_recorded_not_raised(answered_session, mocker):
    mocker.patch("evaluations.tasks.build_report", side_effect=AgentError("Gemini is down"))
    report = SessionReport.objects.create(session=answered_session)

    assert run_report_build(report.pk) == SessionReport.Status.FAILED

    report.refresh_from_db()
    assert "Gemini is down" in report.error_message


def test_a_missing_row_is_logged_not_raised(stub_report_builder):
    assert run_report_build(999999) is None
    stub_report_builder.assert_not_called()


def test_a_duplicate_dispatch_does_not_rebuild(answered_session, stub_report_builder):
    report = SessionReport.objects.create(session=answered_session)
    report.mark_complete(
        {
            "overall_score": 1,
            "headline": "h",
            "summary": "s",
            "strengths": [],
            "priorities": [],
            "readiness": "ready",
        },
        answers_covered=1,
    )

    run_report_build(report.pk)

    stub_report_builder.assert_not_called()
