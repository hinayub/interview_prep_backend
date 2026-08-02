"""LLM-facing service layer.

Not a Django app - no models, no migrations. Just service functions, each doing
one job and returning validated JSON rather than raw model text.

Two model backends, and which one a job runs on is a deliberate split rather than
a fallback chain:

    ollama_client.py      call_llama  - local Llama 3. Cheap, private, unlimited.
    gemini_client.py      call_gemini - hosted Gemini. Better judgement, costs money.

Generation from documents already in hand goes local; judging a person's answer
and writing the report they take away goes hosted:

    resume_analyzer.py    llama  -> {match_score, reasoning, matched/missing_skills}
    question_generator.py llama  -> [{text, category, focus}]
    evaluator.py          gemini -> per-answer scores, then one report over them

Both clients present the same contract - prompt and schema in, schema-valid dict
out, ``AgentError`` on anything else - so the modules above do not have to care
which one they are calling, and moving a job between them is a one-line change.
"""


class AgentError(Exception):
    """An LLM call failed, or returned JSON that did not match its schema.

    Raised after the client's internal retry. Callers are expected to catch this
    and record it on the owning row's ``error_message`` so the polling endpoint
    can report ``status="failed"`` instead of hanging on ``pending`` forever.
    """
