"""Internal provenance of a scoped club booking read, never free inventory.

This receipt records an internally reviewed permission snapshot, not an
independent provider agreement, current permission or pilot activation GO.
Only bounded, whitelisted evidence is returned; no credentials or raw records.
"""
from datetime import datetime, timezone
import hashlib
import json
import re

from .common import DomainError
from .provider_page_budget import read_page_state, next_page_state, PageBudgetError
from .provider_read_gate import require_official_club_read

_ID = re.compile(r"^[A-Za-z0-9_-]{3,80}$")
_GRANT_FIELDS = ("provider", "status", "authority", "organization_id", "tenant_id",
                 "agreement_ref", "owner_approval_ref", "scopes", "approved_at", "expires_at")


def _sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=True, allow_nan=False).encode("utf-8")).hexdigest()


def booking_page_receipt(connection, connection_id, page_state, response, *, observed_at=None):
    observed_at = datetime.now(timezone.utc) if observed_at is None else observed_at
    # Recheck expiry/opt-in after the page returns, before projecting any data.
    # This is still the fetched connection snapshot, not an in-flight revoke bus.
    permission = require_official_club_read(connection, "bookings", now=observed_at)
    try:
        for value in (connection_id, permission["organization_id"]):
            if not isinstance(value, str) or not _ID.fullmatch(value):
                raise ValueError()
        if "id" in connection and connection["id"] != connection_id:
            raise ValueError()
        state = read_page_state({"progress": page_state},
                                page_state["window_start"], page_state["window_end"])
        next_page_state(state, response)
        records = response["records"]
        if len(records) > 200 or any(not isinstance(record, dict) for record in records):
            raise ValueError()
        grant = connection["config"]["official_grant"]
        permission_hash = _sha256({key: grant[key] for key in _GRANT_FIELDS})
        records_hash = _sha256(records)
    except (KeyError, TypeError, ValueError, PageBudgetError):
        raise DomainError("PROVIDER_PROVENANCE", "Invalid scoped booking-read provenance.", 502) from None
    return {
        "policy_version": "provider-bookings-provenance/v1",
        "provider": "playtomic", "organization_id": permission["organization_id"],
        "provider_connection_id": connection_id, "scope": "bookings.read",
        "permission_evidence": "reviewed_internal_receipt",
        "permission_receipt_sha256": permission_hash,
        "permission_approved_at": grant["approved_at"],
        "permission_expires_at": grant["expires_at"],
        "observed_at": observed_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source_kind": "booking_events", "window_start": state["window_start"],
        "window_end": state["window_end"], "page": state["page"],
        "records_count": len(records), "records_sha256": records_hash,
        "record_fingerprints": [_sha256(record) for record in records],
        "export_final_page": not response["has_more"],
        "availability_feed_authorized": False, "can_display_available_slots": False,
        "writes_authorized": False,
    }
