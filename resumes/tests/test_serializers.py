"""Serializers tested directly, without going through a URL.

The endpoint tests already cover the happy paths end to end; these pin the
validation and field-exposure rules that would otherwise only be visible as a
400 somewhere far away.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIRequestFactory

from conftest import MATCH_RESULT, SAMPLE_JD_TEXT, build_pdf
from resumes.models import JobDescription, MatchAnalysis, Resume
from resumes.serializers import (
    JobDescriptionSerializer,
    MatchAnalysisSerializer,
    ResumeSerializer,
)

pytestmark = pytest.mark.django_db


def context_for(candidate):
    """A serializer context carrying an authenticated request, as a view builds it."""
    request = APIRequestFactory().post("/api/match-analyses/")
    request.user = candidate.user
    return {"request": request}


# --- ResumeSerializer ---------------------------------------------------------


def test_resume_serializer_extracts_text_during_validation():
    serializer = ResumeSerializer(data={"file": build_pdf()})

    assert serializer.is_valid(), serializer.errors
    assert "Jane Q. Candidate" in serializer.validated_data["parsed_text"]


def test_resume_serializer_rejects_an_unsupported_extension():
    bad = SimpleUploadedFile("cv.txt", b"x" * 500, content_type="text/plain")

    serializer = ResumeSerializer(data={"file": bad})

    assert not serializer.is_valid()
    assert "file" in serializer.errors


def test_resume_serializer_never_leaks_parsed_text_of_an_unreadable_file():
    """Validation failing must mean no parsed_text at all, not an empty string."""
    serializer = ResumeSerializer(data={"file": build_pdf(lines=[])})

    assert not serializer.is_valid()
    assert "parsed_text" not in getattr(serializer, "validated_data", {})


def test_resume_serializer_output_hides_the_file_and_exposes_the_filename(resume):
    data = ResumeSerializer(resume).data

    assert data["filename"] == "jane.pdf"
    assert "file" not in data
    assert set(data) == {"id", "filename", "parsed_text", "uploaded_at"}


def test_resume_serializer_ignores_a_client_supplied_parsed_text(candidate):
    serializer = ResumeSerializer(data={"file": build_pdf(), "parsed_text": "I am perfect"})
    serializer.is_valid(raise_exception=True)
    row = serializer.save(candidate=candidate)

    assert row.parsed_text != "I am perfect"


# --- JobDescriptionSerializer -------------------------------------------------


def test_jd_serializer_strips_surrounding_whitespace():
    serializer = JobDescriptionSerializer(
        data={"title": "Dev", "raw_text": f"\n\n  {SAMPLE_JD_TEXT}   \n"}
    )

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["raw_text"] == SAMPLE_JD_TEXT


def test_jd_serializer_rejects_text_that_is_only_whitespace_padding():
    """A short JD padded to length must still be rejected - hence strip-then-measure."""
    serializer = JobDescriptionSerializer(data={"title": "Dev", "raw_text": "Build things." + " " * 200})

    assert not serializer.is_valid()
    assert "raw_text" in serializer.errors


def test_jd_serializer_requires_a_title():
    serializer = JobDescriptionSerializer(data={"raw_text": SAMPLE_JD_TEXT})

    assert not serializer.is_valid()
    assert "title" in serializer.errors


def test_jd_serializer_allows_a_blank_company():
    serializer = JobDescriptionSerializer(data={"title": "Dev", "raw_text": SAMPLE_JD_TEXT})

    assert serializer.is_valid(), serializer.errors


# --- MatchAnalysisSerializer --------------------------------------------------


def test_match_serializer_accepts_the_candidates_own_ids(candidate, resume, job_description):
    serializer = MatchAnalysisSerializer(
        data={"resume": resume.pk, "job_description": job_description.pk},
        context=context_for(candidate),
    )

    assert serializer.is_valid(), serializer.errors


def test_match_serializer_rejects_another_candidates_resume(
    candidate, job_description, make_candidate
):
    other = make_candidate(username="mallory")
    theirs = Resume.objects.create(candidate=other, file="x.pdf", parsed_text="secret")

    serializer = MatchAnalysisSerializer(
        data={"resume": theirs.pk, "job_description": job_description.pk},
        context=context_for(candidate),
    )

    assert not serializer.is_valid()
    assert "resume" in serializer.errors


def test_match_serializer_rejects_another_candidates_job_description(
    candidate, resume, make_candidate
):
    other = make_candidate(username="mallory")
    theirs = JobDescription.objects.create(candidate=other, title="Secret", raw_text="x")

    serializer = MatchAnalysisSerializer(
        data={"resume": resume.pk, "job_description": theirs.pk},
        context=context_for(candidate),
    )

    assert not serializer.is_valid()
    assert "job_description" in serializer.errors


def test_match_serializer_ignores_client_supplied_results(candidate, resume, job_description):
    """Score and status are the agent's to write - a client must not preset them."""
    serializer = MatchAnalysisSerializer(
        data={
            "resume": resume.pk,
            "job_description": job_description.pk,
            "status": "complete",
            "match_score": 100,
            "reasoning": "trust me",
        },
        context=context_for(candidate),
    )
    serializer.is_valid(raise_exception=True)
    row = serializer.save(candidate=candidate)

    assert row.status == MatchAnalysis.Status.PENDING
    assert row.match_score is None
    assert row.reasoning == ""


def test_match_serializer_output_carries_what_the_poller_needs(analysis):
    analysis.mark_complete(MATCH_RESULT)

    data = MatchAnalysisSerializer(analysis).data

    assert data["status"] == "complete"
    assert data["match_score"] == 78
    assert data["missing_skills"] == ["Kubernetes", "Terraform"]
    assert data["resume_filename"] == "jane.pdf"
    assert data["job_title"] == "Senior Python Engineer"


def test_match_serializer_output_of_a_failed_row_explains_itself(analysis):
    analysis.mark_failed("Cannot reach Ollama")

    data = MatchAnalysisSerializer(analysis).data

    assert data["status"] == "failed"
    assert data["error_message"] == "Cannot reach Ollama"
    assert data["match_score"] is None


def test_match_serializer_requires_both_sides(candidate, resume):
    serializer = MatchAnalysisSerializer(
        data={"resume": resume.pk}, context=context_for(candidate)
    )

    assert not serializer.is_valid()
    assert "job_description" in serializer.errors
