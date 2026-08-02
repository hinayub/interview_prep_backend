"""The interview endpoints.

Seven, and four of them start an agent:

    POST   interviews/              start a session -> writes questions (llama)
    GET    interviews/              the candidate's history, without questions
    GET    interviews/<id>/         the polling endpoint: session, questions,
                                    answers, evaluations and report in one read
    POST   interviews/<id>/answers/ submit one answer -> scores it (gemini)
    POST   interviews/<id>/rescore/ retry the scores that failed (gemini)
    POST   interviews/<id>/report/  ask for the debrief -> writes it (gemini)
    GET    interviews/<id>/report/  the report on its own

Every one of them returns immediately. None holds a request open for an LLM.
"""

from django.db.models import Prefetch
from rest_framework import generics, status
from rest_framework.response import Response

from agents.tasks import run_task
from evaluations.models import AnswerEvaluation, SessionReport
from evaluations.tasks import run_answer_evaluation, run_report_build

from .models import Answer, InterviewSession, Question
from .serializers import (
    AnswerSerializer,
    InterviewSessionListSerializer,
    InterviewSessionSerializer,
    SessionReportSerializer,
)
from .tasks import run_question_generation


def session_queryset(candidate):
    """Sessions owned by ``candidate``, loaded for the nested read shape.

    The detail serializer walks session -> questions -> answer -> evaluation. Without
    this prefetch that is a query per question and another per answer; with it the
    whole payload is a fixed handful of queries however many questions there are,
    which matters because this is the endpoint the client polls every two seconds.
    """
    return (
        InterviewSession.objects.filter(candidate=candidate)
        .select_related("resume", "job_description", "report")
        .prefetch_related(
            Prefetch(
                "questions",
                queryset=Question.objects.select_related("answer__evaluation"),
            )
        )
    )


class InterviewSessionListCreateView(generics.ListCreateAPIView):
    """POST starts an interview and returns the pending row; GET lists past ones.

    The 201 body has no questions in it. Generating eight of them on a local 3B
    model takes tens of seconds, so the client takes the id and polls the detail
    endpoint - the same contract as MatchAnalysis.
    """

    # One of the LLM-triggering endpoints the throttle rate in settings exists for.
    # A candidate cannot start twenty interviews an hour by holding the button down.
    throttle_scope = "agents"

    def get_serializer_class(self):
        # The list shape drops the nested questions; the create response keeps the
        # full one so the client can start polling from what it already has.
        return (
            InterviewSessionListSerializer
            if self.request.method == "GET"
            else InterviewSessionSerializer
        )

    def get_queryset(self):
        return session_queryset(self.request.user.candidate)

    def perform_create(self, serializer):
        session = serializer.save(candidate=self.request.user.candidate)
        # Dispatched after save, so the row the task loads is already committed.
        run_task(run_question_generation, session.pk)


class InterviewSessionDetailView(generics.RetrieveAPIView):
    """The polling endpoint. One read answers "what should I see right now"."""

    serializer_class = InterviewSessionSerializer

    def get_queryset(self):
        return session_queryset(self.request.user.candidate)


class AnswerCreateView(generics.CreateAPIView):
    """Submit one answer. Returns the answer with a pending evaluation attached.

    Nested under a session id so the URL reads correctly, but ownership is enforced
    through the ``question`` field in the serializer rather than through the path -
    the path segment is not what makes this safe.
    """

    serializer_class = AnswerSerializer
    throttle_scope = "agents"

    def get_queryset(self):
        return Answer.objects.filter(question__session__candidate=self.request.user.candidate)

    def perform_create(self, serializer):
        answer = serializer.save()

        # The evaluation row is created here rather than inside the task: it is what
        # the client polls, so it has to exist by the time this response is written.
        evaluation = AnswerEvaluation.objects.create(answer=answer)
        run_task(run_answer_evaluation, evaluation.pk)


class SessionRescoreView(generics.GenericAPIView):
    """POST to score every answer in this session whose evaluation failed.

    One button for the session rather than one per answer, because what fails at this
    seam is usually configuration rather than content - an unset key, a retired model
    - and that fails every answer in the session at once.

    Needed at all because an answer cannot be resubmitted: without this the candidate
    has no route back from a failure that had nothing to do with what they wrote, and
    a session whose scores all failed can never produce a debrief either.
    """

    serializer_class = InterviewSessionSerializer
    throttle_scope = "agents"

    def post(self, request, *args, **kwargs):
        session = generics.get_object_or_404(
            session_queryset(request.user.candidate), pk=self.kwargs["pk"]
        )

        # Resolved to a list before anything is reset: the queryset is lazy, and once
        # these rows are pending the filter that found them no longer matches.
        stale = list(
            AnswerEvaluation.objects.filter(
                answer__question__session=session, status=AnswerEvaluation.Status.FAILED
            ).values_list("pk", flat=True)
        )

        if not stale:
            return Response(
                {"detail": "Every answer in this interview has already been scored."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for evaluation in AnswerEvaluation.objects.filter(pk__in=stale):
            evaluation.reset()
            run_task(run_answer_evaluation, evaluation.pk)

        # Re-read rather than reusing the prefetched session above, whose nested
        # evaluations still carry the failures this call just cleared.
        refreshed = generics.get_object_or_404(
            session_queryset(request.user.candidate), pk=self.kwargs["pk"]
        )
        return Response(self.get_serializer(refreshed).data)


class SessionReportView(generics.GenericAPIView):
    """GET the debrief, or POST to (re)write it.

    POST is idempotent while a build is in flight - asking twice does not start two
    Gemini calls - and re-runnable once one has finished, because a candidate who
    answers three more questions should be able to ask again.
    """

    serializer_class = SessionReportSerializer
    throttle_scope = "agents"

    def get_session(self):
        return generics.get_object_or_404(
            session_queryset(self.request.user.candidate), pk=self.kwargs["pk"]
        )

    def get(self, request, *args, **kwargs):
        session = self.get_session()
        report = getattr(session, "report", None)
        if report is None:
            return Response(
                {"detail": "No report has been requested for this interview yet."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(self.get_serializer(report).data)

    def post(self, request, *args, **kwargs):
        session = self.get_session()

        if session.status != InterviewSession.Status.COMPLETE:
            return Response(
                {"detail": "This interview has no questions yet, so there is nothing to report."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        report, created = SessionReport.objects.get_or_create(session=session)

        if not created:
            if not report.is_terminal:
                # Already being written. Hand back the in-flight row rather than
                # dispatching a second call to race the first.
                return Response(self.get_serializer(report).data)
            report.reset()

        run_task(run_report_build, report.pk)
        return Response(
            self.get_serializer(report).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
