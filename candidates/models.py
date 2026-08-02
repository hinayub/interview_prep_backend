
from django.contrib.auth.models import User
from django.db import models


class Candidate(models.Model):
    """A user's profile. One per User, created atomically at registration.

    Every other model in this project hangs off Candidate rather than User, so the
    per-candidate history aggregation in Phase 7 has a single owner to filter on.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="candidate")
    phone = models.CharField(max_length=32, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.user.username
