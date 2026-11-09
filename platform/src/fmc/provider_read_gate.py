"""Fail-closed official Playtomic club-read authorization gate.

The existence of club credentials or a configured connection DOES NOT prove
provider-issued scope. This gate also never authorizes player OAuth, available
slot feeds, provider bookings/writes, or data use beyond approved bookings.
Only a separately enabled deployment with a reviewed grant record can pass.
Source-only in a Draft PR: no environment toggles or real connections enabled.
"""
from __future__ import annotations

from datetime import datetime, timezone
import os
import re

from .common import DomainError

_REF = re.compile(r"^[a-z][a-z0-9_-]{2,79}$", re.IGNORECASE)
_ALLOWED_STREAMS = {"bookings": "bookings.read"}
_ERROR = ("PROVIDER_AUTHORIZATION_REQUIRED", "Official club read is not authorised.", 503)


def _deny():
    raise DomainError(*_ERROR)


def _utc(when):
    if not isinstance(when, str) or not when.endswith("Z"):
        _deny()
    try:
        dt = datetime.fromisoformat(when.replace("Z", "+00:00"))
        if dt.utcoffset().total_seconds() != 0:
            _deny()
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError, OverflowError):
        _deny()


def _opaque(value):
    return isinstance(value, str) and _REF.fullmatch(value) is not None


def review_official_club_read(connection: dict, stream: str, *, now=None) -> dict:
    """Review the internal grant snapshot only; this NEVER permits network IO.

    A DB grant record represents a reviewed internal authorization receipt;
    manual confirmation of the actual external provider agreement remains
    an additional operational prerequisite. Never treat this function alone
    as an independently verified provider entitlement.
    """
    if not isinstance(connection, dict):
        _deny()
    if connection.get("provider") != "playtomic" or connection.get("status") != "configured":
        _deny()
    if stream not in _ALLOWED_STREAMS:
        _deny()
    capabilities = connection.get("capabilities")
    if not isinstance(capabilities, dict) or (
        capabilities.get("official_read_authorized") is not True
        or capabilities.get("write_mode") != "read_sync"
    ):
        _deny()
    config = connection.get("config")
    if not isinstance(config, dict):
        _deny()
    grant = config.get("official_grant")
    if not isinstance(grant, dict):
        _deny()
    if (grant.get("status") != "approved"
        or grant.get("provider") != connection.get("provider")
        or grant.get("authority") != "club_or_certified_partner"
        or grant.get("organization_id") != connection.get("organization_id")
        or grant.get("tenant_id") != config.get("tenant_id")):
        _deny()
    for key in ("agreement_ref", "owner_approval_ref"):
        if not _opaque(grant.get(key)):
            _deny()
    # Reject "all", writes, a string instead of an array, and extra scopes.
    if type(grant.get("scopes")) is not list or grant["scopes"] != [_ALLOWED_STREAMS[stream]]:
        _deny()
    if now is None:
        now = datetime.now(timezone.utc)
    if not isinstance(now, datetime) or now.tzinfo is None:
        _deny()
    instant = now.astimezone(timezone.utc)
    start = _utc(grant.get("approved_at"))
    expiry = _utc(grant.get("expires_at"))
    if not start <= instant < expiry or not start < expiry:
        _deny()
    return {
        "provider": "playtomic",
        "scope": _ALLOWED_STREAMS[stream],
        "organization_id": connection["organization_id"],
        "tenant_id": config["tenant_id"],
        "provider_read_gate": "reviewed_internal_receipt",
        "writes_allowed": False,
        "player_oauth_authorized": False,
        "availability_feed_authorized": False,
    }


def require_official_club_read(connection: dict, stream: str, *, env=None, now=None) -> dict:
    """Mandatory outbound gate: deployment opt-in AND a valid scoped receipt."""
    environment = os.environ if env is None else env
    if environment.get("FMC_OFFICIAL_PROVIDER_READS_ENABLED") != "true":
        _deny()
    return review_official_club_read(connection, stream, now=now)
