"""What the hosted model produced: one judgement per answer, one report per session.

Split from ``interviews`` along the line the whole agent layer is split along -
that app holds what the candidate and the local model create, this one holds the
scoring. The dependency runs one way, evaluations -> interviews.

Kept in their own tables rather than as columns on ``Answer`` and
``InterviewSession`` for the same reason ``MatchAnalysis`` is its own table: an
evaluation is a job with its own pending/complete/failed lifecycle, and a nullable
score column on Answer could not say whether a blank meant "not scored yet",
"scoring now" or "scoring failed".
"""

from django.db import models

from interviews.models import AgentJob, Answer, InterviewSession


class AnswerEvaluation(AgentJob):
    """Pass one: one answer, scored on its own as soon as it is submitted.

    Created pending by the answer endpoint and filled in by
    ``evaluations.tasks.run_answer_evaluation``. The candidate is looking at the
    screen when this runs, so it is the latency-sensitive call in the app - which is
    the other reason it is a row and not a held-open request.
    """

    answer = models.OneToOneField(Answer, on_delete=models.CASCADE, related_name="evaluation")

    score = models.PositiveSmallIntegerField(null=True, blank=True)
    verdict = models.TextField(blank=True)
    # Free-text phrases the model wrote about one specific answer. Never queried,
    # never joined on, meaningless outside the evaluation that produced them - the
    # same reasoning as MatchAnalysis.matched_skills.
    strengths = models.JSONField(default=list, blank=True)
    improvements = models.JSONField(default=list, blank=True)
    # How a strong candidate would have answered. The most useful thing on the
    # screen, and the reason a low score is not just a low score.
    model_answer = models.TextField(blank=True)

    class Meta:
        ordering = ("answer__question__order",)

    RESULT_FIELDS = ("score", "verdict", "strengths", "improvements", "model_answer")

    def mark_complete(self, result):
        """Persist a validated evaluator result. ``result`` is already schema-checked."""
        self.score = result["score"]
        self.verdict = result["verdict"]
        self.strengths = result.get("strengths", [])
        self.improvements = result.get("improvements", [])
        self.model_answer = result.get("model_answer", "")
        # ``model_used`` is which model scored the answer; ``model_answer`` just
        # above is the ideal answer it wrote. Adjacent names, unrelated things.
        self._record_race(result)
        self._finish(self.RESULT_FIELDS)

    def reset(self):
        """Put a terminal row back to pending so the answer can be scored again.

        The counterpart to ``SessionReport.reset``, and needed here for a sharper
        reason: an answer is a commit that cannot be resubmitted, so a candidate has
        no way of their own to clear a failed score. Most of what fails at this seam
        is configuration rather than content - an unset API key, a model that was
        retired out from under the deployment - and without this that leaves the
        answer permanently unscored and its session permanently unreportable.
        """
        self.status = self.Status.PENDING
        self.error_message = ""
        self.completed_at = None
        self.score = None
        self.verdict = ""
        self.strengths = []
        self.improvements = []
        self.model_answer = ""
        # Cleared with the rest of it: the re-run races again from scratch and may
        # well land on the other model, so last attempt's attribution is not a
        # prediction of this one's.
        self.model_used = ""
        self.race_note = ""
        self.save(
            update_fields=[
                *self.RESULT_FIELDS,
                *self.RACE_FIELDS,
                "status",
                "error_message",
                "completed_at",
            ]
        )

    def __str__(self):
        return f"{self.answer} - {self.score if self.score is not None else self.status}"


class SessionReport(AgentJob):
    """Pass two: the debrief over a whole rehearsal.

    OneToOne with the session, so requesting a report twice updates one row rather
    than accumulating conflicting debriefs of the same interview. Re-running is
    allowed - a candidate who answers three more questions should be able to ask
    again - and ``reset`` is what puts a finished row back to pending for that.
    """

    class Readiness(models.TextChoices):
        NOT_READY = "not ready", "Not ready"
        NEARLY_READY = "nearly ready", "Nearly ready"
        READY = "ready", "Ready"

    session = models.OneToOneField(
        InterviewSession, on_delete=models.CASCADE, related_name="report"
    )

    overall_score = models.PositiveSmallIntegerField(null=True, blank=True)
    headline = models.CharField(max_length=255, blank=True)
    summary = models.TextField(blank=True)
    strengths = models.JSONField(default=list, blank=True)
    priorities = models.JSONField(default=list, blank=True)
    readiness = models.CharField(max_length=16, choices=Readiness.choices, blank=True)
    # How many answers this report was written over. Stored because the report is a
    # snapshot: answering more questions afterwards makes it stale, and the UI can
    # only say so if it knows what the report actually read.
    answers_covered = models.PositiveSmallIntegerField(default=0)

    RESULT_FIELDS = (
        "overall_score",
        "headline",
        "summary",
        "strengths",
        "priorities",
        "readiness",
        "answers_covered",
    )

    def mark_complete(self, result, answers_covered):
        """Persist a validated report result. ``result`` is already schema-checked."""
        self.overall_score = result["overall_score"]
        self.headline = result["headline"][:255]
        self.summary = result["summary"]
        self.strengths = result.get("strengths", [])
        self.priorities = result.get("priorities", [])
        self.readiness = result.get("readiness", "")
        self.answers_covered = answers_covered
        self._record_race(result)
        self._finish(self.RESULT_FIELDS)

    def reset(self):
        """Put a terminal row back to pending so it can be regenerated.

        The previous result is cleared rather than left in place: showing last
        week's debrief under a "writing…" spinner invites the candidate to read it
        as the new one.
        """
        self.status = self.Status.PENDING
        self.error_message = ""
        self.completed_at = None
        self.overall_score = None
        self.headline = ""
        self.summary = ""
        self.strengths = []
        self.priorities = []
        self.readiness = ""
        self.answers_covered = 0
        self.model_used = ""
        self.race_note = ""
        self.save(
            update_fields=[
                *self.RESULT_FIELDS,
                *self.RACE_FIELDS,
                "status",
                "error_message",
                "completed_at",
            ]
        )

    def __str__(self):
        return f"Report for {self.session_id} ({self.status})"
