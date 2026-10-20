"""Server-side contract for future official player-delegated racket-provider access.

No provider OAuth endpoint is publicly verified for Playtomic or TiePlayer.
This module is intentionally transport-free and refuses all real sessions,
credentials, availability reads and writes until separate approved work.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
import re

_PROVIDERS = {
    "playtomic": "club_api_is_not_player_oauth",
    "tiesports": "club_open_api_is_not_player_oauth",
}
_REF = re.compile(r"^[a-z][a-z0-9_-]{2,79}$", re.IGNORECASE)


class OfficialProviderGrantRequired(PermissionError):
    """No current provider-issued right to delegate a player's account."""


@dataclass(frozen=True)
class PlayerLinkIntent:
    provider: str
    participant_ref: str
    consent_ref: str
    consent_recorded_at: str
    account_owner_consented: bool
    status: str = "awaiting_official_player_delegation"
    provider_authorized: bool = False
    remote_session_established: bool = False


class PlayerProviderBoundary:
    """Null transport: neither account consent nor club API is OAuth authority."""

    __slots__ = ("provider",)

    def __init__(self, provider: str):
        if provider not in _PROVIDERS:
            raise ValueError("Unknown provider.")
        self.provider = provider

    def create_intent(self, *, participant_ref: str, consent_ref: str,
                      consent_recorded_at: str, owner_consented: bool) -> PlayerLinkIntent:
        if not owner_consented:
            raise ValueError("Explicit owner consent required.")
        if not _REF.fullmatch(participant_ref) or not _REF.fullmatch(consent_ref):
            raise ValueError("Opaque internal references required; no player identity.")
        try:
            parsed = datetime.fromisoformat(consent_recorded_at.replace("Z", "+00:00"))
        except (TypeError, ValueError) as exc:
            raise ValueError("UTC consent timestamp required.") from exc
        if parsed.tzinfo is None or parsed.utcoffset().total_seconds() != 0:
            raise ValueError("UTC consent timestamp required.")
        stamp = parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return PlayerLinkIntent(
            provider=self.provider,
            participant_ref=participant_ref,
            consent_ref=consent_ref,
            consent_recorded_at=stamp,
            account_owner_consented=True,
        )

    @staticmethod
    def capabilities(intent: PlayerLinkIntent) -> dict:
        """Return user-visible capability status, never actual player account data."""
        if not isinstance(intent, PlayerLinkIntent) or intent.provider not in _PROVIDERS:
            raise ValueError("Unsupported intent.")
        return {
            "provider": intent.provider,
            "status": "blocked",
            "reason": "PROVIDER_PLAYER_DELEGATION_UNVERIFIED",
            "owner_consent_recorded": intent.account_owner_consented,
            "provider_authorized": False,
            "can_begin_oauth": False,
            "can_read_availability": False,
            "can_read_private_session": False,
            "can_write_booking": False,
            "provider_account_data": None,
        }

    def begin_oauth(self, *_args, **_kwargs):
        raise OfficialProviderGrantRequired("No verified player OAuth grant.")

    def read_availability(self, *_args, **_kwargs):
        raise OfficialProviderGrantRequired("No authorized player availability endpoint.")

    def open_player_session(self, *_args, **_kwargs):
        raise OfficialProviderGrantRequired("Never reuse a player's private session.")

    def write_booking(self, *_args, **_kwargs):
        raise OfficialProviderGrantRequired("No provider booking write right.")
