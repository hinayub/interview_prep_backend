"""The scoring agents.

The load-bearing claim in this module is the two-pass design: pass two reads the
*notes from pass one*, never the raw answers, so the report cannot contradict
feedback the candidate has already read. That is asserted here rather than left to
the docstring.
"""

import pytest

from agents import AgentError
from agents.evaluator import (
    ANSWER_SCHEMA,
    REPORT_SCHEMA,
    build_answer_prompt,
    build_report,
    build_report_prompt,
    evaluate_answer,
)
from agents.race import GEMINI, LLAMA
from conftest import ANSWER_EVALUATION, SESSION_REPORT, race_won

QUESTION = "You migrated a monolith to Celery - what broke first?"
ANSWER = "Task idempotency broke first. We were retrying non-idempotent tasks."


@pytest.fixture
def race(mocker):
    """Stand in for the whole race. Set ``.return_value`` to change what won."""
    return mocker.patch("agents.evaluator.call_race")


def scored(index=1, **overrides):
    """One pass-one result joined to its question, as build_report expects."""
    return {
        "question": f"Question {index}?",
        "category": "technical",
        "score": 70,
        "verdict": f"Verdict {index}.",
        "improvements": [f"Improvement {index}"],
        **overrides,
    }


# --- pass one: the prompt -----------------------------------------------------


def test_the_question_and_answer_both_reach_the_prompt():
    prompt = build_answer_prompt(QUESTION, ANSWER)

    assert QUESTION in prompt
    assert ANSWER in prompt


def test_the_role_is_named_so_the_answer_is_judged_against_it():
    prompt = build_answer_prompt(QUESTION, ANSWER, job_title="Senior Python Engineer", company="Globex")

    assert "Senior Python Engineer at Globex" in prompt


def test_a_role_with_no_company_does_not_read_as_at_nothing():
    prompt = build_answer_prompt(QUESTION, ANSWER, job_title="Senior Python Engineer")

    assert "Senior Python Engineer" in prompt
    assert "at " not in prompt.split("=== THE ROLE ===")[1].split("===")[0]


def test_the_focus_is_included_so_scoring_knows_what_was_being_tested():
    prompt = build_answer_prompt(QUESTION, ANSWER, focus="Celery retry semantics")

    assert "Celery retry semantics" in prompt


def test_a_missing_focus_is_stated_rather_than_left_blank():
    """An empty "testing: " line invites the model to invent an intent."""
    assert "not recorded" in build_answer_prompt(QUESTION, ANSWER)


def test_an_over_long_answer_is_truncated_to_the_budget(settings):
    settings.AGENT_MAX_ANSWER_CHARS = 200

    prompt = build_answer_prompt(QUESTION, "word " * 2000)

    assert len(prompt) < 2000


# --- pass one: the result -----------------------------------------------------


def test_returns_the_scored_answer(race):
    race.return_value = race_won(dict(ANSWER_EVALUATION))

    result = evaluate_answer(QUESTION, ANSWER)

    assert result["score"] == 72
    assert result["strengths"] == ANSWER_EVALUATION["strengths"]
    assert result["model_answer"]


def test_the_answer_schema_and_a_system_prompt_are_sent(race):
    race.return_value = race_won(dict(ANSWER_EVALUATION))

    evaluate_answer(QUESTION, ANSWER)

    assert race.call_args.args[1] == ANSWER_SCHEMA
    assert race.call_args.kwargs["system"]


def test_scoring_runs_cold_so_the_same_answer_scores_the_same(race):
    race.return_value = race_won(dict(ANSWER_EVALUATION))

    evaluate_answer(QUESTION, ANSWER)

    assert race.call_args.kwargs["temperature"] <= 0.2


def test_the_hosted_model_is_preferred_for_judging_an_answer(race):
    """The judgement the product sells. Llama takes it only when Gemini cannot."""
    race.return_value = race_won(dict(ANSWER_EVALUATION))

    evaluate_answer(QUESTION, ANSWER)

    assert race.call_args.kwargs["prefer"] == GEMINI


def test_a_score_says_which_model_gave_it(race):
    """A candidate reading 72/100 is entitled to know whose judgement that is."""
    race.return_value = race_won(
        dict(ANSWER_EVALUATION), LLAMA, note="Gemini failed, so Llama scored this."
    )

    result = evaluate_answer(QUESTION, ANSWER)

    assert result["model_used"] == LLAMA
    assert "Gemini failed" in result["race_note"]


def test_duplicate_feedback_points_are_collapsed(race):
    race.return_value = race_won(
        {
            **ANSWER_EVALUATION,
            "improvements": ["Add a number", "add a number", "Name the service"],
        }
    )

    assert evaluate_answer(QUESTION, ANSWER)["improvements"] == [
        "Add a number",
        "Name the service",
    ]


def test_an_empty_answer_never_reaches_the_model(race):
    """It would get a confident zero and a critique of nothing."""
    with pytest.raises(AgentError, match="empty answer"):
        evaluate_answer(QUESTION, "   ")

    race.assert_not_called()


def test_a_missing_question_never_reaches_the_model(race):
    with pytest.raises(AgentError, match="without the question"):
        evaluate_answer("", ANSWER)

    race.assert_not_called()


# --- pass two: the report -----------------------------------------------------


def test_the_report_prompt_carries_the_scores_and_verdicts():
    prompt = build_report_prompt([scored(1), scored(2)])

    assert "scored 70/100 - Verdict 1." in prompt
    assert "Question 2?" in prompt


def test_the_report_prompt_never_carries_the_raw_answers():
    """The point of the two-pass design: pass two reads notes, not answers.

    If the answer text leaked in here, the model would re-judge from scratch and
    could contradict the per-answer feedback the candidate already read.
    """
    prompt = build_report_prompt([scored(1, answer="I have no idea, honestly.")])

    assert "I have no idea" not in prompt


def test_the_answers_are_numbered_in_the_order_they_were_asked():
    prompt = build_report_prompt([scored(1), scored(2), scored(3)])

    assert prompt.index("1. [technical] Question 1?") < prompt.index("2. [technical] Question 2?")


def test_an_answer_with_no_improvements_says_so_rather_than_trailing_off():
    prompt = build_report_prompt([scored(1, improvements=[])])

    assert "nothing recorded" in prompt


def test_returns_the_report(race):
    race.return_value = race_won(dict(SESSION_REPORT))

    result = build_report([scored(1), scored(2)])

    assert result["overall_score"] == 68
    assert result["readiness"] == "nearly ready"
    assert result["priorities"] == SESSION_REPORT["priorities"]


def test_the_report_schema_and_a_system_prompt_are_sent(race):
    race.return_value = race_won(dict(SESSION_REPORT))

    build_report([scored(1)])

    assert race.call_args.args[1] == REPORT_SCHEMA
    assert race.call_args.kwargs["system"]


def test_the_report_says_which_model_wrote_it(race):
    race.return_value = race_won(dict(SESSION_REPORT), LLAMA)

    assert build_report([scored(1)])["model_used"] == LLAMA


def test_no_scored_answers_is_an_error_not_an_empty_report(race):
    with pytest.raises(AgentError, match="no evaluated answers"):
        build_report([])

    race.assert_not_called()
