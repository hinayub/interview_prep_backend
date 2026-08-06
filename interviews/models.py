"""The rehearsal itself: a session, its questions, and the answers given.

Shape of one run:

    InterviewSession  1 -- n  Question  1 -- 1  Answer  1 -- 1  AnswerEvaluation
                      1 -- 1  SessionReport

The two right-hand models live in the ``evaluations`` app, because they are what
the hosted model produces and this app is what the local one produces. The
dependency runs one way: evaluations imports interviews, never the reverse.

Everything is append-only, like ``Resume`` and ``JobDescription``. Re-taking an
interview is a new session, so "your score went up" stays answerable.
"""

from django.db import models, transaction
from django.utils import timezone

from candidates.models import Candidate
from resumes.models import JobDescription, MatchAnalysis, Resume


class AgentJob(models.Model):
    """The polling contract, as an abstract base.

    Every LLM-backed row in this project is the record of a job: created empty and
    ``pending`` by a request, filled in later by a task, read by a client that
    polls until ``status`` is terminal. ``MatchAnalysis`` established that shape
    before there was a second user of it; question generation, answer evaluation
    and report writing are the other three, so it lives here now.

    Abstract, so each concrete table keeps its own columns and indexes - there is
    no shared table and no join. Subclasses add their own result fields and their
    own ``mark_complete``; what they inherit is the state machine and the guarantee
    that a failure is always *recorded* rather than raised, because a row that
    never goes terminal is a client polling forever.

    It lives in ``interviews`` rather than in ``agents`` because ``agents`` is
    deliberately not a Django app - no models, no migrations - and rather than in a
    new app of its own because one abstract class does not earn one.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETE = "complete", "Complete"
        FAILED = "failed", "Failed"

    TERMINAL_STATUSES = (Status.COMPLETE, Status.FAILED)

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def mark_failed(self, message):
        """Record why the agent could not produce a result.

        Truncated because ``message`` is an exception string that can carry a whole
        model response, and this text is rendered straight into the UI.
        """
        self.status = self.Status.FAILED
        self.error_message = str(message)[:1000]
        self.completed_at = timezone.now()
        self.save(update_fields=["status", "error_message", "completed_at"])

    def _finish(self, result_fields=()):
        """Flip to complete and persist, called by a subclass that has set results."""
        self.status = self.Status.COMPLETE
        self.error_message = ""
        self.completed_at = timezone.now()
        self.save(update_fields=[*result_fields, "status", "error_message", "completed_at"])


class InterviewSession(AgentJob):
    """One practice interview: the questions written for one resume-and-posting pair.

    ``status`` here covers *question generation only* - pending while the local
    model is writing them, complete once they exist. It says nothing about how many
    have been answered, because answers are separate rows with their own lifecycles
    and a session the candidate walked away from half way is not a failed one. "How
    far through am I" is a count, which the serializer derives.

    ``match_analysis`` is optional, and is what makes a session tailored: the gaps
    that analysis found are fed to the question agent so the interview probes what
    this particular application is weak on. Without one the questions still get
    written, just from the two documents alone.
    """

    candidate = models.ForeignKey(
        Candidate, on_delete=models.CASCADE, related_name="interview_sessions"
    )
    resume = models.ForeignKey(Resume, on_delete=models.CASCADE, related_name="interview_sessions")
    job_description = models.ForeignKey(
        JobDescription, on_delete=models.CASCADE, related_name="interview_sessions"
    )
    # SET_NULL, not CASCADE: the analysis is an input to generation, not an owner.
    # Losing it must not delete an interview that has answers in it.
    match_analysis = models.ForeignKey(
        MatchAnalysis,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interview_sessions",
    )

    class Meta:
        ordering = ("-created_at",)

    @property
    def answered_count(self):
        return Answer.objects.filter(question__session=self).count()

    def mark_complete(self, questions):
        """Persist a generated question set and open the session.

        The insert and the status flip share a transaction: a client polling between
        the two would otherwise see a complete session with no questions in it and
        render an empty interview.
        """
        with transaction.atomic():
            Question.objects.bulk_create(
                Question(
                    session=self,
                    order=index,
                    text=question["text"],
                    category=question["category"],
                    focus=question.get("focus", ""),
                )
                for index, question in enumerate(questions, start=1)
            )
            self._finish()

    def __str__(self):
        return f"{self.candidate} - {self.job_description.title} ({self.status})"


class Question(models.Model):
    """One generated question. Immutable once written.

    ``order`` is stored rather than inferred from the primary key: the agent returns
    these in a deliberate mix (see ``agents/question_generator.py``) and the
    interview is taken in that order, which a pk sequence would only coincide with.
    """

    class Category(models.TextChoices):
        TECHNICAL = "technical", "Technical"
        EXPERIENCE = "experience", "Experience"
        BEHAVIOURAL = "behavioural", "Behavioural"
        GAP = "gap", "Gap"

    session = models.ForeignKey(
        InterviewSession, on_delete=models.CASCADE, related_name="questions"
    )
    order = models.PositiveSmallIntegerField()
    text = models.TextField()
    category = models.CharField(
        max_length=16, choices=Category.choices, default=Category.TECHNICAL
    )
    # What the question is probing, as a short label. Shown to the candidate only
    # after they answer - beforehand it would tell them what to say.
    focus = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ("order",)
        # One question per slot per session. Stops a duplicate task dispatch from
        # writing a second, interleaved set into an open session.
        constraints = (
            models.UniqueConstraint(fields=("session", "order"), name="unique_question_order"),
        )

    def __str__(self):
        return f"Q{self.order}: {self.text[:60]}"


class Answer(models.Model):
    """What the candidate said, once.

    OneToOne with its question: submitting is a commit, not a draft to keep
    revising. Scoring a moving target teaches nothing, and the real interview does
    not offer a second attempt either - practising again means a new session.
    """

    question = models.OneToOneField(Question, on_delete=models.CASCADE, related_name="answer")
    text = models.TextField()
    # Self-reported by the client from when the question was first shown. Displayed
    # back, never trusted: it is a rehearsal aid, and timing it server-side would
    # only measure how long the tab was left open.
    seconds_taken = models.PositiveIntegerField(null=True, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("question__order",)

    def __str__(self):
        return f"Answer to {self.question}"
