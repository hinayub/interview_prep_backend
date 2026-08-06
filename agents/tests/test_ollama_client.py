"""The Ollama client, with the socket replaced.

Every failure mode a caller can hit has to arrive as ``AgentError`` carrying
something a user could act on, because that string is what ends up in
``MatchAnalysis.error_message`` and on the screen.
"""

import json

import pytest
import requests

from agents import AgentError
from agents.ollama_client import call_llama
from agents.schema import SchemaMismatch

SCHEMA = {
    "type": "object",
    "properties": {"score": {"type": "integer", "minimum": 0, "maximum": 100}},
    "required": ["score"],
}


class FakeResponse:
    def __init__(self, payload=None, status_code=200, text=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload)

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def completion(body):
    """An Ollama /api/generate envelope wrapping ``body`` as the model's output."""
    return FakeResponse({"response": body if isinstance(body, str) else json.dumps(body)})


@pytest.fixture
def post(mocker):
    return mocker.patch("agents.ollama_client.requests.post")


# --- happy path ---------------------------------------------------------------


def test_returns_the_parsed_response(post):
    post.return_value = completion({"score": 82})

    assert call_llama("hi", SCHEMA) == {"score": 82}


def test_sends_the_configured_model_and_the_schema_as_the_format(post, settings):
    settings.OLLAMA_MODEL = "llama3.2:3b"
    post.return_value = completion({"score": 1})

    call_llama("hi", SCHEMA)

    body = post.call_args.kwargs["json"]
    assert body["model"] == "llama3.2:3b"
    assert body["format"] == SCHEMA
    assert body["stream"] is False
    assert body["prompt"] == "hi"


def test_posts_to_the_generate_endpoint_of_the_configured_host(post, settings):
    settings.OLLAMA_BASE_URL = "http://ollama.local:11434/"
    post.return_value = completion({"score": 1})

    call_llama("hi", SCHEMA)

    assert post.call_args.args[0] == "http://ollama.local:11434/api/generate"


def test_a_system_prompt_is_passed_through_when_given(post):
    post.return_value = completion({"score": 1})

    call_llama("hi", SCHEMA, system="be terse")

    assert post.call_args.kwargs["json"]["system"] == "be terse"


def test_no_system_key_is_sent_when_none_is_given(post):
    post.return_value = completion({"score": 1})

    call_llama("hi", SCHEMA)

    assert "system" not in post.call_args.kwargs["json"]


def test_a_markdown_fenced_response_is_still_parsed(post):
    """format=json makes this unlikely, not impossible - and it is free to handle."""
    post.return_value = completion('```json\n{"score": 55}\n```')

    assert call_llama("hi", SCHEMA) == {"score": 55}


# --- retry --------------------------------------------------------------------


def test_a_bad_first_response_is_retried_and_the_second_one_is_used(post):
    post.side_effect = [completion("not json at all"), completion({"score": 40})]

    assert call_llama("hi", SCHEMA) == {"score": 40}
    assert post.call_count == 2


def test_two_bad_responses_raise(post):
    post.side_effect = [completion("garbage"), completion("garbage")]

    with pytest.raises(SchemaMismatch, match="unusable JSON twice"):
        call_llama("hi", SCHEMA)

    assert post.call_count == 2


def test_a_schema_violation_is_retried_not_returned(post):
    post.side_effect = [completion({"score": 900}), completion({"score": 90})]

    assert call_llama("hi", SCHEMA) == {"score": 90}


def test_an_empty_completion_counts_as_a_bad_response(post):
    post.side_effect = [completion(""), completion({"score": 3})]

    assert call_llama("hi", SCHEMA) == {"score": 3}


# --- transport failures -------------------------------------------------------


def test_a_connection_error_says_ollama_is_not_running(post):
    post.side_effect = requests.exceptions.ConnectionError()

    with pytest.raises(AgentError, match="Is it running"):
        call_llama("hi", SCHEMA)


def test_a_connection_error_is_not_retried(post):
    """The second attempt would fail identically and only doubles the wait."""
    post.side_effect = requests.exceptions.ConnectionError()

    with pytest.raises(AgentError):
        call_llama("hi", SCHEMA)

    assert post.call_count == 1


def test_a_timeout_names_the_limit(post):
    post.side_effect = requests.exceptions.Timeout()

    with pytest.raises(AgentError, match="within 5s"):
        call_llama("hi", SCHEMA, timeout=5)


def test_a_404_tells_the_user_to_pull_the_model(post, settings):
    settings.OLLAMA_MODEL = "llama3.2:3b"
    post.return_value = FakeResponse(status_code=404, text="model not found", payload={})

    with pytest.raises(AgentError, match="ollama pull llama3.2:3b"):
        call_llama("hi", SCHEMA)


def test_a_server_error_surfaces_the_status_code(post):
    post.return_value = FakeResponse(status_code=500, text="boom", payload={})

    with pytest.raises(AgentError, match="HTTP 500"):
        call_llama("hi", SCHEMA)


def test_a_non_json_envelope_is_an_agent_error(post):
    post.return_value = FakeResponse(status_code=200, payload=None, text="<html>")

    with pytest.raises(AgentError, match="non-JSON envelope"):
        call_llama("hi", SCHEMA)


def test_schema_mismatch_is_catchable_as_agent_error():
    """Callers catch one exception type; the task layer relies on this."""
    assert issubclass(SchemaMismatch, AgentError)
