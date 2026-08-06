"""The pipeline stage: stored resume/JD text -> Llama 3 -> a persisted result.

The LLM itself is stubbed here. What is under test is everything around it: that
the right text reaches the agent, that a result lands on the row, and - most
importantly - that a failure still leaves the row terminal, because a row stuck
on "pending" is a frontend that polls forever.
"""

import pytest

from agents import AgentError
from conftest import MATCH_RESULT
from resumes.models import MatchAnalysis
from resumes.tasks import run_match_analysis

pytestmark = pytest.mark.django_db


def test_feeds_the_stored_resume_and_jd_text_to_the_agent(analysis, stub_analyzer):
    run_match_analysis(analysis.pk)

    resume_text, jd_text = stub_analyzer.call_args.args
    assert "Jane Q. Candidate" in resume_text
    assert "Senior Python Engineer" in jd_text


def test_persists_the_result_on_the_row(analysis, stub_analyzer):
    run_match_analysis(analysis.pk)
    analysis.refresh_from_db()

    assert analysis.status == MatchAnalysis.Status.COMPLETE
    assert analysis.match_score == MATCH_RESULT["match_score"]
    assert analysis.matched_skills == MATCH_RESULT["matched_skills"]
    assert analysis.missing_skills == MATCH_RESULT["missing_skills"]
    assert analysis.completed_at is not None


def test_returns_the_terminal_status(analysis, stub_analyzer):
    assert run_match_analysis(analysis.pk) == MatchAnalysis.Status.COMPLETE


def test_an_agent_failure_marks_the_row_failed_rather_than_raising(analysis, mocker):
    mocker.patch("resumes.tasks.analyze_match", side_effect=AgentError("Ollama unreachable"))

    run_match_analysis(analysis.pk)
    analysis.refresh_from_db()

    assert analysis.status == MatchAnalysis.Status.FAILED
    assert "Ollama unreachable" in analysis.error_message
    assert analysis.completed_at is not None


def test_an_unexpected_crash_also_leaves_the_row_terminal(analysis, mocker):
    """A bug in the agent layer must not strand the poller on 'pending'."""
    mocker.patch("resumes.tasks.analyze_match", side_effect=KeyError("match_score"))

    run_match_analysis(analysis.pk)
    analysis.refresh_from_db()

    assert analysis.status == MatchAnalysis.Status.FAILED
    assert "Unexpected error" in analysis.error_message


def test_a_missing_row_is_logged_not_raised(analysis, stub_analyzer):
    analysis_id = analysis.pk
    analysis.delete()

    assert run_match_analysis(analysis_id) is None
    stub_analyzer.assert_not_called()


def test_a_second_dispatch_does_not_overwrite_a_finished_result(analysis, stub_analyzer):
    run_match_analysis(analysis.pk)
    stub_analyzer.return_value = {**MATCH_RESULT, "match_score": 12}

    run_match_analysis(analysis.pk)
    analysis.refresh_from_db()

    assert analysis.match_score == MATCH_RESULT["match_score"]
    assert stub_analyzer.call_count == 1


def test_a_second_dispatch_does_not_revive_a_failed_row(analysis, mocker):
    analysis.mark_failed("first failure")
    stub = mocker.patch("resumes.tasks.analyze_match", return_value=dict(MATCH_RESULT))

    run_match_analysis(analysis.pk)
    analysis.refresh_from_db()

    assert analysis.status == MatchAnalysis.Status.FAILED
    stub.assert_not_called()


def test_the_task_is_dispatchable_by_celery():
    """run_task's celery branch calls .delay, which only exists on a shared_task."""
    assert hasattr(run_match_analysis, "delay")
