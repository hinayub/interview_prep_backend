from django.urls import path

from .views import (
    AnswerCreateView,
    InterviewSessionDetailView,
    InterviewSessionListCreateView,
    SessionReportView,
    SessionRescoreView,
)

urlpatterns = [
    path("interviews/", InterviewSessionListCreateView.as_view(), name="interview-list"),
    path("interviews/<int:pk>/", InterviewSessionDetailView.as_view(), name="interview-detail"),
    path("interviews/<int:pk>/answers/", AnswerCreateView.as_view(), name="interview-answers"),
    path("interviews/<int:pk>/rescore/", SessionRescoreView.as_view(), name="interview-rescore"),
    path("interviews/<int:pk>/report/", SessionReportView.as_view(), name="interview-report"),
]
