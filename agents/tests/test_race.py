"""The race: two models, one input, and the rules for choosing between them.

Everything here drives ``call_race`` with fake clients that sleep for a controlled
number of milliseconds, because the three behaviours worth testing are all about
*ordering* - who answered first, who failed, and what happens when both answer.
The sleeps are tens of milliseconds and the grace windows are set per test, so the
file stays fast while still exercising the real threads and the real queue.
"""

import time

import pytest

from agents import AgentError
from agents.race import GEMINI, LLAMA, call_race, other

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}}

FROM_LLAMA = {"ok": True, "who": "llama"}
FROM_GEMINI = {"ok": True, "who": "gemini"}


@pytest.fixture(autouse=True)
def racing(settings):
    """Racing on, with a grace window short enough not to slow the suite down."""
    settings.AGENT_RACE = True
    settings.AGENT_RACE_GRACE_SECONDS = 0.5
    settings.AGENT_STANDBY_GRACE_SECONDS = 0.5
    return settings


def lane(result, *, after=0.0):
    """A fake client that answers ``result`` after ``after`` seconds.

    ``result`` may be an exception, in which case the lane fails after the same
    delay - which is how a slow failure is told apart from a fast one.
    """

    def call(prompt, schema, **kwargs):
        if after:
            time.sleep(after)
        if isinstance(result, Exception):
            raise result
        return result

    return call


@pytest.fixture
def lanes(mocker):
    """Install a fake client in each lane. Returns a setter for both."""

    def install(llama, gemini):
        mocker.patch.dict("agents.race._RUNNERS", {LLAMA: llama, GEMINI: gemini})

    return install


# --- who wins -----------------------------------------------------------------


def test_the_preferred_model_answering_first_is_used_immediately(lanes):
    lanes(llama=lane(FROM_LLAMA, after=5), gemini=lane(FROM_GEMINI))

    started = time.monotonic()
    race = call_race("prompt", SCHEMA, prefer=GEMINI)

    assert race.data == FROM_GEMINI
    assert race.winner == GEMINI
    # The point of the branch: it must not sit through the other lane's five
    # seconds to confirm what it already knows.
    assert time.monotonic() - started < 1


def test_the_standby_wins_when_the_preferred_model_is_still_working(lanes):
    """Grace expires, and a valid answer in hand beats one that might be coming."""
    lanes(llama=lane(FROM_LLAMA), gemini=lane(FROM_GEMINI, after=5))

    race = call_race("prompt", SCHEMA, prefer=GEMINI, grace=0.2)

    assert race.winner == LLAMA
    assert race.data == FROM_LLAMA
    assert "had not finished" in race.note


def test_a_tie_goes_to_the_preferred_model(lanes):
    """Both answered within the grace window, so the better model for the job wins."""
    lanes(llama=lane(FROM_LLAMA), gemini=lane(FROM_GEMINI, after=0.05))

    race = call_race("prompt", SCHEMA, prefer=GEMINI, grace=2)

    assert race.winner == GEMINI
    assert race.data == FROM_GEMINI
    assert "Both models answered" in race.note


def test_preferring_the_local_model_reverses_the_tie(lanes):
    """The same race, one argument different - this is what generation asks for."""
    lanes(llama=lane(FROM_LLAMA, after=0.05), gemini=lane(FROM_GEMINI))

    race = call_race("prompt", SCHEMA, prefer=LLAMA, grace=2)

    assert race.winner == LLAMA


# --- failure ------------------------------------------------------------------


def test_a_failing_preferred_model_hands_the_job_to_the_standby(lanes):
    """The case this whole module exists for: no API key must not mean no feature."""
    lanes(
        llama=lane(FROM_LLAMA, after=0.05),
        gemini=lane(AgentError("No Gemini API key is configured")),
    )

    race = call_race("prompt", SCHEMA, prefer=GEMINI)

    assert race.winner == LLAMA
    assert race.data == FROM_LLAMA
    assert "No Gemini API key" in race.note


def test_a_failing_standby_does_not_disturb_the_preferred_answer(lanes):
    lanes(llama=lane(AgentError("Cannot reach Ollama")), gemini=lane(FROM_GEMINI, after=0.05))

    race = call_race("prompt", SCHEMA, prefer=GEMINI)

    assert race.winner == GEMINI
    assert race.data == FROM_GEMINI


def test_a_fast_failure_does_not_beat_a_slow_success(lanes):
    """Failing first is not winning first."""
    lanes(llama=lane(FROM_LLAMA, after=0.2), gemini=lane(AgentError("dead")))

    assert call_race("prompt", SCHEMA, prefer=GEMINI).winner == LLAMA


def test_the_standby_is_waited_for_beyond_the_grace_window(lanes):
    """Grace bounds a *preference*, never the last lane still standing."""
    lanes(llama=lane(FROM_LLAMA, after=0.4), gemini=lane(AgentError("dead")))

    race = call_race("prompt", SCHEMA, prefer=GEMINI, grace=0.05)

    assert race.winner == LLAMA


def test_both_models_failing_raises_with_both_reasons(lanes):
    """One reason would send the candidate off to fix half the problem."""
    lanes(
        llama=lane(AgentError("Cannot reach Ollama")),
        gemini=lane(AgentError("No Gemini API key")),
    )

    with pytest.raises(AgentError) as caught:
        call_race("prompt", SCHEMA, prefer=GEMINI)

    assert "Cannot reach Ollama" in str(caught.value)
    assert "No Gemini API key" in str(caught.value)


def test_a_crashing_client_loses_the_race_rather_than_hanging_it(lanes):
    """A bug in one client must not leave the other lane's caller on a dead queue."""
    lanes(llama=lane(FROM_LLAMA, after=0.05), gemini=lane(TypeError("boom")))

    assert call_race("prompt", SCHEMA, prefer=GEMINI).winner == LLAMA


# --- what both lanes are asked ------------------------------------------------


def test_both_lanes_get_the_same_prompt_schema_and_temperature(mocker):
    """A comparison is only meaningful if the question was identical."""
    seen = {}

    def record(name):
        def call(prompt, schema, **kwargs):
            seen[name] = (prompt, schema, kwargs)
            time.sleep(0.05)
            return FROM_LLAMA

        return call

    mocker.patch.dict(
        "agents.race._RUNNERS", {LLAMA: record(LLAMA), GEMINI: record(GEMINI)}
    )

    call_race("the prompt", SCHEMA, system="be terse", temperature=0.42, prefer=GEMINI, grace=2)

    assert seen[LLAMA] == seen[GEMINI]
    assert seen[LLAMA][0] == "the prompt"
    assert seen[LLAMA][2] == {"system": "be terse", "temperature": 0.42}


def test_temperature_is_left_to_each_client_when_unset(lanes, mocker):
    seen = {}

    def record(prompt, schema, **kwargs):
        seen.update(kwargs)
        return FROM_GEMINI

    lanes(llama=lane(FROM_LLAMA, after=5), gemini=record)

    call_race("prompt", SCHEMA, prefer=GEMINI)

    assert "temperature" not in seen


# --- the off switch -----------------------------------------------------------


def test_racing_off_calls_only_the_preferred_model(lanes, racing):
    racing.AGENT_RACE = False
    called = []

    def only_me(prompt, schema, **kwargs):
        called.append(GEMINI)
        return FROM_GEMINI

    def never(prompt, schema, **kwargs):
        raise AssertionError("the standby lane ran with racing off")

    lanes(llama=never, gemini=only_me)

    race = call_race("prompt", SCHEMA, prefer=GEMINI)

    assert race.winner == GEMINI
    assert called == [GEMINI]


def test_racing_off_propagates_the_failure_as_before(lanes, racing):
    racing.AGENT_RACE = False
    lanes(llama=lane(FROM_LLAMA), gemini=lane(AgentError("No Gemini API key")))

    with pytest.raises(AgentError, match="No Gemini API key"):
        call_race("prompt", SCHEMA, prefer=GEMINI)


# --- the result object --------------------------------------------------------


def test_the_note_is_capped_so_it_fits_the_column(lanes):
    lanes(llama=lane(FROM_LLAMA, after=0.05), gemini=lane(AgentError("x" * 900)))

    assert len(call_race("prompt", SCHEMA, prefer=GEMINI).note) <= 300


def test_the_winner_carries_a_human_label(lanes):
    lanes(llama=lane(FROM_LLAMA, after=5), gemini=lane(FROM_GEMINI))

    assert call_race("prompt", SCHEMA, prefer=GEMINI).label == "Gemini (hosted)"


def test_other_names_the_opposite_lane():
    assert other(LLAMA) == GEMINI
    assert other(GEMINI) == LLAMA


# --- through a real agent -----------------------------------------------------
#
# Everything above mocks ``call_race`` out of the picture or drives it directly.
# These two go the whole way - a real agent function, the real race, and only the
# two clients faked - because the seam those tests do not cover is the one that
# was just rewritten: whether an agent still gets its data when the lane it
# prefers is the one that died.


MATCH = {
    "match_score": 61,
    "reasoning": "You match on Django.",
    "matched_skills": ["Django"],
    "missing_skills": ["Kubernetes"],
}


def test_an_agent_gets_its_result_from_whichever_lane_survived(mocker):
    from agents.resume_analyzer import analyze_match

    mocker.patch.dict(
        "agents.race._RUNNERS",
        {
            LLAMA: lane(MATCH, after=0.05),
            GEMINI: lane(AgentError("No Gemini API key is configured")),
        },
    )

    result = analyze_match("Django, five years.", "We need Django and Kubernetes.")

    assert result["match_score"] == 61
    assert result["missing_skills"] == ["Kubernetes"]
    # And the row will say so, rather than presenting it as the usual judgement.
    assert result["model_used"] == LLAMA
    assert "No Gemini API key" in result["race_note"]


def test_an_agent_still_fails_when_both_lanes_do(mocker):
    """The failure path the tasks depend on has to survive the extra machinery."""
    from agents.resume_analyzer import analyze_match

    mocker.patch.dict(
        "agents.race._RUNNERS",
        {LLAMA: lane(AgentError("Cannot reach Ollama")), GEMINI: lane(AgentError("no key"))},
    )

    with pytest.raises(AgentError, match="Neither model could answer"):
        analyze_match("Django, five years.", "We need Django.")
