"""Ollama HTTP client - the only place this project talks to Llama 3.

``call_llama`` is the single entry point and always returns a dict that has
already been checked against the caller's schema. Callers never see HTTP status
codes, never see raw model text, and never have to guess whether a key is
present: either they get conforming JSON back or they get ``AgentError``.

Two things earn their keep here:

* ``format=<schema>`` - Ollama constrains decoding to the JSON schema, so the
  usual "sure! here's your JSON:" preamble from a 3B model is impossible rather
  than merely unlikely.
* one retry - constrained decoding still lets a small model emit a
  *structurally* valid answer with a nonsense value. The retry is cheap and
  turns most of those into a usable result instead of a failed row.
"""

import json
import logging
import re

import requests
from django.conf import settings

from . import AgentError
from .schema import SchemaMismatch, validate

logger = logging.getLogger(__name__)

# A 3B model on CPU is slow; the frontend is polling, so nothing is blocked on
# this. Far worse to time out at 30s and fail a run that needed 45.
DEFAULT_TIMEOUT = 180

_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


def _endpoint():
    return f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/generate"


def _post(payload, timeout):
    """One HTTP round trip. Separated so tests can patch the network at one point."""
    try:
        response = requests.post(_endpoint(), json=payload, timeout=timeout)
    except requests.exceptions.ConnectionError as exc:
        raise AgentError(
            f"Cannot reach Ollama at {settings.OLLAMA_BASE_URL}. "
            "Is it running? Start it with `ollama serve`."
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise AgentError(f"Ollama did not respond within {timeout}s.") from exc
    except requests.exceptions.RequestException as exc:
        raise AgentError(f"Ollama request failed: {exc}") from exc

    if response.status_code == 404:
        # Ollama 404s the generate call when the model was never pulled. Saying
        # so beats "404 Not Found", which reads like a bad URL.
        raise AgentError(
            f"Ollama has no model named '{settings.OLLAMA_MODEL}'. "
            f"Pull it first: ollama pull {settings.OLLAMA_MODEL}"
        )
    if response.status_code >= 400:
        raise AgentError(f"Ollama returned HTTP {response.status_code}: {response.text[:300]}")

    try:
        return response.json()
    except ValueError as exc:
        raise AgentError("Ollama returned a non-JSON envelope.") from exc


def _parse(text, schema):
    """Turn the model's completion into a validated dict."""
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


def call_llama(prompt, schema, *, system=None, temperature=0.2, timeout=DEFAULT_TIMEOUT):
    """Send ``prompt`` to the configured Llama model, return schema-valid JSON.

    Retries once when the response fails schema validation - a transport or
    "no such model" failure is not retried, because the second attempt would
    fail identically and only doubles the wait before the row is marked failed.

    Raises ``AgentError`` (``SchemaMismatch`` is a subclass) on failure.
    """
    payload = {
        "model": settings.OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": schema,
        # Low but non-zero: scoring wants to be near-deterministic, and a hard 0
        # makes a small model loop on the same bad token when it does go wrong,
        # which defeats the retry below.
        "options": {"temperature": temperature},
    }
    if system:
        payload["system"] = system

    last_error = None
    for attempt in (1, 2):
        envelope = _post(payload, timeout)
        try:
            return _parse(envelope.get("response", ""), schema)
        except SchemaMismatch as exc:
            last_error = exc
            logger.warning(
                "Llama response failed validation (attempt %d/2): %s", attempt, exc
            )

    raise SchemaMismatch(f"Llama returned unusable JSON twice: {last_error}")
