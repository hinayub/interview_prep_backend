"""The interview endpoints end to end.

Two things get the most attention here. First, that the whole rehearsal is readable
in one GET - that is the contract the frontend's polling depends on. Second, that
none of it is reachable across accounts: every id a client sends is scoped, so a
stranger's resume, question or session is a 400 or a 404 and never a leak.
"""

import pytest
from django.urls import reverse

from conftest import ANSWER_EVALUATION, GENERATED_QUESTIONS
from evaluations.models import AnswerEvaluation, SessionReport
from interviews.models import Answer, InterviewSession

pytestmark = pytest.mark.django_db

LIST_URL = reverse("interview-list")


def detail_url(pk):
    return reverse("interview-detail", args=[pk])


def answers_url(pk):
    return reverse("interview-answers", args=[pk])


def report_url(pk):
    return reverse("interview-report", args=[pk])


def rescore_url(pk):
    return reverse("interview-rescore", args=[pk])


def long_answer(text="I handled it by rewriting the task to be idempotent."):
    """Comfortably over ANSWER_MIN_CHARS."""
    return text


# --- auth ---------------------------------------------------------------------


def test_starting_an_interview_requires_auth(anon_client, resume, job_description):
    response = anon_client.post(
        LIST_URL, {"resume": resume.pk, "job_description": job_description.pk}
    )

    assert response.status_code == 401


def test_reading_an_interview_requires_auth(anon_client, open_session):
    assert anon_client.get(detail_url(open_session.pk)).status_code == 401


# --- throttling ---------------------------------------------------------------


@pytest.fixture
def one_call_per_hour(mocker):
    """Squeeze the agent throttle down to a single call.

    Patched on the throttle class rather than through the ``settings`` fixture:
    DRF binds ``THROTTLE_RATES`` to ``api_settings.DEFAULT_THROTTLE_RATES`` at class
    definition time, so overriding REST_FRAMEWORK later leaves the class pointing at
    the original dict and the override silently does nothing.
    """
    return mocker.patch.dict(
        "rest_framework.throttling.ScopedRateThrottle.THROTTLE_RATES", {"agents": "1/hour"}
    )


def test_starting_interviews_is_rate_limited(
    auth_client, resume, job_description, mocker, one_call_per_hour
):
    """Each start is an LLM run, so holding the button down has to stop working.

    The rate is lowered rather than looping twenty times: what matters is that the
    scope is wired to this view at all, not what the number happens to be.
    """
    mocker.patch("interviews.views.run_task")
    payload = {"resume": resume.pk, "job_description": job_description.pk}

    assert auth_client.post(LIST_URL, payload).status_code == 201
    assert auth_client.post(LIST_URL, payload).status_code == 429


def test_polling_an_interview_is_not_rate_limited(auth_client, open_session, one_call_per_hour):
    """The client polls this every two seconds; throttling it would break the app."""
    for _ in range(5):
        assert auth_client.get(detail_url(open_session.pk)).status_code == 200


# --- starting an interview ----------------------------------------------------


def test_starting_an_interview_returns_a_pending_row_immediately(
    auth_client, resume, job_description, mocker
):
    """The 201 has no questions in it - the client takes the id and polls."""
    dispatch = mocker.patch("interviews.views.run_task")

    response = auth_client.post(
        LIST_URL, {"resume": resume.pk, "job_description": job_description.pk}
    )

    assert response.status_code == 201
    assert response.data["status"] == "pending"
    assert response.data["questions"] == []
    dispatch.assert_called_once()


def test_the_generation_task_is_dispatched_with_the_committed_row(
    auth_client, resume, job_description, mocker
):
    dispatch = mocker.patch("interviews.views.run_task")

    response = auth_client.post(
        LIST_URL, {"resume": resume.pk, "job_description": job_description.pk}
    )

    assert dispatch.call_args.args[1] == response.data["id"]
    assert InterviewSession.objects.filter(pk=response.data["id"]).exists()


def test_a_match_analysis_can_be_linked_so_the_questions_target_the_gaps(
    auth_client, resume, job_description, analysis, mocker
):
    mocker.patch("interviews.views.run_task")

    response = auth_client.post(
        LIST_URL,
        {
            "resume": resume.pk,
            "job_description": job_description.pk,
            "match_analysis": analysis.pk,
        },
    )

    assert response.status_code == 201
    assert response.data["match_analysis"] == analysis.pk


def test_an_interview_runs_to_completion_under_an_eager_runner(
    auth_client, resume, job_description, eager_tasks, stub_question_generator
):
    response = auth_client.post(
        LIST_URL, {"resume": resume.pk, "job_description": job_description.pk}
    )

    assert response.status_code == 201
    session = InterviewSession.objects.get(pk=response.data["id"])
    assert session.status == "complete"
    assert session.questions.count() == len(GENERATED_QUESTIONS)


def test_another_candidates_resume_is_not_a_valid_thing_to_interview_against(
    auth_client, make_candidate, job_description
):
    """Without the scoped queryset this would read a stranger's resume text."""
    from resumes.models import Resume

    intruder = make_candidate(username="mallory")
    theirs = Resume.objects.create(
        candidate=intruder, file="resumes/2026/07/x.pdf", parsed_text="secret" * 40
    )

    response = auth_client.post(
        LIST_URL, {"resume": theirs.pk, "job_description": job_description.pk}
    )

    assert response.status_code == 400
    assert "resume" in response.data


def test_another_candidates_analysis_cannot_be_linked(
    auth_client, resume, job_description, make_candidate
):
    from resumes.models import JobDescription, MatchAnalysis, Resume

    intruder = make_candidate(username="mallory")
    their_resume = Resume.objects.create(
        candidate=intruder, file="r.pdf", parsed_text="x" * 200
    )
    their_jd = JobDescription.objects.create(
        candidate=intruder, title="Their role", raw_text="y" * 200
    )
    theirs = MatchAnalysis.objects.create(
        candidate=intruder, resume=their_resume, job_description=their_jd
    )

    response = auth_client.post(
        LIST_URL,
        {
            "resume": resume.pk,
            "job_description": job_description.pk,
            "match_analysis": theirs.pk,
        },
    )

    assert response.status_code == 400


# --- reading one interview ----------------------------------------------------


def test_the_detail_read_carries_the_whole_rehearsal(auth_client, answered_session):
    """One request answers "what should I see right now" - questions, answers, scores."""
    response = auth_client.get(detail_url(answered_session.pk))

    assert response.status_code == 200
    questions = response.data["questions"]
    assert len(questions) == len(GENERATED_QUESTIONS)
    assert questions[0]["answer"]["text"]
    assert questions[0]["answer"]["evaluation"]["score"] == ANSWER_EVALUATION["score"]


def test_questions_come_back_in_the_order_they_should_be_asked(auth_client, open_session):
    response = auth_client.get(detail_url(open_session.pk))

    assert [q["order"] for q in response.data["questions"]] == [1, 2, 3, 4, 5]


def test_an_unanswered_question_reports_a_null_answer(auth_client, open_session):
    """This is how the client knows where in the interview the candidate is."""
    response = auth_client.get(detail_url(open_session.pk))

    assert all(question["answer"] is None for question in response.data["questions"])


def test_the_counts_let_the_client_show_progress_without_counting(
    auth_client, open_session
):
    Answer.objects.create(question=open_session.questions.first(), text=long_answer())

    response = auth_client.get(detail_url(open_session.pk))

    assert response.data["question_count"] == 5
    assert response.data["answered_count"] == 1


def test_the_focus_label_is_only_shown_next_to_the_question_it_belongs_to(
    auth_client, open_session
):
    response = auth_client.get(detail_url(open_session.pk))

    assert response.data["questions"][0]["focus"] == GENERATED_QUESTIONS[0]["focus"]


def test_the_role_is_named_without_the_client_refetching_it(auth_client, open_session):
    response = auth_client.get(detail_url(open_session.pk))

    assert response.data["job_title"] == "Senior Python Engineer"
    assert response.data["company"] == "Globex"
    assert response.data["resume_filename"] == "jane.pdf"


def test_the_detail_read_is_a_fixed_number_of_queries(
    auth_client, answered_session, django_assert_max_num_queries
):
    """It is polled every two seconds, so it must not scale with question count."""
    with django_assert_max_num_queries(8):
        auth_client.get(detail_url(answered_session.pk))


def test_another_candidates_interview_is_not_found(auth_client, make_candidate):
    from interviews.models import InterviewSession
    from resumes.models import JobDescription, Resume

    intruder = make_candidate(username="mallory")
    theirs = InterviewSession.objects.create(
        candidate=intruder,
        resume=Resume.objects.create(candidate=intruder, file="r.pdf", parsed_text="x" * 200),
        job_description=JobDescription.objects.create(
            candidate=intruder, title="Theirs", raw_text="y" * 200
        ),
    )

    assert auth_client.get(detail_url(theirs.pk)).status_code == 404


# --- the history list ---------------------------------------------------------


def test_the_list_omits_the_questions(auth_client, answered_session):
    """History is one line per session; nesting every question would grow unbounded."""
    response = auth_client.get(LIST_URL)

    assert response.status_code == 200
    assert "questions" not in response.data[0]
    assert response.data[0]["answered_count"] == 5


def test_the_list_shows_only_your_own_sessions(auth_client, open_session, make_candidate):
    from interviews.models import InterviewSession
    from resumes.models import JobDescription, Resume

    intruder = make_candidate(username="mallory")
    InterviewSession.objects.create(
        candidate=intruder,
        resume=Resume.objects.create(candidate=intruder, file="r.pdf", parsed_text="x" * 200),
        job_description=JobDescription.objects.create(
            candidate=intruder, title="Theirs", raw_text="y" * 200
        ),
    )

    response = auth_client.get(LIST_URL)

    assert len(response.data) == 1
    assert response.data[0]["id"] == open_session.pk


# --- submitting an answer -----------------------------------------------------


def test_submitting_an_answer_returns_it_with_a_pending_evaluation(
    auth_client, open_session, mocker
):
    mocker.patch("interviews.views.run_task")
    question = open_session.questions.first()

    response = auth_client.post(
        answers_url(open_session.pk), {"question": question.pk, "text": long_answer()}
    )

    assert response.status_code == 201
    assert response.data["evaluation"]["status"] == "pending"
    assert response.data["evaluation"]["score"] is None


def test_the_evaluation_row_exists_by_the_time_the_response_is_written(
    auth_client, open_session, mocker
):
    """It is what the client polls, so it cannot be created inside the task."""
    mocker.patch("interviews.views.run_task")
    question = open_session.questions.first()

    auth_client.post(
        answers_url(open_session.pk), {"question": question.pk, "text": long_answer()}
    )

    assert AnswerEvaluation.objects.filter(answer__question=question).exists()


def test_an_answer_is_scored_under_an_eager_runner(
    auth_client, open_session, eager_tasks, stub_answer_evaluator
):
    question = open_session.questions.first()

    response = auth_client.post(
        answers_url(open_session.pk), {"question": question.pk, "text": long_answer()}
    )

    assert response.status_code == 201
    evaluation = AnswerEvaluation.objects.get(answer__question=question)
    assert evaluation.status == "complete"
    assert evaluation.score == ANSWER_EVALUATION["score"]


def test_the_time_taken_is_recorded_when_the_client_reports_it(
    auth_client, open_session, mocker
):
    mocker.patch("interviews.views.run_task")

    response = auth_client.post(
        answers_url(open_session.pk),
        {"question": open_session.questions.first().pk, "text": long_answer(), "seconds_taken": 92},
    )

    assert response.data["seconds_taken"] == 92


def test_a_too_short_answer_is_refused_with_the_minimum_named(
    auth_client, open_session, mocker
):
    """A scored non-answer teaches the candidate that a shrug scores 20."""
    dispatch = mocker.patch("interviews.views.run_task")

    response = auth_client.post(
        answers_url(open_session.pk),
        {"question": open_session.questions.first().pk, "text": "dunno"},
    )

    assert response.status_code == 400
    assert "40 characters" in str(response.data["text"])
    dispatch.assert_not_called()


def test_answering_the_same_question_twice_is_a_400_not_a_500(
    auth_client, open_session, mocker
):
    """OneToOne would raise IntegrityError; submitting is a commit, so say so."""
    mocker.patch("interviews.views.run_task")
    question = open_session.questions.first()
    payload = {"question": question.pk, "text": long_answer()}

    assert auth_client.post(answers_url(open_session.pk), payload).status_code == 201
    second = auth_client.post(answers_url(open_session.pk), payload)

    assert second.status_code == 400
    assert "already answered" in str(second.data["question"])


def test_a_question_cannot_be_answered_before_generation_finishes(
    auth_client, session, open_session, mocker
):
    """There are no questions on a pending session, so this guards the message."""
    mocker.patch("interviews.views.run_task")
    # A question from a ready session, but the session itself flipped back to pending.
    question = open_session.questions.first()
    open_session.status = InterviewSession.Status.PENDING
    open_session.save(update_fields=["status"])

    response = auth_client.post(
        answers_url(open_session.pk), {"question": question.pk, "text": long_answer()}
    )

    assert response.status_code == 400
    assert "not ready yet" in str(response.data["question"])


def test_you_cannot_answer_another_candidates_question(
    auth_client, make_candidate, mocker
):
    """Ownership comes from the scoped question queryset, not the path segment.

    The path here is even the *other* candidate's session id, so nothing about the
    URL is doing the work - a question outside your own interviews simply is not a
    valid value for the field.
    """
    mocker.patch("interviews.views.run_task")
    from interviews.models import InterviewSession
    from resumes.models import JobDescription, Resume

    intruder = make_candidate(username="mallory")
    theirs = InterviewSession.objects.create(
        candidate=intruder,
        resume=Resume.objects.create(candidate=intruder, file="r.pdf", parsed_text="x" * 200),
        job_description=JobDescription.objects.create(
            candidate=intruder, title="Theirs", raw_text="y" * 200
        ),
    )
    theirs.mark_complete(GENERATED_QUESTIONS)
    their_question = theirs.questions.first()

    response = auth_client.post(
        answers_url(theirs.pk), {"question": their_question.pk, "text": long_answer()}
    )

    assert response.status_code == 400
    assert "question" in response.data
    assert not Answer.objects.filter(question=their_question).exists()


# --- re-scoring a failed answer ------------------------------------------------


def test_rescoring_clears_the_failure_and_dispatches_again(
    auth_client, answered_session, mocker
):
    """The only route back: an answer is a commit and cannot be resubmitted."""
    dispatch = mocker.patch("interviews.views.run_task")
    evaluation = AnswerEvaluation.objects.first()
    evaluation.mark_failed("No Gemini API key is configured.")

    response = auth_client.post(rescore_url(answered_session.pk))

    assert response.status_code == 200
    evaluation.refresh_from_db()
    assert evaluation.status == "pending"
    assert evaluation.error_message == ""
    dispatch.assert_called_once()


def test_rescoring_leaves_answers_that_already_scored_alone(
    auth_client, answered_session, mocker
):
    """Re-running a good score would spend money to overwrite it with a different one."""
    dispatch = mocker.patch("interviews.views.run_task")
    failed = AnswerEvaluation.objects.first()
    failed.mark_failed("Gemini declined to answer.")

    auth_client.post(rescore_url(answered_session.pk))

    assert dispatch.call_count == 1
    survivors = AnswerEvaluation.objects.exclude(pk=failed.pk)
    assert all(row.status == "complete" for row in survivors)
    assert all(row.score == ANSWER_EVALUATION["score"] for row in survivors)


def test_rescoring_a_whole_failed_session_recovers_every_answer(
    auth_client, answered_session, eager_tasks, stub_answer_evaluator
):
    """The realistic case: a missing key failed all of them at once."""
    for evaluation in AnswerEvaluation.objects.all():
        evaluation.mark_failed("No Gemini API key is configured.")

    response = auth_client.post(rescore_url(answered_session.pk))

    assert response.status_code == 200
    assert AnswerEvaluation.objects.filter(status="failed").count() == 0
    assert AnswerEvaluation.objects.filter(status="complete").count() == 5
    # And the session read now carries the scores, so the debrief has something to read.
    scored = auth_client.get(detail_url(answered_session.pk)).data["questions"]
    assert all(question["answer"]["evaluation"]["score"] for question in scored)


def test_rescoring_with_nothing_failed_says_so_rather_than_recharging(
    auth_client, answered_session, mocker
):
    dispatch = mocker.patch("interviews.views.run_task")

    response = auth_client.post(rescore_url(answered_session.pk))

    assert response.status_code == 400
    dispatch.assert_not_called()


def test_you_cannot_rescore_another_candidates_interview(auth_client, make_candidate, mocker):
    dispatch = mocker.patch("interviews.views.run_task")
    intruder = make_candidate(username="mallory")
    from resumes.models import JobDescription, Resume

    theirs = InterviewSession.objects.create(
        candidate=intruder,
        resume=Resume.objects.create(candidate=intruder, file="r.pdf", parsed_text="x" * 200),
        job_description=JobDescription.objects.create(
            candidate=intruder, title="Theirs", raw_text="y" * 200
        ),
    )
    theirs.mark_complete(GENERATED_QUESTIONS)

    response = auth_client.post(rescore_url(theirs.pk))

    assert response.status_code == 404
    dispatch.assert_not_called()


# --- the report ---------------------------------------------------------------


def test_requesting_a_report_creates_a_pending_row_and_dispatches(
    auth_client, answered_session, mocker
):
    dispatch = mocker.patch("interviews.views.run_task")

    response = auth_client.post(report_url(answered_session.pk))

    assert response.status_code == 201
    assert response.data["status"] == "pending"
    dispatch.assert_called_once()


def test_a_report_is_written_under_an_eager_runner(
    auth_client, answered_session, eager_tasks, stub_report_builder
):
    response = auth_client.post(report_url(answered_session.pk))

    assert response.status_code == 201
    report = SessionReport.objects.get(session=answered_session)
    assert report.status == "complete"
    assert report.overall_score == 68


def test_asking_twice_while_it_is_being_written_does_not_start_two_calls(
    auth_client, answered_session, mocker
):
    """Two Gemini calls racing to fill one row is money spent to corrupt a result."""
    dispatch = mocker.patch("interviews.views.run_task")

    auth_client.post(report_url(answered_session.pk))
    second = auth_client.post(report_url(answered_session.pk))

    assert second.status_code == 200
    assert dispatch.call_count == 1


def test_a_finished_report_can_be_rerun_after_more_answers(
    auth_client, answered_session, eager_tasks, stub_report_builder
):
    auth_client.post(report_url(answered_session.pk))

    again = auth_client.post(report_url(answered_session.pk))

    assert again.status_code == 200
    assert stub_report_builder.call_count == 2
    assert SessionReport.objects.filter(session=answered_session).count() == 1


def test_a_report_cannot_be_requested_for_an_interview_with_no_questions(
    auth_client, session, mocker
):
    dispatch = mocker.patch("interviews.views.run_task")

    response = auth_client.post(report_url(session.pk))

    assert response.status_code == 400
    dispatch.assert_not_called()


def test_reading_a_report_that_was_never_requested_is_a_404(auth_client, answered_session):
    response = auth_client.get(report_url(answered_session.pk))

    assert response.status_code == 404


def test_the_report_is_nested_into_the_session_read(
    auth_client, answered_session, eager_tasks, stub_report_builder
):
    """So the client polls one URL while up to three agents are working."""
    auth_client.post(report_url(answered_session.pk))

    response = auth_client.get(detail_url(answered_session.pk))

    assert response.data["report"]["status"] == "complete"
    assert response.data["report"]["headline"]


def test_a_report_is_flagged_stale_once_more_answers_arrive(
    auth_client, open_session, eager_tasks, stub_answer_evaluator, stub_report_builder
):
    """The report is a snapshot; answering more makes it incomplete, not wrong."""
    first, second = open_session.questions.all()[:2]
    auth_client.post(answers_url(open_session.pk), {"question": first.pk, "text": long_answer()})
    auth_client.post(report_url(open_session.pk))

    assert auth_client.get(detail_url(open_session.pk)).data["report"]["is_stale"] is False

    auth_client.post(answers_url(open_session.pk), {"question": second.pk, "text": long_answer()})

    assert auth_client.get(detail_url(open_session.pk)).data["report"]["is_stale"] is True


def test_an_answer_that_could_not_be_scored_does_not_flag_the_report_stale(
    auth_client, open_session, eager_tasks, stub_answer_evaluator, stub_report_builder
):
    """Otherwise the re-run button never clears, because a re-run skips it too.

    The report is written over *scored* answers, so an answer whose own evaluation
    failed is not in it and never will be. Counting it as uncovered work would leave
    the candidate permanently told their debrief is out of date.
    """
    first, second = open_session.questions.all()[:2]
    auth_client.post(answers_url(open_session.pk), {"question": first.pk, "text": long_answer()})
    auth_client.post(answers_url(open_session.pk), {"question": second.pk, "text": long_answer()})

    # One of the two scores never arrives, as happens when Gemini refuses an answer.
    AnswerEvaluation.objects.get(answer__question=second).mark_failed("Gemini refused this answer.")

    auth_client.post(report_url(open_session.pk))

    report = auth_client.get(detail_url(open_session.pk)).data["report"]
    assert report["answers_covered"] == 1
    assert report["is_stale"] is False


def test_you_cannot_request_a_report_on_another_candidates_interview(
    auth_client, make_candidate, mocker
):
    mocker.patch("interviews.views.run_task")
    from interviews.models import InterviewSession
    from resumes.models import JobDescription, Resume

    intruder = make_candidate(username="mallory")
    theirs = InterviewSession.objects.create(
        candidate=intruder,
        resume=Resume.objects.create(candidate=intruder, file="r.pdf", parsed_text="x" * 200),
        job_description=JobDescription.objects.create(
            candidate=intruder, title="Theirs", raw_text="y" * 200
        ),
    )

    assert auth_client.post(report_url(theirs.pk)).status_code == 404
