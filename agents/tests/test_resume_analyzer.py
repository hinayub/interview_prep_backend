"""The matching agent: prompt construction and the tidy-up of what comes back."""

import pytest

from agents import AgentError
from agents.resume_analyzer import MATCH_SCHEMA, analyze_match, build_prompt
from conftest import SAMPLE_JD_TEXT

RESUME = "Jane Q. Candidate. Django, Celery, PostgreSQL. Five years of Python."

RAW_RESULT = {
    "match_score": 78,
    "reasoning": "You  match\nthe   Django   requirement.",
    "matched_skills": ["Python", "Django"],
    "missing_skills": ["Kubernetes"],
}


@pytest.fixture
def llama(mocker):
    return mocker.patch("agents.resume_analyzer.call_llama", return_value=dict(RAW_RESULT))


# --- prompt -------------------------------------------------------------------


def test_the_prompt_contains_both_documents():
    prompt = build_prompt(RESUME, SAMPLE_JD_TEXT)

    assert RESUME in prompt
    assert SAMPLE_JD_TEXT in prompt


def test_the_prompt_asks_for_every_key_the_schema_requires():
    prompt = build_prompt(RESUME, SAMPLE_JD_TEXT)

    for key in MATCH_SCHEMA["required"]:
        assert key in prompt


def test_an_over_long_resume_is_truncated_to_the_budget(settings):
    settings.AGENT_MAX_RESUME_CHARS = 200
    long_resume = "\n\n".join(f"Paragraph {i} of a very long resume." for i in range(200))

    prompt = build_prompt(long_resume, SAMPLE_JD_TEXT)

    assert len(prompt) < len(long_resume)
    assert "Paragraph 0" in prompt
    assert "Paragraph 199" not in prompt


def test_truncation_prefers_a_paragraph_boundary(settings):
    settings.AGENT_MAX_RESUME_CHARS = 60
    text = "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here."

    prompt = build_prompt(text, SAMPLE_JD_TEXT)

    assert "Second paragraph here." in prompt
    assert "Third paragraph" not in prompt


def test_a_short_resume_is_left_alone():
    assert RESUME in build_prompt(RESUME, SAMPLE_JD_TEXT)


def test_the_schema_is_handed_to_the_client(llama):
    analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert llama.call_args.args[1] is MATCH_SCHEMA


def test_a_system_prompt_is_supplied(llama):
    analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert "recruiter" in llama.call_args.kwargs["system"]


# --- result handling ----------------------------------------------------------


def test_returns_the_four_keys_the_model_row_needs(llama):
    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert set(result) == {"match_score", "reasoning", "matched_skills", "missing_skills"}
    assert result["match_score"] == 78


def test_reasoning_whitespace_is_collapsed(llama):
    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert result["reasoning"] == "You match the Django requirement."


def test_duplicate_skills_are_removed_case_insensitively(llama):
    llama.return_value = {**RAW_RESULT, "matched_skills": ["Python", "python", "PYTHON", "Django"]}

    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert result["matched_skills"] == ["Python", "Django"]


def test_skill_punctuation_and_padding_are_stripped(llama):
    llama.return_value = {**RAW_RESULT, "missing_skills": ["  Kubernetes. ", "Terraform,"]}

    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert result["missing_skills"] == ["Kubernetes", "Terraform"]


def test_empty_skill_entries_are_dropped(llama):
    llama.return_value = {**RAW_RESULT, "missing_skills": ["", "   ", "Kubernetes"]}

    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert result["missing_skills"] == ["Kubernetes"]


def test_a_padded_skills_list_is_capped(llama):
    llama.return_value = {**RAW_RESULT, "missing_skills": [f"Skill {i}" for i in range(50)]}

    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert len(result["missing_skills"]) == 15


def test_an_empty_missing_skills_list_survives(llama):
    llama.return_value = {**RAW_RESULT, "missing_skills": []}

    assert analyze_match(RESUME, SAMPLE_JD_TEXT)["missing_skills"] == []


# --- input guards -------------------------------------------------------------


@pytest.mark.parametrize("empty", ["", "   \n ", None])
def test_an_empty_resume_fails_before_any_llm_call(llama, empty):
    with pytest.raises(AgentError, match="empty resume"):
        analyze_match(empty, SAMPLE_JD_TEXT)

    llama.assert_not_called()


@pytest.mark.parametrize("empty", ["", "   \n ", None])
def test_an_empty_job_description_fails_before_any_llm_call(llama, empty):
    with pytest.raises(AgentError, match="empty job description"):
        analyze_match(RESUME, empty)

    llama.assert_not_called()


def test_a_client_failure_propagates_as_agent_error(mocker):
    mocker.patch("agents.resume_analyzer.call_llama", side_effect=AgentError("no model"))

    with pytest.raises(AgentError, match="no model"):
        analyze_match(RESUME, SAMPLE_JD_TEXT)
