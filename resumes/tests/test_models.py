"""Model-level guarantees the API layer takes for granted."""

import pytest
from django.utils import timezone

from conftest import MATCH_RESULT, SAMPLE_JD_TEXT
from resumes.models import JobDescription, MatchAnalysis, Resume

pytestmark = pytest.mark.django_db


# --- Resume -------------------------------------------------------------------


def test_resume_filename_strips_the_upload_path(candidate):
    row = Resume.objects.create(
        candidate=candidate, file="resumes/2026/07/jane_cv.pdf", parsed_text="x"
    )

    assert row.filename == "jane_cv.pdf"


def test_resume_str_names_the_candidate_and_file(candidate, resume):
    assert candidate.user.username in str(resume)
    assert "jane.pdf" in str(resume)


def test_resumes_are_listed_newest_first(candidate):
    older = Resume.objects.create(candidate=candidate, file="a.pdf", parsed_text="a")
    newer = Resume.objects.create(candidate=candidate, file="b.pdf", parsed_text="b")

    assert list(Resume.objects.all()) == [newer, older]


def test_deleting_a_candidate_removes_their_resumes(candidate, resume):
    candidate.delete()

    assert not Resume.objects.exists()


# --- JobDescription -----------------------------------------------------------


def test_job_description_str_includes_company_when_present(job_description):
    assert str(job_description) == "Senior Python Engineer @ Globex"


def test_job_description_str_falls_back_to_the_title(candidate):
    row = JobDescription.objects.create(
        candidate=candidate, title="Backend Engineer", raw_text=SAMPLE_JD_TEXT
    )

    assert str(row) == "Backend Engineer"


def test_job_descriptions_are_listed_newest_first(candidate):
    older = JobDescription.objects.create(candidate=candidate, title="A", raw_text="x")
    newer = JobDescription.objects.create(candidate=candidate, title="B", raw_text="y")

    assert list(JobDescription.objects.all()) == [newer, older]


# --- MatchAnalysis ------------------------------------------------------------


def test_new_analysis_starts_pending_and_empty(analysis):
    assert analysis.status == MatchAnalysis.Status.PENDING
    assert analysis.match_score is None
    assert analysis.reasoning == ""
    assert analysis.matched_skills == []
    assert analysis.missing_skills == []
    assert analysis.completed_at is None
    assert analysis.is_terminal is False


def test_default_skill_lists_are_not_shared_between_rows(candidate, resume, job_description):
    """A mutable default would make every row share one list object."""
    first = MatchAnalysis.objects.create(
        candidate=candidate, resume=resume, job_description=job_description
    )
    second = MatchAnalysis.objects.create(
        candidate=candidate, resume=resume, job_description=job_description
    )

    first.missing_skills.append("Kubernetes")

    assert second.missing_skills == []


def test_mark_complete_persists_the_whole_result(analysis):
    analysis.mark_complete(MATCH_RESULT)
    analysis.refresh_from_db()

    assert analysis.status == MatchAnalysis.Status.COMPLETE
    assert analysis.match_score == 78
    assert analysis.reasoning.startswith("You match the Django")
    assert analysis.missing_skills == ["Kubernetes", "Terraform"]
    assert analysis.completed_at is not None
    assert analysis.is_terminal is True


def test_mark_complete_tolerates_a_result_without_skill_lists(analysis):
    analysis.mark_complete({"match_score": 40, "reasoning": "Partial fit."})

    assert analysis.matched_skills == []
    assert analysis.missing_skills == []


def test_mark_complete_records_which_model_won_the_race(analysis):
    """The score is only half the story once two models can produce it."""
    analysis.mark_complete(
        {
            **MATCH_RESULT,
            "model_used": "llama",
            "race_note": "Gemini failed, so Llama 3 (local) answered instead.",
        }
    )
    analysis.refresh_from_db()

    assert analysis.model_used == "llama"
    assert analysis.race_note.startswith("Gemini failed")


def test_mark_complete_tolerates_a_result_with_no_attribution(analysis):
    """Fixtures build results by hand; an unattributed score is not a broken one."""
    analysis.mark_complete(MATCH_RESULT)
    analysis.refresh_from_db()

    assert analysis.model_used == ""
    assert analysis.race_note == ""


def test_an_over_long_race_note_is_truncated_to_the_column(analysis):
    """The note quotes a loser's error, and those carry whole model responses."""
    analysis.mark_complete({**MATCH_RESULT, "race_note": "x" * 900})
    analysis.refresh_from_db()

    assert len(analysis.race_note) == 300


def test_mark_complete_clears_a_previous_error(analysis):
    analysis.mark_failed("Ollama unreachable")

    analysis.mark_complete(MATCH_RESULT)
    analysis.refresh_from_db()

    assert analysis.error_message == ""


def test_mark_failed_records_the_message_and_a_terminal_status(analysis):
    analysis.mark_failed(RuntimeError("Ollama unreachable"))
    analysis.refresh_from_db()

    assert analysis.status == MatchAnalysis.Status.FAILED
    assert analysis.error_message == "Ollama unreachable"
    assert analysis.match_score is None
    assert analysis.is_terminal is True


def test_mark_failed_truncates_a_huge_message(analysis):
    """The message can be a whole model response, and it is rendered in the UI."""
    analysis.mark_failed("boom " * 1000)
    analysis.refresh_from_db()

    assert len(analysis.error_message) == 1000


def test_analyses_are_listed_newest_first(candidate, resume, job_description):
    older = MatchAnalysis.objects.create(
        candidate=candidate, resume=resume, job_description=job_description
    )
    newer = MatchAnalysis.objects.create(
        candidate=candidate, resume=resume, job_description=job_description
    )

    assert list(MatchAnalysis.objects.all()) == [newer, older]


def test_deleting_a_resume_removes_its_analyses(analysis, resume):
    resume.delete()

    assert not MatchAnalysis.objects.exists()


def test_deleting_a_job_description_removes_its_analyses(analysis, job_description):
    job_description.delete()

    assert not MatchAnalysis.objects.exists()


def test_the_same_pair_can_be_analysed_more_than_once(candidate, resume, job_description):
    """Re-running after editing a JD is an INSERT; history must survive."""
    for _ in range(2):
        MatchAnalysis.objects.create(
            candidate=candidate, resume=resume, job_description=job_description
        )

    assert MatchAnalysis.objects.count() == 2


def test_analysis_str_identifies_both_sides_and_the_status(analysis):
    text = str(analysis)

    assert "jane.pdf" in text
    assert "Senior Python Engineer" in text
    assert "pending" in text


def test_related_names_reach_back_from_the_candidate(candidate, analysis):
    assert list(candidate.match_analyses.all()) == [analysis]
    assert candidate.resumes.count() == 1
    assert candidate.job_descriptions.count() == 1


def test_mark_complete_stamps_completed_at_with_the_current_time(analysis):
    before = timezone.now()

    analysis.mark_complete(MATCH_RESULT)

    assert analysis.completed_at >= before
