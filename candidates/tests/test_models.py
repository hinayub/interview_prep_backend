"""Candidate model and serializer units.

The endpoint tests in ``test_auth.py`` cover registration end to end; these pin
the two properties everything else assumes - one Candidate per User, and a
password that never appears in serialized output.
"""

import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError

from candidates.models import Candidate
from candidates.serializers import CandidateSerializer, RegisterSerializer

pytestmark = pytest.mark.django_db


# --- model --------------------------------------------------------------------


def test_str_is_the_username(candidate):
    assert str(candidate) == candidate.user.username


def test_a_user_can_only_have_one_candidate(candidate):
    with pytest.raises(IntegrityError):
        Candidate.objects.create(user=candidate.user)


def test_the_reverse_accessor_is_user_dot_candidate(candidate):
    """Every scoped view reads request.user.candidate; the related_name must hold."""
    assert candidate.user.candidate == candidate


def test_deleting_the_user_deletes_the_candidate(candidate):
    candidate.user.delete()

    assert not Candidate.objects.exists()


def test_phone_is_optional(candidate):
    assert candidate.phone == ""


# --- CandidateSerializer ------------------------------------------------------


def test_candidate_serializer_pulls_username_and_email_through_the_user(candidate):
    candidate.user.email = "jane@example.com"
    candidate.user.save()

    data = CandidateSerializer(candidate).data

    assert data["username"] == candidate.user.username
    assert data["email"] == "jane@example.com"


def test_candidate_serializer_never_exposes_the_password(candidate):
    assert "password" not in CandidateSerializer(candidate).data


def test_candidate_serializer_only_lets_phone_be_written(candidate):
    serializer = CandidateSerializer(
        candidate, data={"phone": "+1 555 0199", "username": "attacker"}, partial=True
    )
    serializer.is_valid(raise_exception=True)
    serializer.save()
    candidate.refresh_from_db()

    assert candidate.phone == "+1 555 0199"
    assert candidate.user.username != "attacker"


# --- RegisterSerializer -------------------------------------------------------


def test_register_serializer_creates_both_rows_and_hashes_the_password():
    serializer = RegisterSerializer(
        data={"username": "newuser", "password": "s3cret-passphrase", "phone": "+1 555 0100"}
    )
    serializer.is_valid(raise_exception=True)
    candidate = serializer.save()

    assert candidate.phone == "+1 555 0100"
    assert candidate.user.check_password("s3cret-passphrase")
    assert candidate.user.password != "s3cret-passphrase"


def test_register_serializer_rejects_a_taken_username_regardless_of_case(candidate):
    serializer = RegisterSerializer(
        data={"username": candidate.user.username.upper(), "password": "s3cret-passphrase"}
    )

    assert not serializer.is_valid()
    assert "username" in serializer.errors


def test_register_serializer_applies_djangos_password_validators():
    serializer = RegisterSerializer(data={"username": "newuser", "password": "123"})

    assert not serializer.is_valid()
    assert "password" in serializer.errors


def test_a_rejected_registration_creates_no_user():
    RegisterSerializer(data={"username": "newuser", "password": "123"}).is_valid()

    assert not User.objects.filter(username="newuser").exists()


def test_email_and_phone_are_optional():
    serializer = RegisterSerializer(data={"username": "minimal", "password": "s3cret-passphrase"})
    serializer.is_valid(raise_exception=True)
    candidate = serializer.save()

    assert candidate.user.email == ""
    assert candidate.phone == ""
