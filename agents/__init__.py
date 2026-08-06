"""LLM-facing service layer.

Not a Django app - no models, no migrations. Just service functions, each doing
one job and returning validated JSON rather than raw model text.

Two model backends:

    ollama_client.py      call_llama  - local Llama 3. Cheap, private, unlimited.
    gemini_client.py      call_gemini - hosted Gemini. Better judgement, costs money.

Both present the same contract - prompt and schema in, schema-valid dict out,
``AgentError`` on anything else - which is what lets a third client sit on top of
them and ask them both at once:

    race.py               call_race   - one prompt, both models, keep the first
                                        valid answer; a failure just loses the race.

So every job runs on both, and what each job declares is which answer it would
rather have when both arrive. Generation from documents in hand prefers local;
judging a person's answer and writing the report they take away prefers hosted:

    resume_analyzer.py    prefer gemini -> {match_score, reasoning, matched/missing_skills}
    question_generator.py prefer llama  -> {questions: [{text, category, focus}]}
    evaluator.py          prefer gemini -> per-answer scores, then one report over them

Each returns its result plus ``model_used`` and ``race_note`` saying which model
actually produced it and why, because a candidate reading a score is entitled to
know which model wrote it. The owning row stores both.

The preference used to be the whole story - one job, one backend - and the cost of
that was that each feature needed exactly one backend to be healthy: no
``GEMINI_API_KEY`` meant no scoring at all, a stopped ``ollama serve`` meant no
interview at all. Racing keeps the preference and drops that dependency. Set
``AGENT_RACE=False`` to go back to one model per job.
"""


class AgentError(Exception):
    """An LLM call failed, or returned JSON that did not match its schema.

    Raised after the client's internal retry. Callers are expected to catch this
    and record it on the owning row's ``error_message`` so the polling endpoint
    can report ``status="failed"`` instead of hanging on ``pending`` forever.
    """
