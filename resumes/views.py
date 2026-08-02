from rest_framework import generics
from rest_framework.parsers import FormParser, MultiPartParser

from agents.tasks import run_task

from .models import JobDescription, MatchAnalysis, Resume
from .serializers import JobDescriptionSerializer, MatchAnalysisSerializer, ResumeSerializer
from .tasks import run_match_analysis


class CandidateScopedListCreateView(generics.ListCreateAPIView):
    """List/create rows owned by the requesting candidate only.

    Scoping in get_queryset rather than per-view filtering is what stops one
    candidate reading another's uploads - there is no unscoped queryset anywhere.
    """

    def get_queryset(self):
        return self.model.objects.filter(candidate=self.request.user.candidate)

    def perform_create(self, serializer):
        serializer.save(candidate=self.request.user.candidate)


class ResumeListCreateView(CandidateScopedListCreateView):
    model = Resume
    serializer_class = ResumeSerializer
    parser_classes = (MultiPartParser, FormParser)


class ResumeDetailView(generics.RetrieveAPIView):
    serializer_class = ResumeSerializer

    def get_queryset(self):
        return Resume.objects.filter(candidate=self.request.user.candidate)


class JobDescriptionListCreateView(CandidateScopedListCreateView):
    model = JobDescription
    serializer_class = JobDescriptionSerializer


class JobDescriptionDetailView(generics.RetrieveAPIView):
    serializer_class = JobDescriptionSerializer

    def get_queryset(self):
        return JobDescription.objects.filter(candidate=self.request.user.candidate)


class MatchAnalysisListCreateView(CandidateScopedListCreateView):
    """POST starts an analysis and returns immediately; GET lists past ones.

    The 201 body is the pending row, not the result. An LLM call takes tens of
    seconds on a 3B CPU model, which is longer than any sane HTTP timeout, so
    the client takes the id and polls the detail endpoint.
    """

    model = MatchAnalysis
    serializer_class = MatchAnalysisSerializer

    def get_queryset(self):
        return super().get_queryset().select_related("resume", "job_description")

    def perform_create(self, serializer):
        analysis = serializer.save(candidate=self.request.user.candidate)
        # Dispatched after save, so the row the task loads is already committed.
        run_task(run_match_analysis, analysis.pk)


class MatchAnalysisDetailView(generics.RetrieveAPIView):
    """The polling endpoint. Cheap on purpose - one indexed read, no joins needed."""

    serializer_class = MatchAnalysisSerializer

    def get_queryset(self):
        return MatchAnalysis.objects.filter(
            candidate=self.request.user.candidate
        ).select_related("resume", "job_description")
