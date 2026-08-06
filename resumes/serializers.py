from pathlib import Path

from django.conf import settings
from rest_framework import serializers

from .models import JobDescription, MatchAnalysis, Resume
from .parsers import ParseError, UnsupportedFileType, extract_text


class ResumeSerializer(serializers.ModelSerializer):
    filename = serializers.CharField(read_only=True)

    class Meta:
        model = Resume
        fields = ("id", "filename", "file", "parsed_text", "uploaded_at")
        read_only_fields = ("id", "filename", "parsed_text", "uploaded_at")
        extra_kwargs = {"file": {"write_only": True}}

    def validate_file(self, value):
        suffix = Path(value.name).suffix.lower()
        if suffix not in settings.RESUME_ALLOWED_EXTENSIONS:
            allowed = ", ".join(settings.RESUME_ALLOWED_EXTENSIONS)
            raise serializers.ValidationError(f"Unsupported file type '{suffix}'. Allowed: {allowed}")

        if value.size > settings.RESUME_MAX_BYTES:
            limit_mb = settings.RESUME_MAX_BYTES // (1024 * 1024)
            raise serializers.ValidationError(f"File is too large. Maximum size is {limit_mb} MB.")

        return value

    def validate(self, attrs):
        # Parse during validation, not in create(): a resume we cannot read must be
        # a 400 with a usable message, never a saved row with empty parsed_text
        # that silently produces a garbage match score in Phase 3.
        try:
            text = extract_text(attrs["file"])
        except UnsupportedFileType as exc:
            raise serializers.ValidationError({"file": str(exc)}) from exc
        except ParseError as exc:
            raise serializers.ValidationError({"file": str(exc)}) from exc

        if len(text) < settings.RESUME_MIN_PARSED_CHARS:
            raise serializers.ValidationError(
                {
                    "file": (
                        "Almost no text could be extracted from this file "
                        f"({len(text)} characters). If it is a scanned or "
                        "image-only PDF, please upload a text-based version."
                    )
                }
            )

        attrs["parsed_text"] = text
        return attrs


class JobDescriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobDescription
        fields = ("id", "title", "company", "raw_text", "created_at")
        read_only_fields = ("id", "created_at")

    def validate_raw_text(self, value):
        if len(value.strip()) < settings.RESUME_MIN_PARSED_CHARS:
            raise serializers.ValidationError(
                "Please paste the full job description - this is too short to analyse."
            )
        return value.strip()


class MatchAnalysisSerializer(serializers.ModelSerializer):
    """Read/write both directions of the polling contract.

    Writable: ``resume`` and ``job_description`` ids. Everything else is filled
    in by the agent, so the client sending it would only be lying to itself.
    """

    resume_filename = serializers.CharField(source="resume.filename", read_only=True)
    job_title = serializers.CharField(source="job_description.title", read_only=True)
    # Denormalised alongside the title so a saved analysis names the role the same
    # way the rest of the app does, without the client refetching the JD.
    company = serializers.CharField(source="job_description.company", read_only=True)

    class Meta:
        model = MatchAnalysis
        fields = (
            "id",
            "resume",
            "resume_filename",
            "job_description",
            "job_title",
            "company",
            "status",
            "match_score",
            "reasoning",
            "matched_skills",
            "missing_skills",
            "error_message",
            "created_at",
            "completed_at",
        )
        read_only_fields = (
            "id",
            "company",
            "status",
            "match_score",
            "reasoning",
            "matched_skills",
            "missing_skills",
            "error_message",
            "created_at",
            "completed_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Scope the FK querysets to the requesting candidate. Without this, DRF's
        # default "all rows" queryset makes an id from someone else's account a
        # valid input, and the analysis would quietly read their resume text.
        request = self.context.get("request")
        if request is not None and hasattr(request.user, "candidate"):
            candidate = request.user.candidate
            self.fields["resume"].queryset = Resume.objects.filter(candidate=candidate)
            self.fields["job_description"].queryset = JobDescription.objects.filter(
                candidate=candidate
            )
