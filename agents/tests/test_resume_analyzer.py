"""The matching agent: prompt construction and the tidy-up of what comes back."""

import pytest

from agents import AgentError
from agents.race import GEMINI, LLAMA
from agents.resume_analyzer import MATCH_SCHEMA, analyze_match, build_prompt
from conftest import SAMPLE_JD_TEXT, race_won

RESUME = "Jane Q. Candidate. Django, Celery, PostgreSQL. Five years of Python."

RAW_RESULT = {
    "match_score": 78,
    "reasoning": "You  match\nthe   Django   requirement.",
    "matched_skills": ["Python", "Django"],
    "missing_skills": ["Kubernetes"],
}


@pytest.fixture
def race(mocker):
    """Stand in for the whole race. Set ``.return_value`` to change what won."""
    return mocker.patch(
        "agents.resume_analyzer.call_race", return_value=race_won(dict(RAW_RESULT))
    )


def answered(**overrides):
    """A race won by Gemini with RAW_RESULT, patched by keyword."""
    return race_won({**RAW_RESULT, **overrides})


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


def test_the_schema_is_handed_to_the_client(race):
    analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert race.call_args.args[1] is MATCH_SCHEMA


def test_a_system_prompt_is_supplied(race):
    analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert "recruiter" in race.call_args.kwargs["system"]


def test_the_hosted_model_is_preferred_because_this_is_a_judgement(race):
    """Llama still wins this race when Gemini is unavailable - it is a preference."""
    analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert race.call_args.kwargs["prefer"] == GEMINI


def test_both_lanes_are_asked_at_the_same_temperature(race):
    """A score is only comparable across models if they were asked identically."""
    analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert race.call_args.kwargs["temperature"] == 0.2


# --- result handling ----------------------------------------------------------


def test_returns_the_keys_the_model_row_needs(race):
    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert set(result) == {
        "match_score",
        "reasoning",
        "matched_skills",
        "missing_skills",
        "model_used",
        "race_note",
    }
    assert result["match_score"] == 78


def test_the_winning_model_is_reported_back_for_the_row(race):
    race.return_value = race_won(dict(RAW_RESULT), LLAMA, note="Gemini failed, so Llama did it.")

    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert result["model_used"] == LLAMA
    assert result["race_note"] == "Gemini failed, so Llama did it."


def test_reasoning_whitespace_is_collapsed(race):
    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert result["reasoning"] == "You match the Django requirement."


def test_duplicate_skills_are_removed_case_insensitively(race):
    race.return_value = answered(matched_skills=["Python", "python", "PYTHON", "Django"])

    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert result["matched_skills"] == ["Python", "Django"]


def test_skill_punctuation_and_padding_are_stripped(race):
    race.return_value = answered(missing_skills=["  Kubernetes. ", "Terraform,"])

    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert result["missing_skills"] == ["Kubernetes", "Terraform"]


def test_empty_skill_entries_are_dropped(race):
    race.return_value = answered(missing_skills=["", "   ", "Kubernetes"])

    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert result["missing_skills"] == ["Kubernetes"]


def test_a_padded_skills_list_is_capped(race):
    race.return_value = answered(missing_skills=[f"Skill {i}" for i in range(50)])

    result = analyze_match(RESUME, SAMPLE_JD_TEXT)

    assert len(result["missing_skills"]) == 15


def test_an_empty_missing_skills_list_survives(race):
    race.return_value = answered(missing_skills=[])

    assert analyze_match(RESUME, SAMPLE_JD_TEXT)["missing_skills"] == []


# --- input guards -------------------------------------------------------------


@pytest.mark.parametrize("empty", ["", "   \n ", None])
def test_an_empty_resume_fails_before_any_llm_call(race, empty):
    with pytest.raises(AgentError, match="empty resume"):
        analyze_match(empty, SAMPLE_JD_TEXT)

    race.assert_not_called()


@pytest.mark.parametrize("empty", ["", "   \n ", None])
def test_an_empty_job_description_fails_before_any_llm_call(race, empty):
    with pytest.raises(AgentError, match="empty job description"):
        analyze_match(RESUME, empty)

    race.assert_not_called()


def test_losing_both_lanes_propagates_as_agent_error(mocker):
    """``call_race`` only raises when neither model answered, and that still fails."""
    mocker.patch(
        "agents.resume_analyzer.call_race",
        side_effect=AgentError("Neither model could answer."),
    )

    with pytest.raises(AgentError, match="Neither model"):
        analyze_match(RESUME, SAMPLE_JD_TEXT)
