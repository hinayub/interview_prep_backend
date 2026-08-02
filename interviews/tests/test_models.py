"""The interview tables, and the state machine they inherit.

``AgentJob`` is where the polling contract now lives, so the guarantees the rest of
the app relies on - a failure is always recorded, a completed row always has its
results - are asserted here once rather than per subclass.
"""

import pytest
from django.db import IntegrityError

from conftest import GENERATED_QUESTIONS
from evaluations.models import AnswerEvaluation, SessionReport
from interviews.models import Answer, InterviewSession, Question

pytestmark = pytest.mark.django_db


# --- the shared job lifecycle -------------------------------------------------


def test_a_new_session_starts_pending_and_not_terminal(session):
    assert session.status == InterviewSession.Status.PENDING
    assert not session.is_terminal
    assert session.completed_at is None


def test_marking_complete_makes_it_terminal_and_stamps_the_time(session):
    session.mark_complete(GENERATED_QUESTIONS)
    session.refresh_from_db()

    assert session.status == InterviewSession.Status.COMPLETE
    assert session.is_terminal
    assert session.completed_at is not None


def test_marking_failed_records_the_reason(session):
    session.mark_failed("Ollama is not running")
    session.refresh_from_db()

    assert session.status == InterviewSession.Status.FAILED
    assert session.is_terminal
    assert session.error_message == "Ollama is not running"


def test_mark_failed_truncates_a_huge_message(session):
    """The message can carry a whole model response, and it renders into the UI."""
    session.mark_failed("x" * 5000)
    session.refresh_from_db()

    assert len(session.error_message) == 1000


def test_completing_clears_an_earlier_error(session):
    """A retry that succeeds must not leave the previous failure on the row."""
    session.mark_failed("transient")
    session.mark_complete(GENERATED_QUESTIONS)
    session.refresh_from_db()

    assert session.error_message == ""


# --- questions ----------------------------------------------------------------


def test_completing_writes_the_questions_in_the_agents_order(session):
    session.mark_complete(GENERATED_QUESTIONS)

    questions = list(session.questions.all())
    assert [q.order for q in questions] == [1, 2, 3, 4, 5]
    assert questions[0].text == GENERATED_QUESTIONS[0]["text"]
    assert questions[3].category == "gap"


def test_a_question_set_and_the_status_flip_land_together(session):
    """A client polling between the two would render an empty interview."""
    session.mark_complete(GENERATED_QUESTIONS)
    reloaded = InterviewSession.objects.get(pk=session.pk)

    assert reloaded.status == InterviewSession.Status.COMPLETE
    assert reloaded.questions.count() == len(GENERATED_QUESTIONS)


def test_two_questions_cannot_share_a_slot(open_session):
    with pytest.raises(IntegrityError):
        Question.objects.create(session=open_session, order=1, text="Duplicate slot")


def test_questions_come_back_in_order_not_by_pk(open_session):
    """order is stored precisely because a pk sequence would only coincide with it."""
    Question.objects.filter(session=open_session, order=1).update(order=99)

    assert [q.order for q in open_session.questions.all()] == [2, 3, 4, 5, 99]


# --- answers ------------------------------------------------------------------


def test_answered_count_counts_answers_not_questions(open_session):
    assert open_session.answered_count == 0

    Answer.objects.create(question=open_session.questions.first(), text="Something.")

    assert open_session.answered_count == 1


def test_a_question_can_only_be_answered_once(open_session):
    """Submitting is a commit; the endpoint turns this into a 400 rather than a 500."""
    question = open_session.questions.first()
    Answer.objects.create(question=question, text="First attempt.")

    with pytest.raises(IntegrityError):
        Answer.objects.create(question=question, text="Second attempt.")


# --- deletion -----------------------------------------------------------------


def test_deleting_a_session_removes_its_questions_and_answers(answered_session):
    answered_session.delete()

    assert Question.objects.count() == 0
    assert Answer.objects.count() == 0
    assert AnswerEvaluation.objects.count() == 0


def test_deleting_a_candidate_removes_their_sessions(candidate, open_session):
    candidate.delete()

    assert InterviewSession.objects.count() == 0


def test_losing_the_match_analysis_does_not_delete_the_interview(session, analysis):
    """The analysis is an input to generation, not an owner - hence SET_NULL.

    An interview the candidate has answers in must survive its deletion.
    """
    session.match_analysis = analysis
    session.save(update_fields=["match_analysis"])

    analysis.delete()
    session.refresh_from_db()

    assert session.match_analysis is None


# --- the report ---------------------------------------------------------------


def test_a_report_resets_to_pending_and_drops_the_previous_result(answered_session):
    """Showing last week's debrief under a spinner invites misreading it as new."""
    report = SessionReport.objects.create(session=answered_session)
    report.mark_complete(
        {
            "overall_score": 68,
            "headline": "Old headline",
            "summary": "Old summary",
            "strengths": ["a"],
            "priorities": ["b"],
            "readiness": "ready",
        },
        answers_covered=5,
    )

    report.reset()
    report.refresh_from_db()

    assert report.status == SessionReport.Status.PENDING
    assert report.overall_score is None
    assert report.headline == ""
    assert report.strengths == []
    assert report.answers_covered == 0
    assert report.completed_at is None


def test_a_report_records_how_many_answers_it_read(answered_session):
    report = SessionReport.objects.create(session=answered_session)
    report.mark_complete(
        {
            "overall_score": 70,
            "headline": "h",
            "summary": "s",
            "strengths": [],
            "priorities": [],
            "readiness": "ready",
        },
        answers_covered=3,
    )

    assert report.answers_covered == 3


def test_an_over_long_headline_is_cut_to_fit_the_column(answered_session):
    report = SessionReport.objects.create(session=answered_session)
    report.mark_complete(
        {
            "overall_score": 70,
            "headline": "h" * 500,
            "summary": "s",
            "strengths": [],
            "priorities": [],
            "readiness": "ready",
        },
        answers_covered=1,
    )
    report.refresh_from_db()

    assert len(report.headline) == 255
