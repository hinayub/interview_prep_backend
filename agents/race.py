"""Run one input past both model backends at once and keep the answer worth keeping.

``call_race`` is the third client-shaped entry point in this package, and it holds
the same contract as the two it wraps - prompt and schema in, schema-valid data
out, ``AgentError`` if nothing usable came back. The difference is that it asks
both models the *same* question at the same time and then decides between them:

    first valid answer wins          - whichever model gets there first is used
    a failure simply loses           - a dead Ollama or an unset Gemini key is no
                                       longer the end of the job, it is one lost
                                       lane; the other lane still answers
    a tie goes to the better model   - see ``prefer`` and ``grace`` below

Why this exists on top of the deliberate per-job split in ``agents/__init__.py``:
that split made each job depend on exactly one backend being healthy, so no
``GEMINI_API_KEY`` meant no scoring at all and a stopped ``ollama serve`` meant no
interview at all. Racing turns each of those from a dead feature into a slower or
slightly weaker one.

``prefer`` and ``grace`` are how a caller says which answer it would rather have
and how long that preference is worth waiting for. They are one mechanism with two
useful settings:

    prefer=GEMINI, grace=short   a real race. The hosted model is usually faster
                                 anyway; the short grace only stops a fast local
                                 answer from beating a hosted one that was about
                                 to land. Used for the judgement jobs.

    prefer=LLAMA,  grace=long    the local model with a hot standby. It wins
                                 whenever it works, so the cost design holds; the
                                 hosted answer is already computed and is used the
                                 moment the local one fails. Used for generation.

The grace clock only ever starts *after* the non-preferred model has already
answered, so neither setting can make a job slower than the model it prefers.

Set ``AGENT_RACE=False`` to switch all of this off: every job then calls its
``prefer`` model alone, which is exactly the behaviour this module replaced.
"""

import logging
import queue
import threading
import time

from django.conf import settings

from . import AgentError
from .gemini_client import call_gemini
from .ollama_client import call_llama

logger = logging.getLogger(__name__)

LLAMA = "llama"
GEMINI = "gemini"

_RUNNERS = {LLAMA: call_llama, GEMINI: call_gemini}

# Shown to the candidate, so they name the thing rather than the vendor's SKU.
LABELS = {LLAMA: "Llama 3 (local)", GEMINI: "Gemini (hosted)"}

# The note is rendered in the UI and stored in a CharField. Long enough for a
# sentence plus the loser's reason, short enough not to become the page.
MAX_NOTE_CHARS = 300


class RaceResult:
    """The outcome of one race: the kept answer, and the story of how it was chosen.

    ``data`` is what the caller asked for and is already schema-valid. Everything
    else exists to be recorded on the owning row and shown to the candidate - a
    result produced by the standby model is still a result, but they are entitled
    to know which model wrote the words they are reading.
    """

    __slots__ = ("data", "winner", "loser", "note", "seconds")

    def __init__(self, data, winner, *, loser=None, note="", seconds=0.0):
        self.data = data
        self.winner = winner
        self.loser = loser
        self.note = note[:MAX_NOTE_CHARS]
        self.seconds = seconds

    @property
    def label(self):
        return LABELS.get(self.winner, self.winner)

    def __repr__(self):  # pragma: no cover - debugging aid
        return f"<RaceResult winner={self.winner} in {self.seconds:.1f}s>"


def other(name):
    """The contender that is not ``name``."""
    return GEMINI if name == LLAMA else LLAMA


def _seconds(value):
    """One decimal place, for a note a person reads rather than a metric."""
    return f"{value:.1f}s"


def _call(name, prompt, schema, system, temperature):
    """Invoke one backend with the arguments both of them accept."""
    kwargs = {"system": system}
    if temperature is not None:
        # Passed through rather than defaulted per client: a race is only
        # meaningful when both models were asked the same question the same way.
        kwargs["temperature"] = temperature
    return _RUNNERS[name](prompt, schema, **kwargs)


def _spawn(name, prompt, schema, system, temperature, outcomes):
    """Start one contender in a daemon thread that posts its outcome to a queue.

    Daemon, and never joined: the losing lane is abandoned where it stands. A
    lost Ollama call can still be a minute from finishing and nothing is waiting
    on it, so it must not be allowed to hold up the request that overtook it or
    the interpreter on the way out. Nothing in here touches the ORM, which is what
    makes leaving it running safe.
    """

    def run():
        started = time.monotonic()
        try:
            data = _call(name, prompt, schema, system, temperature)
        except AgentError as exc:
            outcomes.put((name, None, exc, time.monotonic() - started))
        except Exception as exc:  # pragma: no cover - defensive
            # A bug in a client must lose the race rather than kill the thread
            # silently and leave the other lane's caller waiting on a queue that
            # will never receive a second item.
            logger.exception("Race lane %s crashed", name)
            outcomes.put((name, None, AgentError(f"{LABELS[name]} crashed: {exc}"), 0.0))
        else:
            outcomes.put((name, data, None, time.monotonic() - started))

    thread = threading.Thread(target=run, name=f"race-{name}", daemon=True)
    thread.start()
    return thread


def _single(prompt, schema, system, temperature, prefer):
    """AGENT_RACE=False: call the preferred model alone, as the project used to."""
    started = time.monotonic()
    data = _call(prefer, prompt, schema, system, temperature)
    return RaceResult(data, prefer, seconds=time.monotonic() - started)


def call_race(prompt, schema, *, system=None, temperature=None, prefer=GEMINI, grace=None):
    """Ask both models ``prompt`` and return the answer worth keeping.

    ``prefer`` names the model whose answer this caller would rather have, and
    ``grace`` is how many seconds that preference is worth waiting for once the
    other model has already answered. ``grace`` defaults to
    ``AGENT_RACE_GRACE_SECONDS``; pass ``AGENT_STANDBY_GRACE_SECONDS`` for the
    local-first jobs.

    Raises ``AgentError`` only when *both* models failed, and then quotes both
    reasons - the caller records that on its row exactly as before.
    """
    if not settings.AGENT_RACE:
        return _single(prompt, schema, system, temperature, prefer)

    if grace is None:
        grace = settings.AGENT_RACE_GRACE_SECONDS

    standby = other(prefer)
    outcomes = queue.Queue()
    for name in (prefer, standby):
        _spawn(name, prompt, schema, system, temperature, outcomes)

    # Blocks, but not indefinitely: both clients carry their own request timeout
    # and both report failure as an outcome, so two items always arrive.
    name, data, error, seconds = outcomes.get()

    if error is None and name == prefer:
        # The model we wanted, first. There is nothing the other lane could say
        # that would change the answer, so do not wait to hear it.
        return RaceResult(
            data,
            prefer,
            loser=standby,
            note=f"{LABELS[prefer]} answered first, in {_seconds(seconds)}.",
            seconds=seconds,
        )

    if error is None:
        return _settle_for(name, data, seconds, prefer, grace, outcomes)

    return _fall_back_from(name, error, prefer, outcomes)


def _settle_for(name, data, seconds, prefer, grace, outcomes):
    """The standby answered first. Give the preferred model ``grace`` to land."""
    logger.info("Race: %s answered first in %.1fs, waiting %.1fs for %s", name, seconds, grace, prefer)
    try:
        _, preferred_data, preferred_error, preferred_seconds = outcomes.get(timeout=grace)
    except queue.Empty:
        # Not a failure on the preferred model's part - it may still be working -
        # but the candidate is watching a spinner and there is a valid answer in
        # hand. Ship it.
        return RaceResult(
            data,
            name,
            loser=prefer,
            note=(
                f"{LABELS[name]} answered first, in {_seconds(seconds)}. "
                f"{LABELS[prefer]} had not finished {_seconds(grace)} later."
            ),
            seconds=seconds,
        )

    if preferred_error is None:
        # Both answered the same question. This is the tie the caller declared a
        # winner for in advance.
        return RaceResult(
            preferred_data,
            prefer,
            loser=name,
            note=(
                f"Both models answered. Kept {LABELS[prefer]} "
                f"({_seconds(preferred_seconds)}) over {LABELS[name]} ({_seconds(seconds)})."
            ),
            seconds=preferred_seconds,
        )

    return RaceResult(
        data,
        name,
        loser=prefer,
        note=f"{LABELS[prefer]} failed, so {LABELS[name]} answered instead: {preferred_error}",
        seconds=seconds,
    )


def _fall_back_from(name, error, prefer, outcomes):
    """The first lane out of the gate failed. The other one is the whole hope now.

    No deadline of our own here. The failure has already cost this job nothing but
    the time it took to fail, and the remaining lane's own client timeout is what
    bounds the wait - imposing a second, shorter one would abandon an answer that
    was still coming for no gain.
    """
    logger.warning("Race: %s failed (%s); waiting on %s", name, error, other(name))
    survivor, data, survivor_error, seconds = outcomes.get()

    if survivor_error is None:
        return RaceResult(
            data,
            survivor,
            loser=name,
            note=f"{LABELS[name]} failed, so {LABELS[survivor]} answered instead: {error}",
            seconds=seconds,
        )

    # Both lanes are down. Quote both, because the two failures are usually
    # different problems and a candidate who is told only one will fix only one.
    first, second = (prefer, other(prefer))
    reasons = {name: error, survivor: survivor_error}
    raise AgentError(
        f"Neither model could answer. "
        f"{LABELS[first]}: {reasons[first]} | {LABELS[second]}: {reasons[second]}"
    )
