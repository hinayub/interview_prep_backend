"""The interview API's read and write shapes.

The read shape is deliberately fat. A session detail carries its questions, each
question its answer, and each answer its evaluation, plus the report - because the
client polls this one URL while up to three different agents are working, and the
alternative is one poll per question and a race between them. One request answers
"what should I see right now" completely.

The write shapes are thin for the opposite reason: a client may only ever say
which documents to interview against and what it typed. Everything else is the
agents' to fill in.
"""

from django.conf import settings
from rest_framework import serializers

from evaluations.models import AnswerEvaluation, SessionReport
from resumes.models import JobDescription, MatchAnalysis, Resume

from .models import Answer, InterviewSession, Question


class AnswerEvaluationSerializer(serializers.ModelSerializer):
    class Meta:
        model = AnswerEvaluation
        fields = (
            "id",
            "status",
            "score",
            "verdict",
            "strengths",
            "improvements",
            "model_answer",
            "error_message",
            "created_at",
            "completed_at",
        )
        # Every field is the agent's output. A client sending any of it would only
        # be marking its own homework.
        read_only_fields = fields


class AnswerSerializer(serializers.ModelSerializer):
    """An answer, with its evaluation nested.

    ``question`` is writable and is the only way an answer gets created: the
    endpoint derives the session from it, so a client cannot submit an answer to
    one session's question under another session's id.
    """

    evaluation = AnswerEvaluationSerializer(read_only=True)

    # Declared explicitly for two reasons. The queryset starts empty and is scoped to
    # the requesting candidate in __init__, so a question id from someone else's
    # interview is not a valid input at all. And ``validators=[]`` drops the
    # UniqueValidator DRF derives from the OneToOne: it fires before
    # validate_question and its message ("answer with this question already exists")
    # tells the candidate nothing about what to do next, where ours does.
    question = serializers.PrimaryKeyRelatedField(queryset=Question.objects.none(), validators=[])

    class Meta:
        model = Answer
        fields = ("id", "question", "text", "seconds_taken", "submitted_at", "evaluation")
        read_only_fields = ("id", "submitted_at", "evaluation")

    def validate_question(self, value):
        if value.session.status != InterviewSession.Status.COMPLETE:
            raise serializers.ValidationError(
                "This interview is not ready yet. Wait for the questions to finish generating."
            )

        # OneToOne would raise IntegrityError here, which surfaces as a 500. An
        # answer is a commit and re-answering is not allowed, so say so as a 400.
        if Answer.objects.filter(question=value).exists():
            raise serializers.ValidationError(
                "You have already answered this question. Start a new interview to try again."
            )

        return value

    def validate_text(self, value):
        text = value.strip()
        if len(text) < settings.ANSWER_MIN_CHARS:
            raise serializers.ValidationError(
                f"That is too short to evaluate - give at least "
                f"{settings.ANSWER_MIN_CHARS} characters. Answer as if you were speaking."
            )
        return text

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Without this the field's queryset is empty and nothing validates. With it,
        # a question belonging to another candidate's interview does not exist as far
        # as this serializer is concerned - which is both the access control and the
        # reason the error does not confirm whether that id is real.
        request = self.context.get("request")
        if request is not None and hasattr(request.user, "candidate"):
            self.fields["question"].queryset = Question.objects.filter(
                session__candidate=request.user.candidate
            )


class QuestionSerializer(serializers.ModelSerializer):
    """A question with whatever has happened to it so far.

    ``answer`` is null until submitted, which is exactly what the client needs to
    know to decide where in the interview the candidate is.
    """

    answer = AnswerSerializer(read_only=True)
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Question
        fields = ("id", "order", "text", "category", "category_label", "focus", "answer")
        read_only_fields = fields


def scored_count(session):
    """How many of ``session``'s answers have come back with a score.

    Counted off the prefetched questions rather than with an aggregate, for the same
    reason ``get_answered_count`` is: this runs on the endpoint the client polls.
    """
    return sum(
        1
        for question in session.questions.all()
        if hasattr(question, "answer")
        and hasattr(question.answer, "evaluation")
        and question.answer.evaluation.status == AnswerEvaluation.Status.COMPLETE
    )


class SessionReportSerializer(serializers.ModelSerializer):
    is_stale = serializers.SerializerMethodField()

    class Meta:
        model = SessionReport
        fields = (
            "id",
            "status",
            "overall_score",
            "headline",
            "summary",
            "strengths",
            "priorities",
            "readiness",
            "answers_covered",
            "is_stale",
            "error_message",
            "created_at",
            "completed_at",
        )
        read_only_fields = fields

    def get_is_stale(self, report):
        """True when answers have been *scored* since this report was written.

        The report is a snapshot over ``answers_covered`` answers. Answering more
        afterwards does not invalidate it, but it does make it incomplete, and the
        candidate should be told to re-run rather than left to notice.

        Measured against scored answers rather than all answers because the report
        task deliberately skips any answer whose own evaluation failed or is still
        running. Counting those would flag a report as out of date over an answer that
        a re-run cannot pick up either - offering the candidate a button that clears
        nothing, forever, over one evaluation Gemini refused.
        """
        if report.status != SessionReport.Status.COMPLETE:
            return False
        return scored_count(report.session) > report.answers_covered


class InterviewSessionSerializer(serializers.ModelSerializer):
    """The full session. This is the polling payload.

    Writable on create: ``resume``, ``job_description`` and optionally
    ``match_analysis``. Everything else describes what the agents have done.
    """

    questions = QuestionSerializer(many=True, read_only=True)
    report = SessionReportSerializer(read_only=True)

    # Denormalised so a session names its role the same way every other screen
    # does, without the client refetching two more resources.
    resume_filename = serializers.CharField(source="resume.filename", read_only=True)
    job_title = serializers.CharField(source="job_description.title", read_only=True)
    company = serializers.CharField(source="job_description.company", read_only=True)

    question_count = serializers.SerializerMethodField()
    answered_count = serializers.SerializerMethodField()

    class Meta:
        model = InterviewSession
        fields = (
            "id",
            "resume",
            "resume_filename",
            "job_description",
            "job_title",
            "company",
            "match_analysis",
            "status",
            "error_message",
            "question_count",
            "answered_count",
            "questions",
            "report",
            "created_at",
            "completed_at",
        )
        read_only_fields = (
            "id",
            "resume_filename",
            "job_title",
            "company",
            "status",
            "error_message",
            "question_count",
            "answered_count",
            "questions",
            "report",
            "created_at",
            "completed_at",
        )

    def get_question_count(self, session):
        return len(session.questions.all())

    def get_answered_count(self, session):
        # Counted off the prefetched questions rather than with the model's
        # answered_count property: that issues a query, and this serializer runs on
        # the hottest endpoint in the app.
        return sum(1 for question in session.questions.all() if hasattr(question, "answer"))

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Scope the writable FKs to the requesting candidate, exactly as
        # MatchAnalysisSerializer does - DRF's default "all rows" queryset would
        # otherwise make a stranger's resume a valid thing to interview against.
        request = self.context.get("request")
        if request is not None and hasattr(request.user, "candidate"):
            candidate = request.user.candidate
            self.fields["resume"].queryset = Resume.objects.filter(candidate=candidate)
            self.fields["job_description"].queryset = JobDescription.objects.filter(
                candidate=candidate
            )
            self.fields["match_analysis"].queryset = MatchAnalysis.objects.filter(
                candidate=candidate
            )


class InterviewSessionListSerializer(InterviewSessionSerializer):
    """The list shape: the same session without its questions.

    A candidate's history is a list of sessions, and nesting every question and
    every evaluation into it would make the list payload grow without bound while
    the screen shows one line per row.
    """

    class Meta(InterviewSessionSerializer.Meta):
        fields = tuple(
            field for field in InterviewSessionSerializer.Meta.fields if field != "questions"
        )
