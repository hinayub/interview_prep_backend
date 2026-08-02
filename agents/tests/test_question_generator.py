"""The question agent.

Two things are worth testing here and neither needs a model: what goes into the
prompt, and what the module does with a response that is valid JSON but a poor
question set. The second is the whole reason ``_clean`` exists - constrained
decoding guarantees shape, not quality.
"""

import pytest

from agents import AgentError
from agents.question_generator import (
    CATEGORIES,
    QUESTION_SCHEMA,
    build_prompt,
    generate_questions,
)
from conftest import SAMPLE_JD_TEXT, SAMPLE_RESUME_LINES

RESUME = "\n".join(SAMPLE_RESUME_LINES)


def response(questions):
    return {"questions": questions}


def question(text, category="technical", focus="something"):
    return {"text": text, "category": category, "focus": focus}


@pytest.fixture
def llama(mocker):
    return mocker.patch("agents.question_generator.call_llama")


# --- the prompt ---------------------------------------------------------------


def test_both_documents_reach_the_prompt():
    prompt = build_prompt(RESUME, SAMPLE_JD_TEXT)

    assert RESUME in prompt
    assert SAMPLE_JD_TEXT in prompt


def test_the_requested_count_is_stated_and_planned():
    prompt = build_prompt(RESUME, SAMPLE_JD_TEXT, count=4)

    assert "Write 4 interview questions" in prompt
    # One numbered slot per question, each naming its category.
    assert "1. Technical" in prompt
    assert "4. Gap" in prompt
    assert "5." not in prompt


def test_the_category_plan_cycles_rather_than_blocking():
    """Cycling is what keeps the interview varied in the order it is taken."""
    prompt = build_prompt(RESUME, SAMPLE_JD_TEXT, count=8)

    assert "5. Technical" in prompt
    assert "8. Gap" in prompt


def test_the_matchers_gaps_are_fed_in_when_there_are_some():
    prompt = build_prompt(RESUME, SAMPLE_JD_TEXT, ["Kubernetes", "Terraform"])

    assert "REQUIREMENTS THE RESUME DOES NOT EVIDENCE" in prompt
    assert "Kubernetes, Terraform" in prompt


def test_no_gaps_block_appears_when_there_are_none():
    """A resume that covered everything must not get an empty, confusing heading."""
    assert "DOES NOT EVIDENCE" not in build_prompt(RESUME, SAMPLE_JD_TEXT, [])


def test_blank_gap_entries_do_not_produce_an_empty_block():
    assert "DOES NOT EVIDENCE" not in build_prompt(RESUME, SAMPLE_JD_TEXT, ["", "   "])


def test_an_over_long_resume_is_truncated_to_the_budget(settings):
    settings.AGENT_MAX_RESUME_CHARS = 200
    long_resume = "\n\n".join(f"Paragraph {n} of a very long resume." for n in range(200))

    assert len(build_prompt(long_resume, SAMPLE_JD_TEXT)) < 4000


# --- what comes back ----------------------------------------------------------


def test_returns_the_questions_in_order(llama, settings):
    settings.INTERVIEW_QUESTION_COUNT = 4
    llama.return_value = response(
        [question("First?"), question("Second?"), question("Third?"), question("Fourth?")]
    )

    result = generate_questions(RESUME, SAMPLE_JD_TEXT)

    assert [q["text"] for q in result] == ["First?", "Second?", "Third?", "Fourth?"]


def test_the_schema_and_a_system_prompt_are_sent(llama, settings):
    settings.INTERVIEW_QUESTION_COUNT = 4
    llama.return_value = response([question(f"Q{n}?") for n in range(4)])

    generate_questions(RESUME, SAMPLE_JD_TEXT)

    assert llama.call_args.args[1] == QUESTION_SCHEMA
    assert llama.call_args.kwargs["system"]


def test_generation_runs_warmer_than_scoring(llama, settings):
    """Eight questions at near-zero temperature come out as eight rewordings."""
    settings.INTERVIEW_QUESTION_COUNT = 4
    llama.return_value = response([question(f"Q{n}?") for n in range(4)])

    generate_questions(RESUME, SAMPLE_JD_TEXT)

    assert llama.call_args.kwargs["temperature"] > 0.5


def test_a_repeated_question_is_dropped_rather_than_asked_twice(llama, settings):
    settings.INTERVIEW_QUESTION_COUNT = 5
    llama.return_value = response(
        [
            question("Tell me about Celery."),
            question("Second?"),
            question("TELL ME ABOUT CELERY."),
            question("Third?"),
            question("Fourth?"),
        ]
    )

    result = generate_questions(RESUME, SAMPLE_JD_TEXT)

    assert len(result) == 4
    assert [q["text"] for q in result].count("Tell me about Celery.") == 1


def test_extra_questions_beyond_the_count_are_discarded(llama, settings):
    settings.INTERVIEW_QUESTION_COUNT = 4
    llama.return_value = response([question(f"Q{n}?") for n in range(11)])

    assert len(generate_questions(RESUME, SAMPLE_JD_TEXT)) == 4


def test_an_unknown_category_falls_back_instead_of_dropping_the_question(llama, settings):
    """A wrong label is still a question worth answering."""
    settings.INTERVIEW_QUESTION_COUNT = 4
    llama.return_value = response(
        [question(f"Q{n}?", category="curveball") for n in range(4)]
    )

    result = generate_questions(RESUME, SAMPLE_JD_TEXT)

    assert len(result) == 4
    assert all(q["category"] in CATEGORIES for q in result)


def test_a_focus_written_as_a_sentence_is_trimmed_on_a_word_boundary(llama, settings):
    settings.INTERVIEW_QUESTION_COUNT = 4
    llama.return_value = response(
        [question(f"Q{n}?", focus="a " * 60) for n in range(4)]
    )

    focus = generate_questions(RESUME, SAMPLE_JD_TEXT)[0]["focus"]

    assert len(focus) <= 60
    assert not focus.endswith(" ")


def test_whitespace_in_a_question_is_collapsed(llama, settings):
    settings.INTERVIEW_QUESTION_COUNT = 4
    llama.return_value = response(
        [question("What\n  broke\nfirst?")] + [question(f"Q{n}?") for n in range(3)]
    )

    assert generate_questions(RESUME, SAMPLE_JD_TEXT)[0]["text"] == "What broke first?"


# --- failure ------------------------------------------------------------------


def test_too_few_usable_questions_is_an_error_not_a_short_interview(llama):
    """Three questions is not an interview; the model has misread the task."""
    llama.return_value = response([question("Only one?")])

    with pytest.raises(AgentError, match="only 1 usable question"):
        generate_questions(RESUME, SAMPLE_JD_TEXT)


def test_an_empty_resume_never_reaches_the_model(llama):
    with pytest.raises(AgentError, match="without a resume"):
        generate_questions("   ", SAMPLE_JD_TEXT)

    llama.assert_not_called()


def test_an_empty_job_description_never_reaches_the_model(llama):
    with pytest.raises(AgentError, match="without a job description"):
        generate_questions(RESUME, "")

    llama.assert_not_called()
