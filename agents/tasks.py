"""The one place that decides *how* background agent work runs.

Endpoints never care. They create a row with ``status="pending"``, call
``run_task(...)``, and return immediately; the frontend polls the GET endpoint
until the status is terminal. That contract is identical under both runners, which
is why switching costs one env var and touches no view and no React component.

    TASK_RUNNER=thread   (default) daemon thread in the web process
    TASK_RUNNER=celery   dispatch via .delay() to a worker

The thread runner is the honest default here: Redis has no native Windows build and
this machine has no Docker or WSL. It is genuinely fine for single-user local
development - the work is I/O-bound waiting on an LLM, so the GIL is not the
bottleneck - but it dies with the web process and does not survive a reload, which
is exactly why the Celery path exists for deployment.
"""

import logging
import threading

from django.conf import settings
from django.db import close_old_connections

logger = logging.getLogger(__name__)


def _run_in_thread(fn, args, kwargs):
    def wrapper():
        try:
            fn(*args, **kwargs)
        except Exception:
            # The task itself is responsible for recording failure on its row.
            # Reaching here means it failed to do even that, so all we can do is
            # make sure it is not silent.
            logger.exception("Background task %s failed", getattr(fn, "__name__", fn))
        finally:
            # A thread gets its own DB connection; without this it leaks and
            # eventually trips SQLite's lock timeout.
            close_old_connections()

    thread = threading.Thread(target=wrapper, daemon=True)
    thread.start()
    return thread


def run_task(fn, *args, **kwargs):
    """Dispatch ``fn`` for background execution under the configured runner.

    ``fn`` must be decorated with ``@shared_task`` so the celery path has a
    ``.delay``. Under the thread runner the decorated function is still directly
    callable, so the same reference works for both.
    """
    if settings.TASK_RUNNER == "celery":
        return fn.delay(*args, **kwargs)

    if settings.TASK_RUNNER != "thread":
        raise ValueError(
            f"Unknown TASK_RUNNER {settings.TASK_RUNNER!r}; expected 'thread' or 'celery'"
        )

    return _run_in_thread(fn, args, kwargs)


def run_task_eager(fn, *args, **kwargs):
    """Run ``fn`` synchronously. Used by tests so agent work is deterministic."""
    return fn(*args, **kwargs)
