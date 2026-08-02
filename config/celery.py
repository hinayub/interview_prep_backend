"""Celery application.

Written now so the import path is stable, but dormant by default: this machine has
no Redis (no native Windows build, no Docker, no WSL), so ``TASK_RUNNER=thread`` in
settings is what actually executes agent work. See ``agents/tasks.py``.

To switch over once a broker is available:
    1. Start Redis (Memurai on native Windows, or Docker/WSL).
    2. Set TASK_RUNNER=celery in backend/.env
    3. celery -A config worker --loglevel=info --pool=solo

``--pool=solo`` is required on Windows; Celery's default prefork pool does not
work there.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("interview_prep")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
