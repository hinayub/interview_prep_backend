import pytest
from django.contrib.auth.models import User

from candidates.models import Candidate

pytestmark = pytest.mark.django_db

REGISTER_URL = "/api/auth/register/"
LOGIN_URL = "/api/auth/login/"
REFRESH_URL = "/api/auth/refresh/"
ME_URL = "/api/candidates/me/"

VALID = {"username": "newuser", "email": "new@example.com", "password": "s3cret-passphrase"}


def test_register_creates_user_and_candidate(anon_client):
    response = anon_client.post(REGISTER_URL, VALID)

    assert response.status_code == 201
    assert User.objects.filter(username="newuser").exists()
    assert Candidate.objects.count() == 1


def test_register_returns_usable_token_pair(anon_client):
    response = anon_client.post(REGISTER_URL, VALID)

    assert "access" in response.data and "refresh" in response.data

    anon_client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    assert anon_client.get(ME_URL).status_code == 200


def test_duplicate_username_is_rejected(anon_client, candidate):
    response = anon_client.post(REGISTER_URL, {**VALID, "username": candidate.user.username})

    assert response.status_code == 400
    assert Candidate.objects.count() == 1


def test_duplicate_username_is_case_insensitive(anon_client, candidate):
    response = anon_client.post(REGISTER_URL, {**VALID, "username": candidate.user.username.upper()})

    assert response.status_code == 400


def test_weak_password_is_rejected_and_creates_nothing(anon_client):
    response = anon_client.post(REGISTER_URL, {**VALID, "password": "123"})

    assert response.status_code == 400
    assert not User.objects.filter(username="newuser").exists()
    assert not Candidate.objects.exists()


def test_login_returns_tokens(anon_client, make_candidate):
    make_candidate(username="jane", password="s3cret-passphrase")

    response = anon_client.post(LOGIN_URL, {"username": "jane", "password": "s3cret-passphrase"})

    assert response.status_code == 200
    assert "access" in response.data


def test_login_with_wrong_password_fails(anon_client, candidate):
    response = anon_client.post(LOGIN_URL, {"username": candidate.user.username, "password": "nope"})

    assert response.status_code == 401


def test_refresh_returns_a_new_access_token(anon_client, make_candidate):
    make_candidate(username="jane", password="s3cret-passphrase")
    tokens = anon_client.post(LOGIN_URL, {"username": "jane", "password": "s3cret-passphrase"}).data

    response = anon_client.post(REFRESH_URL, {"refresh": tokens["refresh"]})

    assert response.status_code == 200
    assert "access" in response.data


def test_me_requires_authentication(anon_client):
    assert anon_client.get(ME_URL).status_code == 401


def test_me_returns_own_profile(auth_client, candidate):
    response = auth_client.get(ME_URL)

    assert response.status_code == 200
    assert response.data["username"] == candidate.user.username


def test_me_can_update_phone(auth_client, candidate):
    response = auth_client.patch(ME_URL, {"phone": "+1 555 0199"})

    assert response.status_code == 200
    candidate.refresh_from_db()
    assert candidate.phone == "+1 555 0199"
