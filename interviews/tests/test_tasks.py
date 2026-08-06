"""Question generation, from the task's side.

The contract this file defends: the task never raises for an agent failure. A row
that does not go terminal is a client polling forever, so every path out of here
has to leave one behind.
"""

import pytest

from agents import AgentError
from conftest import GENERATED_QUESTIONS
from interviews.models import InterviewSession
from interviews.tasks import run_question_generation

pytestmark = pytest.mark.django_db


def test_a_successful_run_fills_in_the_session(session, stub_question_generator):
    run_question_generation(session.pk)
    session.refresh_from_db()

    assert session.status == InterviewSession.Status.COMPLETE
    assert session.questions.count() == len(GENERATED_QUESTIONS)


def test_the_resume_and_jd_text_are_what_gets_passed_to_the_agent(
    session, stub_question_generator
):
    run_question_generation(session.pk)

    resume_text, jd_text = stub_question_generator.call_args.args
    assert resume_text == session.resume.parsed_text
    assert jd_text == session.job_description.raw_text


def test_an_agent_failure_is_recorded_not_raised(session, mocker):
    mocker.patch(
        "interviews.tasks.generate_questions",
        side_effect=AgentError("Ollama is not running"),
    )

    assert run_question_generation(session.pk) == InterviewSession.Status.FAILED

    session.refresh_from_db()
    assert session.status == InterviewSession.Status.FAILED
    assert "Ollama is not running" in session.error_message


def test_an_unexpected_crash_still_leaves_the_row_terminal(session, mocker):
    """A bug in the agent layer must not strand the frontend on "pending"."""
    mocker.patch("interviews.tasks.generate_questions", side_effect=TypeError("boom"))

    assert run_question_generation(session.pk) == InterviewSession.Status.FAILED

    session.refresh_from_db()
    assert "Unexpected error" in session.error_message


def test_a_missing_row_is_logged_not_raised(stub_question_generator):
    """Nowhere to write the failure down, so there is nothing to do but return."""
    assert run_question_generation(999999) is None
    stub_question_generator.assert_not_called()


def test_a_duplicate_dispatch_does_not_write_a_second_question_set(
    open_session, stub_question_generator
):
    """The candidate may already be answering the first set."""
    run_question_generation(open_session.pk)

    assert open_session.questions.count() == len(GENERATED_QUESTIONS)
    stub_question_generator.assert_not_called()


# --- how the matcher's gaps get in --------------------------------------------


def test_a_completed_analysis_feeds_its_gaps_to_the_agent(
    session, analysis, stub_question_generator
):
    """This is what makes the interview about *this* application."""
    analysis.mark_complete(
        {
            "match_score": 70,
            "reasoning": "ok",
            "matched_skills": ["Python"],
            "missing_skills": ["Kubernetes", "Terraform"],
        }
    )
    session.match_analysis = analysis
    session.save(update_fields=["match_analysis"])

    run_question_generation(session.pk)

    assert stub_question_generator.call_args.kwargs["missing_skills"] == [
        "Kubernetes",
        "Terraform",
    ]


def test_a_pending_analysis_contributes_no_gaps_and_is_not_an_error(
    session, analysis, stub_question_generator
):
    """Questions are written from the two documents alone rather than failing."""
    session.match_analysis = analysis
    session.save(update_fields=["match_analysis"])

    run_question_generation(session.pk)
    session.refresh_from_db()

    assert stub_question_generator.call_args.kwargs["missing_skills"] == []
    assert session.status == InterviewSession.Status.COMPLETE


def test_a_failed_analysis_contributes_no_gaps_and_is_not_an_error(
    session, analysis, stub_question_generator
):
    analysis.mark_failed("model was unusable")
    session.match_analysis = analysis
    session.save(update_fields=["match_analysis"])

    run_question_generation(session.pk)
    session.refresh_from_db()

    assert stub_question_generator.call_args.kwargs["missing_skills"] == []
    assert session.status == InterviewSession.Status.COMPLETE


def test_no_analysis_at_all_still_produces_an_interview(session, stub_question_generator):
    run_question_generation(session.pk)
    session.refresh_from_db()

    assert stub_question_generator.call_args.kwargs["missing_skills"] == []
    assert session.status == InterviewSession.Status.COMPLETE
