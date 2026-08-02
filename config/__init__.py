"""Expose the Celery app so ``@shared_task`` binds to it when Django starts.

Importing this does not start a worker or contact the broker - it only builds the
app object, which is what ``.delay()`` needs when TASK_RUNNER=celery. With the
default TASK_RUNNER=thread nothing here is ever used.
"""

from .celery import app as celery_app

__all__ = ("celery_app",)
