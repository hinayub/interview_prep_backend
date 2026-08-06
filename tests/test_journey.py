"""The whole product, once, over HTTP.

Every other test file in this project owns one seam and stubs whatever is on the
far side of it. That is what makes them useful when something breaks - the failing
test names the layer. It is also what they cannot tell you: each of them starts
from a fixture rather than from the previous stage's output, so a break in the
*handoff* between two stages fails nothing.

This file is the one test that starts with a stranger and ends with a debrief:

    register -> upload a real PDF -> paste a posting -> run the match
             -> start an interview seeded by that match's gaps
             -> answer every question -> read the scores
             -> ask for the debrief -> read the whole rehearsal back

Nothing is faked except the four LLM calls themselves. Real HTTP through the real
URLconf, a real JWT obtained from the register endpoint and sent as a bearer token
on every subsequent call, real file upload and real PDF parsing, real serializers,
real tasks, real database. The agents are stubbed because an LLM is the one thing a
test cannot assert against - but they are stubbed at the *agent function*, so the
views, the tasks, the rows and the polling contract all run for real.

It lives outside every app because it belongs to no single one: it exists to test
the joins between them.
"""

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from conftest import ANSWER_EVALUATION, MATCH_RESULT, SAMPLE_JD_TEXT, SESSION_REPORT

pytestmark = pytest.mark.django_db

REGISTER_URL = reverse("register")
RESUMES_URL = reverse("resume-list")
JD_URL = reverse("jd-list")
MATCH_URL = reverse("match-list")
INTERVIEWS_URL = reverse("interview-list")

CREDENTIALS = {
    "username": "newcandidate",
    "email": "new@example.com",
    "password": "s3cret-passphrase",
}

ANSWER_TEXT = (
    "Task idempotency broke first. We were retrying non-idempotent Celery tasks, "
    "so a retry after a partial write duplicated rows. I added a dedupe key."
)


@pytest.fixture
def stubbed_agents(
    eager_tasks, stub_analyzer, stub_question_generator, stub_answer_evaluator, stub_report_builder
):
    """Every LLM call replaced, every task run inline. Returns the four stubs.

    ``eager_tasks`` is what makes this test readable: the real dispatcher would put
    the work on a daemon thread, and the journey would have to poll with a timeout at
    every stage. Run inline, each POST returns with its stage already finished - and
    the polling *endpoint* is still exercised, because the journey reads every result
    back through the API rather than off the model.
    """
    return {
        "match": stub_analyzer,
        "questions": stub_question_generator,
        "answer": stub_answer_evaluator,
        "report": stub_report_builder,
    }


def register():
    """Sign up through the API and return a client holding the issued token.

    ``force_authenticate`` is deliberately not used here, unlike everywhere else:
    this is the one test that should prove a token the API itself issued is accepted
    by the API on the next call.
    """
    client = APIClient()
    response = client.post(REGISTER_URL, CREDENTIALS)

    assert response.status_code == 201, response.data
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client


def test_a_candidate_goes_from_signing_up_to_a_debrief(stubbed_agents, pdf_resume):
    """The whole journey, and every id handed from one stage to the next."""
    client = register()

    # --- the two documents ----------------------------------------------------

    uploaded = client.post(RESUMES_URL, {"file": pdf_resume}, format="multipart")
    assert uploaded.status_code == 201, uploaded.data
    resume_id = uploaded.data["id"]
    # Proof the PDF was really parsed rather than merely stored: the agents are
    # stubbed, but this text is what a live run would have sent them.
    assert "Django" in uploaded.data["parsed_text"]

    posting = client.post(JD_URL, {"title": "Senior Python Engineer", "raw_text": SAMPLE_JD_TEXT})
    assert posting.status_code == 201, posting.data
    jd_id = posting.data["id"]

    # --- stage one: the match -------------------------------------------------

    started = client.post(MATCH_URL, {"resume": resume_id, "job_description": jd_id})
    assert started.status_code == 201

    # Read the result back through the polling endpoint the frontend uses, not off
    # the model - a result that never reaches the API is not a result.
    match = client.get(reverse("match-detail", args=[started.data["id"]]))
    assert match.status_code == 200
    assert match.data["status"] == "complete"
    assert match.data["match_score"] == MATCH_RESULT["match_score"]
    gaps = match.data["missing_skills"]
    assert gaps == MATCH_RESULT["missing_skills"]

    # The resume text the matcher was given came out of the uploaded PDF, not a
    # fixture handed to the task.
    resume_text, jd_text = stubbed_agents["match"].call_args.args
    assert "Celery" in resume_text
    assert jd_text == SAMPLE_JD_TEXT

    # --- stage two: the interview ---------------------------------------------

    opened = client.post(
        INTERVIEWS_URL,
        {"resume": resume_id, "job_description": jd_id, "match_analysis": match.data["id"]},
    )
    assert opened.status_code == 201, opened.data
    session_id = opened.data["id"]

    # THE handoff. Every other test proves an analysis can be *linked*; this is the
    # only one that proves the gaps it found are what the interview asks about.
    assert stubbed_agents["questions"].call_args.kwargs["missing_skills"] == gaps

    session = client.get(reverse("interview-detail", args=[session_id]))
    assert session.status_code == 200
    assert session.data["status"] == "complete"
    questions = session.data["questions"]
    assert len(questions) == len(stubbed_agents["questions"].return_value["questions"])
    assert all(question["answer"] is None for question in questions)

    # --- stage three: answering -----------------------------------------------

    for question in questions:
        answered = client.post(
            reverse("interview-answers", args=[session_id]),
            {"question": question["id"], "text": ANSWER_TEXT, "seconds_taken": 45},
        )
        assert answered.status_code == 201, answered.data
        # A row to poll, not a result. The 201 carries a *pending* evaluation even
        # here, where the task has already finished inline - the response renders the
        # relation the view attached before dispatching, which is exactly what a real
        # client sees while the model is still working. The score arrives on the next
        # GET, and that is the contract the frontend's polling is built on.
        assert answered.data["evaluation"]["status"] == "pending"
        assert answered.data["evaluation"]["score"] is None

        scored_question, scored_answer = stubbed_agents["answer"].call_args.args
        assert scored_question == question["text"]
        assert scored_answer == ANSWER_TEXT

    # --- stage four: the debrief ----------------------------------------------

    debrief = client.post(reverse("interview-report", args=[session_id]))
    assert debrief.status_code == 201, debrief.data
    # Pending for the same reason the answer was: the row is the handle to poll on.
    assert debrief.data["status"] == "pending"

    # The report was written over the answers the *answer endpoint* created, scored
    # by the evaluation task - not over a fixture built through the models.
    scored_answers = stubbed_agents["report"].call_args.args[0]
    assert len(scored_answers) == len(questions)
    assert scored_answers[0]["question"] == questions[0]["text"]
    assert scored_answers[0]["score"] == ANSWER_EVALUATION["score"]

    # --- and the whole thing, read back in one request ------------------------

    final = client.get(reverse("interview-detail", args=[session_id]))
    assert final.status_code == 200

    assert final.data["answered_count"] == len(questions)
    assert final.data["report"]["overall_score"] == SESSION_REPORT["overall_score"]
    assert final.data["report"]["answers_covered"] == len(questions)
    assert final.data["report"]["is_stale"] is False

    for question in final.data["questions"]:
        assert question["answer"]["text"] == ANSWER_TEXT
        evaluation = question["answer"]["evaluation"]
        assert evaluation["status"] == "complete"
        assert evaluation["score"] == ANSWER_EVALUATION["score"]
        assert evaluation["model_answer"]


def test_the_journey_survives_the_hosted_model_being_unconfigured(
    stubbed_agents, pdf_resume, mocker
):
    """The same journey with Gemini dead in every lane it prefers.

    Racing is supposed to make a missing API key a degradation rather than a wall
    (see agents/race.py), and that claim is only worth anything end to end: the
    candidate must still reach a scored interview, and every result must say which
    model produced it. Stubbed at the agent boundary, so this asserts what the rest
    of the stack does with a standby result rather than re-testing the race.
    """
    stubbed_agents["match"].return_value = {
        **MATCH_RESULT,
        "model_used": "llama",
        "race_note": "Gemini (hosted) failed, so Llama 3 (local) answered instead.",
    }
    stubbed_agents["answer"].return_value = {
        **ANSWER_EVALUATION,
        "model_used": "llama",
        "race_note": "Gemini (hosted) failed, so Llama 3 (local) answered instead.",
    }
    stubbed_agents["report"].return_value = {
        **SESSION_REPORT,
        "model_used": "llama",
        "race_note": "Gemini (hosted) failed, so Llama 3 (local) answered instead.",
    }

    client = register()
    resume_id = client.post(RESUMES_URL, {"file": pdf_resume}, format="multipart").data["id"]
    jd_id = client.post(
        JD_URL, {"title": "Senior Python Engineer", "raw_text": SAMPLE_JD_TEXT}
    ).data["id"]

    match = client.get(
        reverse(
            "match-detail",
            args=[client.post(MATCH_URL, {"resume": resume_id, "job_description": jd_id}).data["id"]],
        )
    )
    assert match.data["status"] == "complete"
    assert match.data["model_used"] == "llama"

    session_id = client.post(
        INTERVIEWS_URL, {"resume": resume_id, "job_description": jd_id}
    ).data["id"]
    session = client.get(reverse("interview-detail", args=[session_id]))
    # Questions prefer the local model anyway, so this stage is untouched.
    assert session.data["model_used"] == "llama"

    for question in session.data["questions"]:
        client.post(
            reverse("interview-answers", args=[session_id]),
            {"question": question["id"], "text": ANSWER_TEXT},
        )

    client.post(reverse("interview-report", args=[session_id]))
    final = client.get(reverse("interview-detail", args=[session_id]))

    # A complete rehearsal, produced entirely by the standby, and honest about it.
    assert final.data["report"]["status"] == "complete"
    assert final.data["report"]["model_used"] == "llama"
    assert "Gemini (hosted) failed" in final.data["report"]["race_note"]
    for question in final.data["questions"]:
        assert question["answer"]["evaluation"]["model_used"] == "llama"


def test_one_candidates_journey_is_invisible_to_another(stubbed_agents, pdf_resume):
    """Ownership holds across the whole chain, not just on the endpoint under test.

    Each app's tests check their own scoping. This checks that a second account,
    registered the same way, cannot reach any id the first one produced - which is
    the question an attacker actually asks.
    """
    first = register()
    resume_id = first.post(RESUMES_URL, {"file": pdf_resume}, format="multipart").data["id"]
    jd_id = first.post(
        JD_URL, {"title": "Senior Python Engineer", "raw_text": SAMPLE_JD_TEXT}
    ).data["id"]
    session_id = first.post(
        INTERVIEWS_URL, {"resume": resume_id, "job_description": jd_id}
    ).data["id"]

    intruder = APIClient()
    registered = intruder.post(REGISTER_URL, {**CREDENTIALS, "username": "someoneelse"})
    intruder.credentials(HTTP_AUTHORIZATION=f"Bearer {registered.data['access']}")

    # Not found rather than forbidden: a 403 would confirm the id exists.
    assert intruder.get(reverse("interview-detail", args=[session_id])).status_code == 404
    assert intruder.get(reverse("resume-detail", args=[resume_id])).status_code == 404
    assert intruder.get(reverse("interview-report", args=[session_id])).status_code == 404

    # And it cannot be reached by naming it as an input either, which is the hole
    # scoping the read endpoints alone would leave open.
    borrowed = intruder.post(INTERVIEWS_URL, {"resume": resume_id, "job_description": jd_id})
    assert borrowed.status_code == 400
    assert intruder.get(INTERVIEWS_URL).data == []
