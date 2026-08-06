"""A tiny JSON Schema checker for LLM responses.

Deliberately not ``jsonschema``. The schemas in this project are hand-written,
tiny, and use one small corner of the spec; the same subset is also what Ollama's
``format`` parameter understands, so one dict describes both what we ask for and
what we accept. Pulling a full validator in would add a dependency to enforce
rules we never write.

Supports: ``type`` (object/array/string/integer/number/boolean), ``properties``,
``required``, ``items``, ``enum``, ``minimum``, ``maximum``. Anything else in a
schema is ignored rather than silently trusted - keep the schemas in this package
inside the subset.
"""

from . import AgentError


class SchemaMismatch(AgentError):
    """The model returned well-formed JSON that does not fit the requested shape."""


_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "number": (int, float),
    "integer": int,
    "boolean": bool,
}


def _fail(path, message):
    raise SchemaMismatch(f"{path or 'response'}: {message}")


def validate(data, schema, path=""):
    """Raise ``SchemaMismatch`` unless ``data`` conforms to ``schema``.

    Returns ``data`` so callers can write ``return validate(payload, schema)``.
    """
    expected = schema.get("type")
    if expected:
        python_type = _TYPES.get(expected)
        if python_type is None:
            raise ValueError(f"Unsupported schema type {expected!r}")
        # bool is a subclass of int in Python; an LLM answering `true` for a
        # score field must not slip through as the integer 1.
        if expected in ("integer", "number") and isinstance(data, bool):
            _fail(path, f"expected {expected}, got boolean")
        if not isinstance(data, python_type):
            _fail(path, f"expected {expected}, got {type(data).__name__}")

    if "enum" in schema and data not in schema["enum"]:
        _fail(path, f"{data!r} is not one of {schema['enum']}")

    if isinstance(data, (int, float)) and not isinstance(data, bool):
        if "minimum" in schema and data < schema["minimum"]:
            _fail(path, f"{data} is below the minimum {schema['minimum']}")
        if "maximum" in schema and data > schema["maximum"]:
            _fail(path, f"{data} is above the maximum {schema['maximum']}")

    if isinstance(data, dict):
        for key in schema.get("required", ()):
            if key not in data:
                _fail(path, f"missing required key {key!r}")
        for key, subschema in schema.get("properties", {}).items():
            if key in data:
                validate(data[key], subschema, f"{path}.{key}" if path else key)

    if isinstance(data, list) and "items" in schema:
        for index, item in enumerate(data):
            validate(item, schema["items"], f"{path}[{index}]")

    return data
