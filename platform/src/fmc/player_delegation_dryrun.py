"""Transport-free player delegation protocol rehearsal.

An official provider-issued player OAuth endpoint is UNVERIFIED. This module
prepares and consumes *synthetic* PKCE/state transactions without redirect,
token exchange, provider request, persistence or exposed verifier. A player's
consent does NOT grant provider authorization. Not wired into any HTTP route.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading

DRY_RUN_CALLBACK = "https://getacourt.example.invalid/provider-callback"
_SUPPORTED = frozenset(("playtomic", "tiesports"))
_OPAQUE = re.compile(r"^[a-z][a-z0-9_-]{2,79}$", re.IGNORECASE)
_SCOPE = "availability.read"
_TTL_SECONDS = 300
_MAX_PENDING = 256


class DryRunDenied(PermissionError):
    """The synthetic handshake has no grant or is invalid/expired."""


def _timestamp(value: int) -> int:
    if type(value) is not int or not 0 <= value <= 4102444800:
        raise ValueError("Bounded UTC epoch seconds required.")
    return value


def _opaque(value: str) -> bool:
    return isinstance(value, str) and _OPAQUE.fullmatch(value) is not None


class PlayerDelegationDryRun:
    """One-use ephemeral mock state; zero real provider authority."""

    __slots__ = ("_pending", "_lock")

    def __init__(self) -> None:
        self._pending: dict[str, tuple] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _state_key(value: str) -> str:
        if not isinstance(value, str) or not 32 <= len(value) <= 200 or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise DryRunDenied("Unknown synthetic state.")
        return hashlib.sha256(value.encode("ascii")).hexdigest()

    def start(self, *, provider: str, subject_ref: str, consent_ref: str,
              scope: str, consented: bool, now: int, callback: str) -> dict:
        timestamp = _timestamp(now)
        if provider not in _SUPPORTED:
            raise ValueError("Unknown provider.")
        if scope != _SCOPE:
            raise DryRunDenied("Provider scope not authorized.")
        if consented is not True:
            raise DryRunDenied("Explicit owner consent required.")
        if not _opaque(subject_ref) or not _opaque(consent_ref):
            raise ValueError("Only opaque internal references permitted.")
        if callback != DRY_RUN_CALLBACK:
            raise DryRunDenied("Synthetic callback origin only.")
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        key = self._state_key(state)
        with self._lock:
            expired = [k for k, record in self._pending.items() if record[4] <= timestamp]
            for k in expired:
                del self._pending[k]
            if len(self._pending) >= _MAX_PENDING:
                raise DryRunDenied("Synthetic test capacity reached.")
            # Verifier stays memory-only and is erased with the transaction.
            self._pending[key] = (provider, subject_ref, consent_ref, timestamp, timestamp + _TTL_SECONDS, verifier)
        return {
            "mode": "synthetic_only",
            "status": "provider_grant_not_verified",
            "provider": provider,
            "scope": scope,
            "state": state,
            "challenge": challenge,
            "challenge_method": "S256",
            "callback": DRY_RUN_CALLBACK,
            "expires_at_epoch": timestamp + _TTL_SECONDS,
            "authorize_url": None,
            "provider_authorized": False,
            "can_read_availability": False,
            "can_write_booking": False,
        }

    def consume(self, *, state: str, provider: str, subject_ref: str,
                consent_ref: str, now: int) -> dict:
        timestamp = _timestamp(now)
        key = self._state_key(state)
        with self._lock:
            record = self._pending.get(key)
            if record is None:
                raise DryRunDenied("Unknown or replayed synthetic state.")
            expected_provider, expected_subject, expected_consent, issued_at, expires, _verifier = record
            if timestamp < issued_at:
                raise DryRunDenied("Synthetic callback chronology invalid.")
            if timestamp >= expires:
                del self._pending[key]
                raise DryRunDenied("Synthetic state expired.")
            if not (isinstance(provider, str) and
                    hmac.compare_digest(provider, expected_provider) and
                    isinstance(subject_ref, str) and
                    hmac.compare_digest(subject_ref, expected_subject) and
                    isinstance(consent_ref, str) and
                    hmac.compare_digest(consent_ref, expected_consent)):
                raise DryRunDenied("Synthetic state binding mismatch.")
            # One-use even though the only possible result is no authorization.
            del self._pending[key]
        return {
            "mode": "synthetic_only",
            "status": "blocked",
            "reason": "OFFICIAL_PROVIDER_GRANT_REQUIRED",
            "provider": provider,
            "provider_authorized": False,
            "token_exchanged": False,
            "real_callback_processed": False,
            "provider_data_read": False,
            "can_read_availability": False,
            "can_write_booking": False,
        }

    def cancel(self, *, state: str, subject_ref: str, now: int) -> bool:
        timestamp = _timestamp(now)
        key = self._state_key(state)
        with self._lock:
            record = self._pending.get(key)
            if record is None or timestamp >= record[4]:
                self._pending.pop(key, None)
                raise DryRunDenied("Unknown or expired synthetic state.")
            if timestamp < record[3]:
                raise DryRunDenied("Synthetic cancellation chronology invalid.")
            if not isinstance(subject_ref, str) or not hmac.compare_digest(subject_ref, record[1]):
                raise DryRunDenied("Synthetic state owner mismatch.")
            del self._pending[key]
        return True

    def active_count(self) -> int:
        with self._lock:
            return len(self._pending)

    def public_status(self) -> dict:
        return {"mode": "synthetic_only", "active_pending": self.active_count(),
                "provider_authorized": False, "external_connections": 0}
