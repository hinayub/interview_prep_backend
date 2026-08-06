"""The match-analysis endpoints.

POST starts a run and returns immediately; GET polls. These tests hold that
contract in place: a 201 must never contain a score, and the client must always
have an id to poll with.
"""

import pytest

from conftest import MATCH_RESULT
from resumes.models import JobDescription, MatchAnalysis, Resume

pytestmark = pytest.mark.django_db

MATCH_URL = "/api/match-analyses/"


def start(client, resume, job_description):
    return client.post(
        MATCH_URL, {"resume": resume.pk, "job_description": job_description.pk}
    )


# --- auth ---------------------------------------------------------------------


def test_starting_an_analysis_requires_authentication(anon_client, resume, job_description):
    assert start(anon_client, resume, job_description).status_code == 401


def test_listing_analyses_requires_authentication(anon_client):
    assert anon_client.get(MATCH_URL).status_code == 401


# --- create -------------------------------------------------------------------


def test_create_returns_a_pending_row_immediately(auth_client, resume, job_description, mocker):
    dispatch = mocker.patch("resumes.views.run_task")

    response = start(auth_client, resume, job_description)

    assert response.status_code == 201
    assert response.data["status"] == "pending"
    assert response.data["match_score"] is None
    assert response.data["id"]
    dispatch.assert_called_once()


def test_create_dispatches_the_pipeline_task_with_the_new_row_id(
    auth_client, resume, job_description, mocker
):
    dispatch = mocker.patch("resumes.views.run_task")

    response = start(auth_client, resume, job_description)

    task, row_id = dispatch.call_args.args
    assert task.__name__ == "run_match_analysis"
    assert row_id == response.data["id"]


def test_create_assigns_the_row_to_the_requesting_candidate(
    auth_client, candidate, resume, job_description, mocker
):
    mocker.patch("resumes.views.run_task")

    start(auth_client, resume, job_description)

    assert MatchAnalysis.objects.get().candidate == candidate


def test_the_pipeline_result_is_visible_through_the_api(
    auth_client, resume, job_description, eager_tasks, stub_analyzer
):
    """End to end with only the LLM stubbed: create -> task -> poll."""
    created = start(auth_client, resume, job_description)
    assert created.status_code == 201

    polled = auth_client.get(f"{MATCH_URL}{created.data['id']}/")

    assert polled.status_code == 200
    assert polled.data["status"] == "complete"
    assert polled.data["match_score"] == MATCH_RESULT["match_score"]
    assert polled.data["missing_skills"] == MATCH_RESULT["missing_skills"]
    assert polled.data["reasoning"]


def test_a_failed_run_is_reported_as_failed_not_as_a_500(
    auth_client, resume, job_description, eager_tasks, mocker
):
    from agents import AgentError

    mocker.patch("resumes.tasks.analyze_match", side_effect=AgentError("Ollama unreachable"))

    created = start(auth_client, resume, job_description)
    assert created.status_code == 201

    polled = auth_client.get(f"{MATCH_URL}{created.data['id']}/")

    assert polled.status_code == 200
    assert polled.data["status"] == "failed"
    assert "Ollama" in polled.data["error_message"]


def test_create_rejects_a_resume_the_candidate_does_not_own(
    auth_client, job_description, make_candidate, mocker
):
    dispatch = mocker.patch("resumes.views.run_task")
    other = make_candidate(username="mallory")
    theirs = Resume.objects.create(candidate=other, file="x.pdf", parsed_text="secret")

    response = auth_client.post(
        MATCH_URL, {"resume": theirs.pk, "job_description": job_description.pk}
    )

    assert response.status_code == 400
    assert not MatchAnalysis.objects.exists()
    dispatch.assert_not_called()


def test_create_rejects_a_job_description_the_candidate_does_not_own(
    auth_client, resume, make_candidate
):
    other = make_candidate(username="mallory")
    theirs = JobDescription.objects.create(candidate=other, title="Secret", raw_text="x")

    response = auth_client.post(
        MATCH_URL, {"resume": resume.pk, "job_description": theirs.pk}
    )

    assert response.status_code == 400
    assert not MatchAnalysis.objects.exists()


def test_create_rejects_a_missing_job_description(auth_client, resume):
    response = auth_client.post(MATCH_URL, {"resume": resume.pk})

    assert response.status_code == 400
    assert not MatchAnalysis.objects.exists()


def test_no_task_is_dispatched_when_validation_fails(auth_client, mocker):
    dispatch = mocker.patch("resumes.views.run_task")

    assert auth_client.post(MATCH_URL, {}).status_code == 400
    dispatch.assert_not_called()


# --- list / retrieve ----------------------------------------------------------


def test_list_returns_the_candidates_analyses_newest_first(
    auth_client, candidate, resume, job_description
):
    older = MatchAnalysis.objects.create(
        candidate=candidate, resume=resume, job_description=job_description
    )
    newer = MatchAnalysis.objects.create(
        candidate=candidate, resume=resume, job_description=job_description
    )

    response = auth_client.get(MATCH_URL)

    assert response.status_code == 200
    assert [row["id"] for row in response.data] == [newer.pk, older.pk]


def test_list_excludes_other_candidates_analyses(auth_client, analysis, make_candidate):
    other = make_candidate(username="mallory")
    other_resume = Resume.objects.create(candidate=other, file="x.pdf", parsed_text="secret")
    other_jd = JobDescription.objects.create(candidate=other, title="Secret Role", raw_text="x")
    MatchAnalysis.objects.create(
        candidate=other, resume=other_resume, job_description=other_jd
    )

    response = auth_client.get(MATCH_URL)

    assert len(response.data) == 1
    assert "Secret Role" not in str(response.data)


def test_retrieve_returns_the_row_with_its_labels(auth_client, analysis):
    response = auth_client.get(f"{MATCH_URL}{analysis.pk}/")

    assert response.status_code == 200
    assert response.data["resume_filename"] == "jane.pdf"
    assert response.data["job_title"] == "Senior Python Engineer"


def test_retrieving_another_candidates_analysis_is_a_404(auth_client, make_candidate):
    other = make_candidate(username="mallory")
    other_resume = Resume.objects.create(candidate=other, file="x.pdf", parsed_text="secret")
    other_jd = JobDescription.objects.create(candidate=other, title="Secret", raw_text="x")
    theirs = MatchAnalysis.objects.create(
        candidate=other, resume=other_resume, job_description=other_jd
    )

    assert auth_client.get(f"{MATCH_URL}{theirs.pk}/").status_code == 404


def test_polling_an_unknown_id_is_a_404(auth_client):
    assert auth_client.get(f"{MATCH_URL}99999/").status_code == 404
