"""Django settings for the AI Interview Preparation Assistant."""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    DJANGO_SECRET_KEY=(str, ""),
    OLLAMA_BASE_URL=(str, "http://localhost:11434"),
    OLLAMA_MODEL=(str, "llama3.2:3b"),
    GEMINI_API_KEY=(str, ""),
    GEMINI_MODEL=(str, "gemini-3.6-flash"),
    TASK_RUNNER=(str, "thread"),
    CELERY_BROKER_URL=(str, "redis://localhost:6379/0"),
)
environ.Env.read_env(BASE_DIR / ".env")

DEBUG = env("DEBUG")

# The insecure fallback keeps `manage.py migrate` working before .env exists, but
# a real key is required the moment DEBUG is off.
DEV_INSECURE_KEY = "dev-only-insecure-key-do-not-deploy"
SECRET_KEY = env("DJANGO_SECRET_KEY") or DEV_INSECURE_KEY
if not DEBUG and SECRET_KEY == DEV_INSECURE_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY must be set when DEBUG=False")

ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "corsheaders",
    # Local
    "candidates",
    "resumes",
    "interviews",
    "evaluations",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
        "OPTIONS": {
            # The thread-based task runner writes from a background thread while
            # the request thread may still hold a connection. WAL plus a busy
            # timeout is what keeps SQLite's single-writer lock from surfacing as
            # "database is locked" during agent runs.
            "init_command": "PRAGMA journal_mode=WAL;",
            "timeout": 20,
        },
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- DRF / auth ---------------------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_THROTTLE_CLASSES": ("rest_framework.throttling.ScopedRateThrottle",),
    # Phase 8 attaches `throttle_scope = "agents"` to the two LLM-triggering views.
    "DEFAULT_THROTTLE_RATES": {"agents": "20/hour"},
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=12),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": False,
}

CORS_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

# --- Uploads -----------------------------------------------------------------

RESUME_MAX_BYTES = 5 * 1024 * 1024
RESUME_ALLOWED_EXTENSIONS = (".pdf", ".docx")
# A parse below this yields nothing an LLM can reason about - almost always a
# scanned/image-only PDF. Reject at upload rather than feed an empty prompt.
RESUME_MIN_PARSED_CHARS = 100

# --- Agents / async ----------------------------------------------------------

OLLAMA_BASE_URL = env("OLLAMA_BASE_URL")
OLLAMA_MODEL = env("OLLAMA_MODEL")
GEMINI_API_KEY = env("GEMINI_API_KEY")
GEMINI_MODEL = env("GEMINI_MODEL")

# Prompt budget. llama3.2:3b advertises a large context but degrades badly long
# before it, and every extra token is CPU seconds on this box. Two pages of
# resume and one page of JD is what the matching task actually needs.
AGENT_MAX_RESUME_CHARS = 6000
AGENT_MAX_JD_CHARS = 4000
# An answer is one spoken reply typed out. Past this it is an essay, and the extra
# text costs hosted tokens without changing the judgement.
AGENT_MAX_ANSWER_CHARS = 4000

# --- Interview ---------------------------------------------------------------

# Eight is one sitting. Enough to cover the four question categories twice (see
# agents/question_generator.py), few enough that a candidate finishes rather than
# abandoning half way - and an abandoned interview produces no report.
INTERVIEW_QUESTION_COUNT = 8

# Below this there is nothing for the evaluator to judge, and a scored non-answer
# is worse than a rejected one: it teaches the candidate that a shrug scores 20.
ANSWER_MIN_CHARS = 40

# "thread" (default) or "celery". See agents/tasks.py - this machine has no Redis,
# so the thread runner is what actually executes agent work today. Switching to
# "celery" changes no endpoint and no frontend code.
TASK_RUNNER = env("TASK_RUNNER")

CELERY_BROKER_URL = env("CELERY_BROKER_URL")
CELERY_RESULT_BACKEND = env("CELERY_BROKER_URL")
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
