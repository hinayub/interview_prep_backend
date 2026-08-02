from django.contrib import admin

from .models import AnswerEvaluation, SessionReport


@admin.register(AnswerEvaluation)
class AnswerEvaluationAdmin(admin.ModelAdmin):
    list_display = ("id", "answer", "status", "score", "created_at")
    list_filter = ("status", "created_at")
    # Everything here is written by the hosted model; the admin is for inspecting runs.
    readonly_fields = ("created_at", "completed_at")


@admin.register(SessionReport)
class SessionReportAdmin(admin.ModelAdmin):
    list_display = ("id", "session", "status", "overall_score", "readiness", "answers_covered")
    list_filter = ("status", "readiness", "created_at")
    readonly_fields = ("created_at", "completed_at")
