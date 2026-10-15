"""Offline-only signed provider events and Core-to-Offer shadow evidence.

No webhook ingress, real provider writes, live sends, fee accrual or settlement.
A signed provider event proves only possession of the configured key. A matching
tracking token / booking slot is an observed association, NOT a causal receipt.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import re
import uuid


class EvidenceRejected(ValueError):
    """Fail-closed validation; do not expose raw payloads or secrets."""


@dataclass(frozen=True)
class SignedOfflineEvent:
    organization_id: str
    connection_id: str
    provider: str
    event_id: str
    sequence: int
    booking_reference: str
    state: str
    occurred_at: datetime
    signed_at: datetime
    event_key: str
    payload_sha256: str


def _uuid(value: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise EvidenceRejected("INVALID_ID") from None


def _pairs_unique(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceRejected("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def verify_offline_provider_event(*, payload: bytes, signature_hex: str,
                                  signed_epoch: int, secret: str,
                                  expected_organization_id: str,
                                  expected_connection_id: str,
                                  expected_provider: str,
                                  now: datetime, replay_seconds: int = 300
                                  ) -> SignedOfflineEvent:
    """Fixture-only v1 HMAC-SHA256 signed timestamp + '.' + unmodified bytes.

    expected_* are resolved from trusted adapter configuration, not payload.
    No network listener, database writer, or credential retrieval is registered.
    """
    if not isinstance(payload, bytes) or not 0 < len(payload) <= 131072:
        raise EvidenceRejected("PAYLOAD_SIZE")
    if not isinstance(secret, str) or len(secret.encode("utf-8")) < 16:
        raise EvidenceRejected("KEY_NOT_CONFIGURED")
    if not isinstance(signature_hex, str) or re.fullmatch(r"[0-9a-fA-F]{64}", signature_hex) is None:
        raise EvidenceRejected("INVALID_SIGNATURE")
    if type(signed_epoch) is not int or not isinstance(now, datetime) or now.tzinfo is None:
        raise EvidenceRejected("INVALID_TIMESTAMP")
    if not 30 <= replay_seconds <= 900:
        raise EvidenceRejected("INVALID_REPLAY_POLICY")
    signed = datetime.fromtimestamp(signed_epoch, tz=timezone.utc)
    if abs((now.astimezone(timezone.utc) - signed).total_seconds()) > replay_seconds:
        raise EvidenceRejected("EXPIRED_OR_FUTURE_SIGNATURE")
    mac = hmac.new(secret.encode("utf-8"),
                   str(signed_epoch).encode("ascii") + b"." + payload,
                   hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature_hex.lower(), mac):
        raise EvidenceRejected("INVALID_SIGNATURE")
    try:
        body = json.loads(payload.decode("utf-8"), object_pairs_hook=_pairs_unique)
    except EvidenceRejected:
        raise
    except (ValueError, UnicodeError, TypeError):
        raise EvidenceRejected("INVALID_JSON") from None
    if not isinstance(body, dict) or set(body) != {
        "schema_version", "organization_id", "connection_id", "provider",
        "event_id", "sequence", "booking_reference", "state", "occurred_at"
    } or type(body["schema_version"]) is not int or body["schema_version"] != 1:
        raise EvidenceRejected("UNSUPPORTED_EVENT_SCHEMA")
    org, conn = _uuid(expected_organization_id), _uuid(expected_connection_id)
    if _uuid(body["organization_id"]) != org or _uuid(body["connection_id"]) != conn:
        raise EvidenceRejected("TENANT_OR_SOURCE_MISMATCH")
    if body["provider"] != expected_provider or not re.fullmatch(r"[a-z][a-z0-9_-]{1,49}", expected_provider):
        raise EvidenceRejected("TENANT_OR_SOURCE_MISMATCH")
    if type(body["sequence"]) is not int or body["sequence"] < 1:
        raise EvidenceRejected("INVALID_SEQUENCE")
    if not isinstance(body["event_id"], str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", body["event_id"]):
        raise EvidenceRejected("INVALID_EVENT_ID")
    if not isinstance(body["booking_reference"], str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", body["booking_reference"]):
        raise EvidenceRejected("INVALID_BOOKING_REFERENCE")
    if body["state"] not in ("pending", "confirmed", "cancelled", "refunded", "failed"):
        raise EvidenceRejected("INVALID_STATE")
    try:
        occurred = datetime.fromisoformat(body["occurred_at"].replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError):
        raise EvidenceRejected("INVALID_EVENT_TIME") from None
    if occurred.tzinfo is None or occurred > signed.replace(microsecond=0):
        raise EvidenceRejected("INVALID_EVENT_TIME")
    identity = "\x1f".join((org, conn, expected_provider, body["event_id"]))
    return SignedOfflineEvent(
        organization_id=org, connection_id=conn, provider=expected_provider,
        event_id=body["event_id"], sequence=body["sequence"],
        booking_reference=body["booking_reference"], state=body["state"],
        occurred_at=occurred, signed_at=signed,
        event_key=hashlib.sha256(identity.encode()).hexdigest(),
        payload_sha256=hashlib.sha256(payload).hexdigest(),
    )


def replay_decision(current: SignedOfflineEvent, *,
                    previous_event: SignedOfflineEvent | None,
                    last_sequence: int) -> str:
    """Use with a durable unique event-key + sequence ledger, never alone."""
    if previous_event is not None and previous_event.event_key == current.event_key:
        return ("duplicate" if previous_event.payload_sha256 == current.payload_sha256
                else "event_id_conflict")
    if last_sequence >= current.sequence:
        return "stale_or_reordered"
    return "accepted_shadow"


def build_shadow_offer_link(booking: dict, offer: dict, supplied_token: str,
                            booking_snapshot_key: str) -> dict:
    """Bounded observed association; only real Core booking identity is accepted.

    A bearer tracking token alone, a Null Adapter event, and a matching slot
    never establish causal attribution or grant financial maturity.
    """
    if _uuid(booking["organization_id"]) != _uuid(offer["organization_id"]):
        raise EvidenceRejected("CROSS_TENANT")
    if _uuid(booking["court_id"]) != _uuid(offer["target_court_id"]):
        raise EvidenceRejected("SLOT_MISMATCH")
    if booking["starts_at"] != offer["target_starts_at"] or booking["ends_at"] != offer["target_ends_at"]:
        raise EvidenceRejected("SLOT_MISMATCH")
    if booking["currency"] != offer["currency"]:
        raise EvidenceRejected("CURRENCY_MISMATCH")
    if not isinstance(supplied_token, str) or not hmac.compare_digest(
        hashlib.sha256(supplied_token.encode()).digest(),
        hashlib.sha256(str(offer["tracking_token"]).encode()).digest()
    ):
        raise EvidenceRejected("TOKEN_MISMATCH")
    if not re.fullmatch(r"[0-9a-f]{64}", booking_snapshot_key):
        raise EvidenceRejected("BOOKING_SNAPSHOT_REQUIRED")
    native = booking["source"] in ("fmc", "getacourt")
    confirmed = booking["status"] == "confirmed"
    outcome = "observed_match" if native and confirmed else "ambiguous"
    identity = "\x1f".join((str(booking["id"]), str(offer["id"]), booking_snapshot_key))
    return {
        "event_key": hashlib.sha256(identity.encode()).hexdigest(),
        "booking_snapshot_key": booking_snapshot_key,
        "tracking_digest": hashlib.sha256(supplied_token.encode()).hexdigest(),
        "outcome": outcome,
        "causal_evidence_verified": False,
        "fee_minor": 0,
        "billable": False,
        "authority": "core_snapshot_only" if native else "provider_unverified",
    }
