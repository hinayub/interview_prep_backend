import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from conftest import SAMPLE_JD_TEXT, build_docx, build_pdf
from resumes.models import JobDescription, Resume

pytestmark = pytest.mark.django_db

RESUMES_URL = "/api/resumes/"
JD_URL = "/api/job-descriptions/"


def upload(client, uploaded_file):
    return client.post(RESUMES_URL, {"file": uploaded_file}, format="multipart")


# --- auth --------------------------------------------------------------------


def test_upload_requires_authentication(anon_client, pdf_resume):
    assert upload(anon_client, pdf_resume).status_code == 401


def test_list_requires_authentication(anon_client):
    assert anon_client.get(RESUMES_URL).status_code == 401


# --- happy path --------------------------------------------------------------


def test_uploads_pdf_and_returns_parsed_text(auth_client, pdf_resume):
    response = upload(auth_client, pdf_resume)

    assert response.status_code == 201
    assert response.data["filename"].endswith(".pdf")
    assert "Jane Q. Candidate" in response.data["parsed_text"]


def test_uploads_docx(auth_client, docx_resume):
    response = upload(auth_client, docx_resume)

    assert response.status_code == 201
    assert "Python, Django" in response.data["parsed_text"]


def test_saved_file_is_not_empty(auth_client, pdf_resume):
    """Parsing consumes the handle; if it is not rewound the stored file is 0 bytes."""
    upload(auth_client, pdf_resume)

    assert Resume.objects.get().file.size > 0


# --- append-only guarantee ---------------------------------------------------


def test_uploading_twice_creates_two_rows(auth_client, candidate):
    """The whole history feature depends on this: an upload is an INSERT, never an UPDATE."""
    first = upload(auth_client, build_pdf(filename="v1.pdf"))
    second = upload(auth_client, build_pdf(filename="v2.pdf"))

    assert first.status_code == second.status_code == 201
    assert first.data["id"] != second.data["id"]
    assert Resume.objects.filter(candidate=candidate).count() == 2


def test_creating_two_job_descriptions_keeps_both(auth_client, candidate):
    for title in ("Backend Engineer", "Platform Engineer"):
        response = auth_client.post(JD_URL, {"title": title, "raw_text": SAMPLE_JD_TEXT})
        assert response.status_code == 201

    assert JobDescription.objects.filter(candidate=candidate).count() == 2


# --- validation --------------------------------------------------------------


def test_rejects_unsupported_extension(auth_client):
    txt = SimpleUploadedFile("resume.txt", b"x" * 500, content_type="text/plain")

    response = upload(auth_client, txt)

    assert response.status_code == 400
    assert "Allowed" in str(response.data["file"])
    assert not Resume.objects.exists()


def test_rejects_oversized_file(auth_client, settings):
    settings.RESUME_MAX_BYTES = 1024
    big = build_pdf(lines=["padding line number %d" % i for i in range(400)])

    response = upload(auth_client, big)

    assert response.status_code == 400
    assert "too large" in str(response.data["file"]).lower()
    assert not Resume.objects.exists()


def test_rejects_pdf_with_no_extractable_text(auth_client):
    """Stands in for a scanned/image-only PDF - must 400, not save an empty row."""
    response = upload(auth_client, build_pdf(lines=[]))

    assert response.status_code == 400
    assert "scanned" in str(response.data["file"]).lower()
    assert not Resume.objects.exists()


def test_rejects_corrupt_pdf(auth_client):
    bogus = SimpleUploadedFile("cv.pdf", b"not really a pdf", content_type="application/pdf")

    response = upload(auth_client, bogus)

    assert response.status_code == 400
    assert not Resume.objects.exists()


def test_rejects_too_short_job_description(auth_client):
    response = auth_client.post(JD_URL, {"title": "Dev", "raw_text": "Build things."})

    assert response.status_code == 400
    assert not JobDescription.objects.exists()


# --- ownership scoping -------------------------------------------------------


def test_candidate_cannot_list_another_candidates_resumes(auth_client, make_candidate, candidate):
    other = make_candidate(username="mallory")
    Resume.objects.create(candidate=other, file="resumes/other.pdf", parsed_text="secret")
    upload(auth_client, build_pdf())

    response = auth_client.get(RESUMES_URL)

    assert response.status_code == 200
    assert len(response.data) == 1
    assert "secret" not in str(response.data)


def test_candidate_cannot_fetch_another_candidates_resume(auth_client, make_candidate):
    other = make_candidate(username="mallory")
    theirs = Resume.objects.create(candidate=other, file="resumes/other.pdf", parsed_text="secret")

    assert auth_client.get(f"{RESUMES_URL}{theirs.id}/").status_code == 404


def test_upload_is_assigned_to_requesting_candidate(auth_client, candidate, pdf_resume):
    upload(auth_client, pdf_resume)

    assert Resume.objects.get().candidate == candidate
