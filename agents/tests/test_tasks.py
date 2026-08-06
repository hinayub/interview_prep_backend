"""The task runner is the seam the whole async design rests on - both branches
have to behave identically from a caller's point of view."""

import pytest

from agents.tasks import run_task, run_task_eager


def test_thread_runner_executes_the_function(settings):
    settings.TASK_RUNNER = "thread"
    seen = []

    thread = run_task(seen.append, "payload")
    thread.join(timeout=5)

    assert seen == ["payload"]


def test_thread_runner_passes_kwargs(settings):
    settings.TASK_RUNNER = "thread"
    seen = {}

    thread = run_task(lambda **kw: seen.update(kw), row_id=7)
    thread.join(timeout=5)

    assert seen == {"row_id": 7}


def test_thread_runner_swallows_and_logs_task_failure(settings, caplog):
    """A crashing task must not take down the web process."""
    settings.TASK_RUNNER = "thread"

    def boom():
        raise RuntimeError("agent exploded")

    thread = run_task(boom)
    thread.join(timeout=5)

    assert "Background task" in caplog.text


def test_celery_runner_dispatches_via_delay(settings):
    settings.TASK_RUNNER = "celery"
    calls = []

    class FakeTask:
        def delay(self, *args, **kwargs):
            calls.append((args, kwargs))
            return "async-result"

    assert run_task(FakeTask(), 1, key="v") == "async-result"
    assert calls == [((1,), {"key": "v"})]


def test_unknown_runner_fails_loudly(settings):
    settings.TASK_RUNNER = "rabbits"

    with pytest.raises(ValueError, match="Unknown TASK_RUNNER"):
        run_task(lambda: None)


def test_eager_runner_returns_the_value():
    assert run_task_eager(lambda x: x * 2, 21) == 42
