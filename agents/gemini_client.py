"""Gemini HTTP client - the only place this project talks to a hosted model.

The mirror image of ``ollama_client``: same contract (prompt + schema in,
schema-valid dict out, ``AgentError`` on any failure), same single retry, so the
two are interchangeable from a caller's point of view and the agent modules do
not care which side of the split they are on.

Why anything runs here at all: Llama 3.2 3B is good enough to *generate* from a
document it has been handed, but judging a candidate's spoken answer and writing
the report they take away is the quality-critical, user-facing judgement in this
product. That goes to the stronger model. See ``agents/__init__.py``.

The one real difference from the Ollama side is schema handling - see
``_response_schema``.
"""

import json
import logging
import re

from django.conf import settings
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from . import AgentError
from .schema import SchemaMismatch, validate

logger = logging.getLogger(__name__)

# Generous but far below Ollama's: this is a hosted model over the network, so a
# call that has not answered in a minute is a call that has gone wrong, not one
# that is being thorough.
DEFAULT_TIMEOUT = 60

_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)

# The subset of our schemas that Gemini's response_schema understands. `minimum`
# and `maximum` are deliberately dropped rather than translated: the API rejects
# unknown keys on some model versions, and our own validate() enforces the ranges
# on the way out anyway. So the bound is still guaranteed to the caller - it is
# just checked locally instead of being asked for remotely.
_SUPPORTED_SCHEMA_KEYS = ("type", "properties", "required", "items", "enum", "description")


def _response_schema(schema):
    """Strip our schema dict down to what the API accepts, recursively."""
    trimmed = {key: schema[key] for key in _SUPPORTED_SCHEMA_KEYS if key in schema}

    if "properties" in trimmed:
        trimmed["properties"] = {
            name: _response_schema(sub) for name, sub in trimmed["properties"].items()
        }
    if "items" in trimmed:
        trimmed["items"] = _response_schema(trimmed["items"])

    # Gemini emits object keys in an arbitrary order without this. Harmless for
    # correctness since we parse JSON, but it makes logged responses diffable.
    if "properties" in trimmed and "propertyOrdering" not in trimmed:
        trimmed["propertyOrdering"] = list(trimmed["properties"])

    return trimmed


def _client():
    """Build a client, or explain what is missing.

    Constructed per call rather than cached at module scope: it does no network
    work on creation, and a module-level client would freeze the API key at import
    time - which breaks both key rotation and any test that overrides the setting.
    """
    if not settings.GEMINI_API_KEY:
        raise AgentError(
            "No Gemini API key is configured, so answers cannot be evaluated. "
            "Set GEMINI_API_KEY in backend/.env - get one from "
            "https://aistudio.google.com/apikey"
        )
    return genai.Client(api_key=settings.GEMINI_API_KEY)


def _generate(prompt, schema, system, temperature, timeout):
    """One API round trip. The single seam tests patch, as ``_post`` is for Ollama."""
    client = _client()
    config = types.GenerateContentConfig(
        system_instruction=system,
        temperature=temperature,
        response_mime_type="application/json",
        response_schema=_response_schema(schema),
        # The SDK wants milliseconds here, unlike requests.
        http_options=types.HttpOptions(timeout=timeout * 1000),
    )

    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL, contents=prompt, config=config
        )
    except genai_errors.ClientError as exc:
        # 4xx. Almost always a bad or unentitled key, and almost always permanent,
        # so say which model was asked for rather than just forwarding the status.
        raise AgentError(
            f"Gemini rejected the request for model '{settings.GEMINI_MODEL}': {exc}. "
            "Check GEMINI_API_KEY and GEMINI_MODEL in backend/.env."
        ) from exc
    except genai_errors.ServerError as exc:
        raise AgentError(f"Gemini is unavailable right now: {exc}") from exc
    except genai_errors.APIError as exc:
        raise AgentError(f"Gemini request failed: {exc}") from exc
    except Exception as exc:
        # Transport-level failures (no DNS, no route, timeout) surface as httpx
        # exceptions rather than APIError, and they must not escape as themselves:
        # every caller catches AgentError and nothing else.
        raise AgentError(f"Could not reach Gemini: {exc}") from exc

    return response


def _text_of(response):
    """Pull the completion out of a response, or say why there is not one.

    ``response.text`` is None rather than empty when the model produced no
    candidate, which happens when a safety filter or the token limit stopped it.
    Those need different messages: one is about the content, one is about our
    request, and "empty response" would hide both.
    """
    feedback = getattr(response, "prompt_feedback", None)
    if getattr(feedback, "block_reason", None):
        raise AgentError(
            f"Gemini declined to answer (blocked: {feedback.block_reason}). "
            "This usually means the resume or job description tripped a content filter."
        )

    candidates = getattr(response, "candidates", None) or []
    if candidates:
        reason = str(getattr(candidates[0], "finish_reason", "") or "")
        if "MAX_TOKENS" in reason:
            raise SchemaMismatch("Gemini ran out of output tokens mid-answer")

    return getattr(response, "text", None) or ""


def _parse(text, schema):
    """Turn the completion into a validated dict."""
    if not text or not text.strip():
        raise SchemaMismatch("model returned an empty response")

    fenced = _FENCE.match(text)
    if fenced:
        text = fenced.group(1)

    try:
        payload = json.loads(text)
    except ValueError as exc:
        raise SchemaMismatch(f"model did not return JSON: {text[:200]}") from exc

    return validate(payload, schema)


def call_gemini(prompt, schema, *, system=None, temperature=0.3, timeout=DEFAULT_TIMEOUT):
    """Send ``prompt`` to the configured Gemini model, return schema-valid JSON.

    Retries once on a schema failure only. A 4xx, a missing key or a dead socket
    would fail identically the second time and only doubles the wait before the
    row is marked failed.

    Raises ``AgentError`` (``SchemaMismatch`` is a subclass) on failure.
    """
    last_error = None
    for attempt in (1, 2):
        response = _generate(prompt, schema, system, temperature, timeout)
        try:
            return _parse(_text_of(response), schema)
        except SchemaMismatch as exc:
            last_error = exc
            logger.warning(
                "Gemini response failed validation (attempt %d/2): %s", attempt, exc
            )

    raise SchemaMismatch(f"Gemini returned unusable JSON twice: {last_error}")
