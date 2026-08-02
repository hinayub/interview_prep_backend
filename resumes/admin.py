from django.contrib import admin

from .models import JobDescription, MatchAnalysis, Resume


@admin.register(Resume)
class ResumeAdmin(admin.ModelAdmin):
    list_display = ("id", "candidate", "filename", "uploaded_at")
    list_filter = ("uploaded_at",)


@admin.register(JobDescription)
class JobDescriptionAdmin(admin.ModelAdmin):
    list_display = ("id", "candidate", "title", "company", "created_at")
    list_filter = ("created_at",)
    search_fields = ("title", "company")


@admin.register(MatchAnalysis)
class MatchAnalysisAdmin(admin.ModelAdmin):
    list_display = ("id", "candidate", "resume", "job_description", "status", "match_score")
    list_filter = ("status", "created_at")
    # Everything here is written by the agent; the admin is for inspecting runs.
    readonly_fields = ("created_at", "completed_at")
