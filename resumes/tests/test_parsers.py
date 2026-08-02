import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from conftest import build_docx, build_pdf
from resumes.parsers import ParseError, UnsupportedFileType, extract_text


def test_extracts_text_from_pdf(pdf_resume):
    text = extract_text(pdf_resume)

    assert "Jane Q. Candidate" in text
    assert "Django REST services" in text
    assert len(text) > 100


def test_extracts_text_from_docx(docx_resume):
    text = extract_text(docx_resume)

    assert "Jane Q. Candidate" in text
    assert "Python, Django" in text


def test_docx_table_content_is_included(docx_resume):
    """Resumes routinely put certifications and dates in tables."""
    text = extract_text(docx_resume)

    assert "AWS Solutions Architect" in text


def test_rejects_unsupported_extension():
    txt = SimpleUploadedFile("resume.txt", b"plain text resume", content_type="text/plain")

    with pytest.raises(UnsupportedFileType) as exc:
        extract_text(txt)

    assert ".pdf" in str(exc.value)


def test_corrupt_pdf_raises_parse_error():
    bogus = SimpleUploadedFile("resume.pdf", b"this is not a pdf at all", content_type="application/pdf")

    with pytest.raises(ParseError):
        extract_text(bogus)


def test_normalizes_whitespace():
    text = extract_text(build_docx(lines=["First    line", "", "", "", "Second     line"]))

    assert "First line" in text
    assert "Second line" in text
    assert "\n\n\n" not in text


def test_file_is_rewound_so_it_can_still_be_saved(pdf_resume):
    """The serializer parses then saves the same handle; a consumed file saves as 0 bytes."""
    extract_text(pdf_resume)

    assert pdf_resume.tell() == 0
    assert len(pdf_resume.read()) > 0


def test_scanned_pdf_yields_almost_no_text():
    """An image-only PDF has no text layer - the upload path must catch this."""
    empty = build_pdf(lines=[])

    assert len(extract_text(empty)) < 100
