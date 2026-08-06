from django.contrib import admin

from .models import Answer, InterviewSession, Question


class QuestionInline(admin.TabularInline):
    """Questions are only ever read here - they are the agent's output."""

    model = Question
    extra = 0
    readonly_fields = ("order", "text", "category", "focus")
    can_delete = False


@admin.register(InterviewSession)
class InterviewSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "candidate", "job_description", "status", "answered_count", "created_at")
    list_filter = ("status", "created_at")
    readonly_fields = ("created_at", "completed_at")
    inlines = (QuestionInline,)


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "session", "order", "category", "focus")
    list_filter = ("category",)
    search_fields = ("text", "focus")


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    list_display = ("id", "question", "seconds_taken", "submitted_at")
    list_filter = ("submitted_at",)
    readonly_fields = ("submitted_at",)
