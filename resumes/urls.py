from django.urls import path

from .views import (
    JobDescriptionDetailView,
    JobDescriptionListCreateView,
    MatchAnalysisDetailView,
    MatchAnalysisListCreateView,
    ResumeDetailView,
    ResumeListCreateView,
)

urlpatterns = [
    path("resumes/", ResumeListCreateView.as_view(), name="resume-list"),
    path("resumes/<int:pk>/", ResumeDetailView.as_view(), name="resume-detail"),
    path("job-descriptions/", JobDescriptionListCreateView.as_view(), name="jd-list"),
    path("job-descriptions/<int:pk>/", JobDescriptionDetailView.as_view(), name="jd-detail"),
    path("match-analyses/", MatchAnalysisListCreateView.as_view(), name="match-list"),
    path("match-analyses/<int:pk>/", MatchAnalysisDetailView.as_view(), name="match-detail"),
]
