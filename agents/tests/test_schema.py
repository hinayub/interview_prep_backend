"""The response validator is what stops a small model's improvisation reaching the DB."""

import pytest

from agents.schema import SchemaMismatch, validate

OBJECT_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer", "minimum": 0, "maximum": 100},
        "note": {"type": "string"},
        "skills": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["score", "note"],
}


def test_a_conforming_payload_is_returned_unchanged():
    payload = {"score": 70, "note": "ok", "skills": ["Python"]}

    assert validate(payload, OBJECT_SCHEMA) is payload


def test_optional_keys_may_be_absent():
    assert validate({"score": 1, "note": "x"}, OBJECT_SCHEMA)


def test_extra_keys_are_tolerated():
    """Models like to add commentary keys; that is not a reason to fail a good answer."""
    assert validate({"score": 1, "note": "x", "confidence": "high"}, OBJECT_SCHEMA)


def test_a_missing_required_key_fails():
    with pytest.raises(SchemaMismatch, match="missing required key 'note'"):
        validate({"score": 1}, OBJECT_SCHEMA)


def test_a_wrong_scalar_type_fails():
    with pytest.raises(SchemaMismatch, match="expected integer"):
        validate({"score": "seventy", "note": "x"}, OBJECT_SCHEMA)


def test_a_boolean_is_not_accepted_as_an_integer():
    """bool subclasses int in Python, so `true` would otherwise validate as a score."""
    with pytest.raises(SchemaMismatch, match="got boolean"):
        validate({"score": True, "note": "x"}, OBJECT_SCHEMA)


def test_an_integer_is_accepted_where_a_number_is_wanted():
    assert validate(5, {"type": "number"}) == 5


@pytest.mark.parametrize("score", [-1, 101])
def test_a_score_outside_the_range_fails(score):
    with pytest.raises(SchemaMismatch):
        validate({"score": score, "note": "x"}, OBJECT_SCHEMA)


def test_the_range_boundaries_are_inclusive():
    for score in (0, 100):
        assert validate({"score": score, "note": "x"}, OBJECT_SCHEMA)


def test_array_items_are_checked():
    payload = {"score": 1, "note": "x", "skills": ["Python", 7]}

    with pytest.raises(SchemaMismatch, match=r"skills\[1\]"):
        validate(payload, OBJECT_SCHEMA)


def test_the_error_names_the_offending_path():
    with pytest.raises(SchemaMismatch, match="score:"):
        validate({"score": "x", "note": "y"}, OBJECT_SCHEMA)


def test_enum_values_are_enforced():
    with pytest.raises(SchemaMismatch, match="not one of"):
        validate("maybe", {"type": "string", "enum": ["yes", "no"]})


def test_a_top_level_non_object_fails_an_object_schema():
    with pytest.raises(SchemaMismatch, match="expected object"):
        validate(["nope"], OBJECT_SCHEMA)


def test_an_unsupported_schema_type_is_a_programming_error_not_a_model_error():
    """Raising ValueError here means a bad schema is never mistaken for a bad response."""
    with pytest.raises(ValueError, match="Unsupported schema type"):
        validate({}, {"type": "null"})
