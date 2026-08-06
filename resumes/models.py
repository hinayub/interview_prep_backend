from django.db import models
from django.utils import timezone

from candidates.models import Candidate


class Resume(models.Model):
    """An uploaded CV plus its extracted plain text.

    ForeignKey, not OneToOne: re-uploading is an INSERT, never an UPDATE. The whole
    history feature depends on old rows surviving.
    """

    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name="resumes")
    file = models.FileField(upload_to="resumes/%Y/%m/")
    parsed_text = models.TextField()
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-uploaded_at",)

    @property
    def filename(self):
        return self.file.name.rsplit("/", 1)[-1]

    def __str__(self):
        return f"{self.candidate} - {self.filename}"


class JobDescription(models.Model):
    """A target role, pasted as text. Also append-only."""

    candidate = models.ForeignKey(
        Candidate, on_delete=models.CASCADE, related_name="job_descriptions"
    )
    title = models.CharField(max_length=255)
    company = models.CharField(max_length=255, blank=True)
    raw_text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.title} @ {self.company}" if self.company else self.title


class MatchAnalysis(models.Model):
    """One resume scored against one job description by the matching agent.

    Created empty with ``status=PENDING`` by the endpoint, filled in later by
    ``resumes.tasks.run_match_analysis`` running under whichever task runner is
    configured. The row *is* the job record: the frontend polls the detail
    endpoint and reads ``status`` rather than holding a request open for the
    length of an LLM call.

    Denormalised ``candidate`` FK: every other model scopes on candidate, and
    reaching it through ``resume.candidate`` would mean a join on the hottest
    query in the app (the polling GET).
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETE = "complete", "Complete"
        FAILED = "failed", "Failed"

    TERMINAL_STATUSES = (Status.COMPLETE, Status.FAILED)

    candidate = models.ForeignKey(
        Candidate, on_delete=models.CASCADE, related_name="match_analyses"
    )
    resume = models.ForeignKey(Resume, on_delete=models.CASCADE, related_name="match_analyses")
    job_description = models.ForeignKey(
        JobDescription, on_delete=models.CASCADE, related_name="match_analyses"
    )

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    # Which model produced this score, and how it won - see agents/race.py. Mirrors
    # the pair on ``interviews.AgentJob``; this table predates that base class and
    # still carries its own copy of the state machine.
    model_used = models.CharField(max_length=16, blank=True)
    race_note = models.CharField(max_length=300, blank=True)
    match_score = models.PositiveSmallIntegerField(null=True, blank=True)
    reasoning = models.TextField(blank=True)
    # JSONField rather than a related Skill table: these are free-text strings a
    # 3B model invented, they are never queried or joined on, and they only ever
    # make sense in the context of the one analysis that produced them.
    matched_skills = models.JSONField(default=list, blank=True)
    missing_skills = models.JSONField(default=list, blank=True)
    error_message = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        verbose_name_plural = "match analyses"

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def mark_complete(self, result):
        """Persist a validated analyzer result. ``result`` is already schema-checked."""
        self.status = self.Status.COMPLETE
        self.match_score = result["match_score"]
        self.reasoning = result["reasoning"]
        self.matched_skills = result.get("matched_skills", [])
        self.missing_skills = result.get("missing_skills", [])
        # Blank when absent rather than required: fixtures and tests build result
        # dicts by hand, and an unattributed score is not a broken one.
        self.model_used = (result.get("model_used") or "")[:16]
        self.race_note = (result.get("race_note") or "")[:300]
        self.error_message = ""
        self.completed_at = timezone.now()
        self.save(
            update_fields=[
                "status",
                "match_score",
                "reasoning",
                "matched_skills",
                "missing_skills",
                "model_used",
                "race_note",
                "error_message",
                "completed_at",
            ]
        )

    def mark_failed(self, message):
        """Record why the agent could not produce a result.

        Truncated because ``message`` is an exception string that can carry a
        whole model response, and this text is rendered straight into the UI.
        """
        self.status = self.Status.FAILED
        self.error_message = str(message)[:1000]
        self.completed_at = timezone.now()
        self.save(update_fields=["status", "error_message", "completed_at"])

    def __str__(self):
        return f"{self.resume.filename} vs {self.job_description.title} ({self.status})"
