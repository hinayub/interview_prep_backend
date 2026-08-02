"""The Gemini client, with the API replaced.

Same contract as the Ollama client's tests: every failure mode must arrive as
``AgentError`` carrying something a user could act on, because that string ends up
on the row's ``error_message`` and on the screen.

The extra ground this file covers is schema translation - our schemas carry keys
the API rejects, and dropping them must not weaken the guarantee the caller gets.
"""

import json

import pytest
from google.genai import errors as genai_errors

from agents import AgentError
from agents.gemini_client import _response_schema, call_gemini
from agents.schema import SchemaMismatch

SCHEMA = {
    "type": "object",
    "properties": {"score": {"type": "integer", "minimum": 0, "maximum": 100}},
    "required": ["score"],
}


class FakeResponse:
    """Stands in for a google-genai GenerateContentResponse."""

    def __init__(self, body=None, *, block_reason=None, finish_reason=None):
        self.text = None if body is None else (
            body if isinstance(body, str) else json.dumps(body)
        )
        self.prompt_feedback = type("Feedback", (), {"block_reason": block_reason})()
        self.candidates = [type("Candidate", (), {"finish_reason": finish_reason})()]


@pytest.fixture(autouse=True)
def api_key(settings):
    settings.GEMINI_API_KEY = "test-key"
    settings.GEMINI_MODEL = "gemini-2.5-flash"


@pytest.fixture
def generate(mocker):
    """Patch the one network seam. The autouse guard in conftest patches it too."""
    return mocker.patch("agents.gemini_client._generate")


# --- happy path ---------------------------------------------------------------


def test_returns_the_parsed_response(generate):
    generate.return_value = FakeResponse({"score": 82})

    assert call_gemini("hi", SCHEMA) == {"score": 82}


def test_a_markdown_fenced_response_is_still_parsed(generate):
    """response_mime_type makes this unlikely, not impossible - and it is free."""
    generate.return_value = FakeResponse('```json\n{"score": 55}\n```')

    assert call_gemini("hi", SCHEMA) == {"score": 55}


def test_the_system_prompt_and_temperature_are_passed_through(generate):
    generate.return_value = FakeResponse({"score": 1})

    call_gemini("hi", SCHEMA, system="be terse", temperature=0.9)

    prompt, schema, system, temperature, _timeout = generate.call_args.args
    assert prompt == "hi"
    assert schema == SCHEMA
    assert system == "be terse"
    assert temperature == 0.9


# --- schema translation -------------------------------------------------------


def test_minimum_and_maximum_are_dropped_from_the_api_schema():
    """The API rejects them on some model versions, so they are not sent."""
    translated = _response_schema(SCHEMA)

    assert "minimum" not in translated["properties"]["score"]
    assert "maximum" not in translated["properties"]["score"]
    assert translated["properties"]["score"]["type"] == "integer"


def test_dropping_the_bounds_does_not_stop_us_enforcing_them(generate):
    """The guarantee moves from the API to validate(), it does not disappear.

    This is the whole justification for stripping the keys, so it is asserted
    rather than left as a claim in a comment.
    """
    generate.side_effect = [FakeResponse({"score": 900}), FakeResponse({"score": 90})]

    assert call_gemini("hi", SCHEMA) == {"score": 90}


def test_nested_objects_and_arrays_are_translated_recursively():
    schema = {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"n": {"type": "integer", "minimum": 1}},
                    "required": ["n"],
                },
            }
        },
        "required": ["items"],
    }

    translated = _response_schema(schema)

    assert "minimum" not in translated["properties"]["items"]["items"]["properties"]["n"]
    assert translated["properties"]["items"]["items"]["required"] == ["n"]


def test_property_ordering_is_added_so_logged_responses_are_diffable():
    assert _response_schema(SCHEMA)["propertyOrdering"] == ["score"]


# --- retry --------------------------------------------------------------------


def test_a_bad_first_response_is_retried_and_the_second_one_is_used(generate):
    generate.side_effect = [FakeResponse("not json at all"), FakeResponse({"score": 40})]

    assert call_gemini("hi", SCHEMA) == {"score": 40}
    assert generate.call_count == 2


def test_two_bad_responses_raise(generate):
    generate.side_effect = [FakeResponse("garbage"), FakeResponse("garbage")]

    with pytest.raises(SchemaMismatch, match="unusable JSON twice"):
        call_gemini("hi", SCHEMA)

    assert generate.call_count == 2


def test_a_truncated_answer_is_retried_rather_than_parsed(generate):
    """MAX_TOKENS means the JSON is cut mid-object; a retry is the right response."""
    generate.side_effect = [
        FakeResponse('{"sco', finish_reason="MAX_TOKENS"),
        FakeResponse({"score": 12}),
    ]

    assert call_gemini("hi", SCHEMA) == {"score": 12}


def test_an_empty_completion_counts_as_a_bad_response(generate):
    generate.side_effect = [FakeResponse(None), FakeResponse({"score": 3})]

    assert call_gemini("hi", SCHEMA) == {"score": 3}


# --- failures that must not be retried ----------------------------------------


def test_a_blocked_prompt_says_what_was_filtered(generate):
    generate.return_value = FakeResponse(None, block_reason="SAFETY")

    with pytest.raises(AgentError, match="content filter"):
        call_gemini("hi", SCHEMA)


def test_a_blocked_prompt_is_not_retried(generate):
    """It is a property of the input, so the second attempt is blocked identically."""
    generate.return_value = FakeResponse(None, block_reason="SAFETY")

    with pytest.raises(AgentError):
        call_gemini("hi", SCHEMA)

    assert generate.call_count == 1


# --- transport and configuration ----------------------------------------------


def test_a_missing_api_key_says_where_to_put_one(settings):
    """Checked before any network work, and it names the file and the URL."""
    settings.GEMINI_API_KEY = ""

    with pytest.raises(AgentError, match="GEMINI_API_KEY"):
        call_gemini("hi", SCHEMA)


def test_a_client_error_names_the_model_that_was_asked_for(mocker, settings):
    settings.GEMINI_MODEL = "gemini-9-imaginary"
    mocker.patch(
        "agents.gemini_client.genai.Client",
        return_value=mocker.Mock(
            models=mocker.Mock(
                generate_content=mocker.Mock(
                    side_effect=genai_errors.ClientError(404, {"message": "not found"})
                )
            )
        ),
    )

    with pytest.raises(AgentError, match="gemini-9-imaginary"):
        call_gemini("hi", SCHEMA)


def test_a_transport_failure_does_not_escape_as_itself(mocker):
    """Callers catch AgentError and nothing else, so httpx errors must be wrapped."""
    mocker.patch(
        "agents.gemini_client.genai.Client",
        return_value=mocker.Mock(
            models=mocker.Mock(
                generate_content=mocker.Mock(side_effect=OSError("no route to host"))
            )
        ),
    )

    with pytest.raises(AgentError, match="Could not reach Gemini"):
        call_gemini("hi", SCHEMA)
