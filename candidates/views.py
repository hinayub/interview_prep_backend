from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .serializers import CandidateSerializer, RegisterSerializer


def token_pair(user):
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


class RegisterView(generics.CreateAPIView):
    """POST /api/auth/register/ -> creates User + Candidate, returns a token pair.

    Returning tokens here means the frontend does not have to immediately follow up
    with a login call.
    """

    serializer_class = RegisterSerializer
    permission_classes = (AllowAny,)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        candidate = serializer.save()
        return Response(
            {
                "candidate": CandidateSerializer(candidate).data,
                **token_pair(candidate.user),
            },
            status=status.HTTP_201_CREATED,
        )


class MeView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/candidates/me/ - the current candidate's own profile."""

    serializer_class = CandidateSerializer
    permission_classes = (IsAuthenticated,)

    def get_object(self):
        return self.request.user.candidate
