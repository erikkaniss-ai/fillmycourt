"""Read-only pilot evidence review. No provider access, repair, backfill or GO.

Receipt consistency is separate from provider entitlement and live readiness.
The caller must supply an explicit freshness limit; no provider SLA is inferred.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import re
from uuid import UUID

from sqlalchemy import text

from .common import DomainError
from .provider_read_gate import review_official_club_read
from .provider_read_provenance import _GRANT_FIELDS, _sha256

_HASH = re.compile(r"^[0-9a-f]{64}$")
_FIELDS = frozenset("""policy_version provider organization_id provider_connection_id scope
    permission_evidence permission_receipt_sha256 permission_approved_at permission_expires_at
    observed_at source_kind window_start window_end page records_count records_sha256
    record_fingerprints export_final_page availability_feed_authorized
    can_display_available_slots writes_authorized""".split())


def _clock(now, max_age_seconds):
    if (not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None
        or type(max_age_seconds) is not int or not 1 <= max_age_seconds <= 365 * 86400):
        raise DomainError("PROVENANCE_REVIEW_INPUT", "Aware review time and explicit positive freshness limit required.", 422)
    return now.astimezone(timezone.utc)


def _utc(value):
    if isinstance(value, str):
        if not value.endswith("Z"): raise ValueError()
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError()
    return value.astimezone(timezone.utc)


def _result(status):
    return {"status": status, "pilot_ready": False, "provider_requests_allowed": False,
            "can_display_available_slots": False}


def _reference(booking):
    metadata = booking.get("metadata")
    provenance = metadata.get("provenance") if isinstance(metadata, dict) else None
    value = provenance.get("read_receipt_fingerprint") if isinstance(provenance, dict) else None
    return value if isinstance(value, str) and _HASH.fullmatch(value) else None


def _record_references(payload):
    values = payload.get("record_fingerprints") if isinstance(payload, dict) else None
    if not isinstance(values, list) or len(values) > 200:
        return set()
    return {fp for fp in values if isinstance(fp, str) and _HASH.fullmatch(fp)}


def review_booking_provenance(booking, receipt, connection, *, now, max_age_seconds, record_fingerprints):
    """Validate accessible evidence; return fixed statuses without private payloads."""
    now = _clock(now, max_age_seconds)
    org, pc = connection["organization_id"], connection["id"]
    if booking.get("organization_id") != org:
        return _result("foreign_booking")
    reference = _reference(booking)
    if reference is None: return _result("missing_receipt_reference")
    if receipt is None: return _result("receipt_unavailable")
    if receipt.get("organization_id") != org or receipt.get("provider_connection_id") != pc:
        return _result("foreign_receipt")
    payload = receipt.get("payload")
    if not isinstance(payload, dict): return _result("invalid_receipt")
    if payload.get("organization_id") != org or payload.get("provider_connection_id") != pc:
        return _result("foreign_receipt")
    try:
        if (set(payload) != _FIELDS or booking.get("source") != "playtomic"
            or booking["metadata"].get("shadow") is not True or booking["metadata"].get("provider") != "playtomic"
            or receipt.get("stream") != "bookings_provenance" or receipt.get("external_id") is not None
            or receipt.get("complete") is not False or payload["policy_version"] != "provider-bookings-provenance/v1"
            or payload["provider"] != "playtomic" or payload["scope"] != "bookings.read"
            or payload["permission_evidence"] != "reviewed_internal_receipt"
            or receipt.get("fingerprint") != reference or _sha256(payload) != reference):
            raise ValueError()
        for key in ("availability_feed_authorized", "can_display_available_slots", "writes_authorized"):
            if payload[key] is not False: raise ValueError()
        if booking["metadata"]["provenance"].get("availability_feed_authorized") is not False:
            raise ValueError()
        if (type(payload["page"]) is not int or not 0 <= payload["page"] <= 48
            or type(payload["records_count"]) is not int or not 0 <= payload["records_count"] <= 200
            or type(payload["export_final_page"]) is not bool):
            raise ValueError()
        fingerprints = payload["record_fingerprints"]
        if (not isinstance(fingerprints, list) or len(fingerprints) != payload["records_count"]
            or any(not isinstance(fp, str) or not _HASH.fullmatch(fp) for fp in fingerprints)):
            raise ValueError()
        for key in ("permission_receipt_sha256", "records_sha256"):
            if not isinstance(payload[key], str) or not _HASH.fullmatch(payload[key]): raise ValueError()
        observed, approved, expiry = [_utc(payload[key]) for key in
                                     ("observed_at", "permission_approved_at", "permission_expires_at")]
        start, end = _utc(payload["window_start"]), _utc(payload["window_end"])
        if (not start < end or not approved <= observed < expiry or observed > now
            or _utc(receipt["observed_at"]) != observed
            or _utc(receipt["window_start"]) != start or _utc(receipt["window_end"]) != end):
            raise ValueError()
    except (KeyError, TypeError, ValueError, OverflowError):
        return _result("invalid_receipt")
    if now >= expiry or (now - observed).total_seconds() >= max_age_seconds:
        return _result("stale_receipt")
    try:
        review_official_club_read(connection, "bookings", now=now)
        current_hash = _sha256({key: connection["config"]["official_grant"][key] for key in _GRANT_FIELDS})
    except (DomainError, KeyError, TypeError, ValueError):
        return _result("permission_not_current")
    if payload["permission_receipt_sha256"] != current_hash:
        return _result("permission_changed")
    grant = connection["config"]["official_grant"]
    if payload["permission_approved_at"] != grant["approved_at"] or payload["permission_expires_at"] != grant["expires_at"]:
        return _result("invalid_receipt")
    if not set(fingerprints).intersection(record_fingerprints):
        return _result("record_not_linked")
    return _result("consistent_internal_evidence")


def review_provider_provenance(db, *, user_id, organization_id, connection_id, now,
                               max_age_seconds, limit=100, after_booking_id=None):
    """Unmounted server review: authenticated RLS, fixed SELECT batches, no writes.

    Cross-tenant rows stay hidden by RLS and are reported as unavailable, never
    fetched through trusted fallback. Every returned booking belongs to org.
    """
    now = _clock(now, max_age_seconds)
    try:
        for value in (user_id, organization_id, connection_id): UUID(value)
        if after_booking_id is not None: UUID(after_booking_id)
        if type(limit) is not int or not 1 <= limit <= 100: raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise DomainError("PROVENANCE_REVIEW_INPUT", "Valid scoped review identifiers and bounded limit required.", 422) from None
    args = {"org": organization_id, "pc": connection_id, "after": after_booking_id, "take": limit + 1}
    with db.user(user_id, readonly=True) as c:
        db.require_role(c, organization_id, user_id, {"owner", "admin", "manager", "analyst"})
        connection = c.execute(text("""
            select id::text,organization_id::text,provider,status,capabilities,config
            from public.provider_connections where organization_id=cast(:org as uuid) and id=cast(:pc as uuid)
        """), args).mappings().first()
        if not connection:
            raise DomainError("FORBIDDEN", "Provider connection is not accessible in this organization.", 403)
        connection = dict(connection)
        bookings = c.execute(text("""
            select id::text,organization_id::text,source,external_reference,metadata
            from public.bookings where organization_id=cast(:org as uuid) and source='playtomic'
              and (cast(:after as uuid) is null or id>cast(:after as uuid))
            order by id limit :take
        """), args).mappings().all()
        has_more = len(bookings) > limit
        bookings = bookings[:limit]
        references = sorted({_reference(b) for b in bookings if _reference(b) is not None})
        receipts = []
        if references:
            receipts = c.execute(text("""
                select distinct on (fingerprint) organization_id::text,provider_connection_id::text,stream,external_id,
                       fingerprint,observed_at,window_start,window_end,complete,payload
                from public.provider_observations where organization_id=cast(:org as uuid)
                  and stream='bookings_provenance' and fingerprint in
                    (select jsonb_array_elements_text(cast(:refs as jsonb)))
                order by fingerprint,(provider_connection_id=cast(:pc as uuid)) desc,id
            """), {**args, "refs": json.dumps(references)}).mappings().all()
        by_ref = {}
        for receipt in receipts: by_ref.setdefault(receipt["fingerprint"], receipt)
        record_refs = set().union(*(_record_references(r["payload"]) for r in receipts))
        source_records = defaultdict(set)
        if record_refs:
            raw = c.execute(text("""
                select fingerprint,external_id from public.provider_observations
                where organization_id=cast(:org as uuid) and provider_connection_id=cast(:pc as uuid)
                  and stream='bookings' and fingerprint in
                    (select jsonb_array_elements_text(cast(:refs as jsonb)))
            """), {**args, "refs": json.dumps(sorted(record_refs))}).mappings().all()
            for record in raw: source_records[record["external_id"]].add(record["fingerprint"])
        items = [{"booking_id": b["id"], **review_booking_provenance(
            b, by_ref.get(_reference(b)), connection, now=now, max_age_seconds=max_age_seconds,
            record_fingerprints=source_records[b["external_reference"]])} for b in bookings]
    return {"mode": "read_only_source_review", "as_of": now.isoformat().replace("+00:00", "Z"),
            "max_age_seconds": max_age_seconds, "items": items,
            "summary": dict(Counter(item["status"] for item in items)), "has_more": has_more,
            "next_after_booking_id": bookings[-1]["id"] if has_more else None,
            "status": "no_shadow_bookings" if not items else (
                "needs_review" if has_more or any(i["status"] != "consistent_internal_evidence" for i in items)
                else "page_consistent"),
            "pilot_ready": False, "provider_requests_allowed": False, "can_display_available_slots": False}
