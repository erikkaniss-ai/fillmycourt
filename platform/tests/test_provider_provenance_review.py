"""Fictional read-only pilot review; no provider transport or deployed database."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from fmc.common import DomainError
from fmc.provider_read_provenance import booking_page_receipt, _sha256
from fmc.supabase_v1 import V1Store
from fmc.v1_workers import _observe, _observe_booking_receipt

NOW = datetime(2026, 10, 21, 5, 0, tzinfo=timezone.utc)
ORG, PC = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"


def connection(org=ORG, pc=PC):
    return {"id": pc, "organization_id": org, "provider": "playtomic", "status": "configured",
            "capabilities": {"write_mode": "read_sync", "official_read_authorized": True},
            "config": {"tenant_id": "club-fixture", "official_grant": {
                "provider": "playtomic", "status": "approved", "authority": "club_or_certified_partner",
                "organization_id": org, "tenant_id": "club-fixture", "agreement_ref": "agreement-fixture",
                "owner_approval_ref": "approval-fixture", "scopes": ["bookings.read"],
                "approved_at": "2026-01-01T00:00:00Z", "expires_at": "2027-01-01T00:00:00Z"}}}


def record(external="booking-fixture"):
    return {"external_id": external, "court_external_id": "court-fixture", "status": "confirmed",
            "starts_at": "2026-10-21T10:00:00Z", "ends_at": "2026-10-21T11:00:00Z",
            "total_minor": 2000, "currency": "EUR"}


def evidence(monkeypatch, *, org=ORG, pc=PC, observed=NOW):
    c = connection(org, pc)
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    p = booking_page_receipt(c, pc, {"page": 0, "cursor": None,
        "window_start": "2026-10-21T00:00:00Z", "window_end": "2026-10-22T00:00:00Z"},
        {"records": [record()], "has_more": False, "next_cursor": None}, observed_at=observed)
    row = {"organization_id": org, "provider_connection_id": pc, "stream": "bookings_provenance",
           "external_id": None, "fingerprint": _sha256(p), "payload": p, "complete": False,
           "observed_at": observed, "window_start": datetime(2026, 10, 21, tzinfo=timezone.utc),
           "window_end": datetime(2026, 10, 22, tzinfo=timezone.utc)}
    b = {"id": str(uuid.uuid4()), "organization_id": org, "source": "playtomic",
         "external_reference": "booking-fixture", "metadata": {"provider": "playtomic", "shadow": True,
         "provenance": {"read_receipt_fingerprint": row["fingerprint"], "availability_feed_authorized": False}}}
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "false")
    return c, b, row


def review(c, b, row, **kwargs):
    from fmc.provider_provenance_review import review_booking_provenance
    return review_booking_provenance(b, row, c, now=kwargs.pop("now", NOW),
        max_age_seconds=kwargs.pop("max_age_seconds", 60),
        record_fingerprints=kwargs.pop("record_fingerprints", {_sha256(record())}), **kwargs)


def test_consistent_internal_evidence_does_not_enable_reads_or_pilot(monkeypatch):
    c, b, row = evidence(monkeypatch)
    result = review(c, b, row)
    assert result["status"] == "consistent_internal_evidence"
    assert result["provider_requests_allowed"] is False
    assert result["can_display_available_slots"] is False
    assert result["pilot_ready"] is False
    assert os.environ["FMC_OFFICIAL_PROVIDER_READS_ENABLED"] == "false"
    from fmc.provider_read_gate import require_official_club_read
    with pytest.raises(DomainError): require_official_club_read(c, "bookings", now=NOW)


@pytest.mark.parametrize("kind,expected", [
    ("no_reference", "missing_receipt_reference"), ("missing", "receipt_unavailable"),
    ("foreign_org", "foreign_receipt"), ("foreign_connection", "foreign_receipt"),
    ("foreign_payload", "foreign_receipt"), ("old", "stale_receipt"),
    ("expired", "stale_receipt"), ("future", "invalid_receipt"),
    ("hash_tamper", "invalid_receipt"), ("wrong_window", "invalid_receipt"),
    ("wrong_flags", "invalid_receipt"), ("wrong_count", "invalid_receipt"),
    ("wrong_fingerprints", "invalid_receipt"), ("empty_page", "record_not_linked"),
    ("not_shadow", "invalid_receipt"), ("permission_time_tamper", "invalid_receipt"),
    ("permission_rotated", "permission_changed"), ("permission_revoked", "permission_not_current"),
    ("wrong_record", "record_not_linked"),
])
def test_unverified_provenance_never_passes(monkeypatch, kind, expected):
    c, b, row = evidence(monkeypatch)
    fingerprints = {_sha256(record())}
    if kind == "no_reference": b["metadata"] = {}
    elif kind == "missing": row = None
    elif kind == "foreign_org": row["organization_id"] = "foreign-org"
    elif kind == "foreign_connection": row["provider_connection_id"] = "foreign-connection"
    elif kind == "foreign_payload": row["payload"]["organization_id"] = "foreign-org"
    elif kind == "old":
        c, b, row = evidence(monkeypatch, observed=NOW - timedelta(seconds=60))
    elif kind == "expired":
        c, b, row = evidence(monkeypatch, observed=NOW - timedelta(seconds=1))
        row["payload"]["permission_expires_at"] = NOW.isoformat().replace("+00:00", "Z")
    elif kind == "future":
        c, b, row = evidence(monkeypatch, observed=NOW + timedelta(seconds=1))
    elif kind == "hash_tamper": row["payload"]["page"] = 1
    elif kind == "wrong_window": row["window_end"] += timedelta(days=1)
    elif kind == "wrong_flags": row["payload"]["can_display_available_slots"] = True
    elif kind == "wrong_count": row["payload"]["records_count"] = True
    elif kind == "wrong_fingerprints": row["payload"]["record_fingerprints"] = None
    elif kind == "empty_page":
        row["payload"].update(records_count=0, record_fingerprints=[], records_sha256=_sha256([]))
    elif kind == "not_shadow": b["metadata"]["shadow"] = False
    elif kind == "permission_time_tamper": row["payload"]["permission_expires_at"] = "2027-02-01T00:00:00Z"
    elif kind == "permission_rotated": c["config"]["official_grant"]["owner_approval_ref"] = "new-approval"
    elif kind == "permission_revoked": c["config"]["official_grant"]["status"] = "revoked"
    elif kind == "wrong_record": fingerprints = {_sha256(record("another-booking"))}
    if kind in ("expired", "wrong_flags", "wrong_count", "wrong_fingerprints", "empty_page", "permission_time_tamper"):
        row["fingerprint"] = _sha256(row["payload"])
        b["metadata"]["provenance"]["read_receipt_fingerprint"] = row["fingerprint"]
    before = deepcopy((c, b, row))
    result = review(c, b, row, record_fingerprints=fingerprints)
    assert result["status"] == expected
    assert not result["pilot_ready"] and not result["provider_requests_allowed"]
    assert (c, b, row) == before
    assert set(result) == {"status", "pilot_ready", "provider_requests_allowed", "can_display_available_slots"}


@pytest.mark.parametrize("age", [None, 0, -1, True, "60"])
def test_explicit_positive_freshness_limit_is_required(monkeypatch, age):
    c, b, row = evidence(monkeypatch)
    with pytest.raises(DomainError): review(c, b, row, max_age_seconds=age)


@pytest.fixture
def pilot(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url: pytest.skip("Requires ephemeral PostgreSQL16 CI database")
    db = V1Store(url)
    owner, outsider, org, foreign, pc, foreign_pc, venue, court = [str(uuid.uuid4()) for _ in range(8)]
    booking_base = uuid.uuid4().int & ~0xFFFF
    with db.trusted() as sql:
        for uid in (owner, outsider):
            sql.execute(text("insert into auth.users(id) values(cast(:id as uuid))"), {"id": uid})
        for oid in (org, foreign):
            sql.execute(text("insert into public.organizations(id,slug,name) values(cast(:id as uuid),:slug,'Pilot fixture')"),
                        {"id": oid, "slug": "review-" + oid})
        sql.execute(text("insert into public.organization_members(organization_id,user_id,role) values(cast(:org as uuid),cast(:uid as uuid),'owner')"),
                    {"org": org, "uid": owner})
        sql.execute(text("insert into public.venues(id,organization_id,name) values(cast(:id as uuid),cast(:org as uuid),'Pilot fixture')"),
                    {"id": venue, "org": org})
        sql.execute(text("insert into public.courts(id,venue_id,name,sport) values(cast(:id as uuid),cast(:venue as uuid),'Fixture court','padel')"),
                    {"id": court, "venue": venue})
        for oid, cid in ((org, pc), (foreign, foreign_pc)):
            conf = connection(oid, cid)
            sql.execute(text("""insert into public.provider_connections(id,organization_id,provider,status,capabilities,config)
                values(cast(:id as uuid),cast(:org as uuid),'playtomic','configured',cast(:caps as jsonb),cast(:cfg as jsonb))"""),
                {"id": cid, "org": oid, "caps": json.dumps(conf["capabilities"]), "cfg": json.dumps(conf["config"])})
        for index, kind in enumerate(("valid", "missing", "stale", "foreign", "malformed")):
            oid, cid = (foreign, foreign_pc) if kind == "foreign" else (org, pc)
            _, booking, row = evidence(monkeypatch, org=oid, pc=cid,
                observed=NOW - timedelta(seconds=60) if kind == "stale" else NOW)
            if kind == "malformed":
                row["payload"]["record_fingerprints"] = None
                booking["metadata"]["provenance"]["read_receipt_fingerprint"] = _sha256(row["payload"])
            if kind != "missing":
                _observe_booking_receipt(sql, row["payload"])
                _observe(sql, oid, cid, "bookings", record())
            else: booking["metadata"] = {}
            bid = str(uuid.UUID(int=booking_base + index + 1))
            sql.execute(text("""insert into public.bookings(id,organization_id,venue_id,court_id,source,status,
                starts_at,ends_at,currency,external_reference,metadata)
                values(cast(:id as uuid),cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),
                'playtomic','confirmed','2026-10-21T10:00:00Z','2026-10-21T11:00:00Z','EUR',:ext,cast(:meta as jsonb))"""),
                {"id": bid, "org": org, "venue": venue, "court": court,
                 "ext": "booking-fixture" if kind == "valid" else kind + "-fixture",
                 "meta": json.dumps(booking["metadata"])})
    return db, owner, outsider, org, foreign, pc


def test_database_review_is_scoped_read_only_and_preserves_rows(pilot):
    from fmc.provider_provenance_review import review_provider_provenance
    db, owner, outsider, org, foreign, pc = pilot
    with db.trusted() as c:
        before = c.execute(text("select count(*) from public.provider_observations")).scalar_one()
    report = review_provider_provenance(db, user_id=owner, organization_id=org,
        connection_id=pc, now=NOW, max_age_seconds=60)
    assert [i["status"] for i in report["items"]] == ["consistent_internal_evidence",
        "missing_receipt_reference", "stale_receipt", "receipt_unavailable", "invalid_receipt"]
    assert report["mode"] == "read_only_source_review"
    assert report["has_more"] is False and not report["pilot_ready"]
    assert foreign not in json.dumps(report) and "club-fixture" not in json.dumps(report)
    with db.trusted() as c:
        assert c.execute(text("select count(*) from public.provider_observations")).scalar_one() == before
    with pytest.raises(DomainError) as denied:
        review_provider_provenance(db, user_id=outsider, organization_id=org,
            connection_id=pc, now=NOW, max_age_seconds=60)
    assert denied.value.status == 403
    with db.user(owner, readonly=True) as c:
        assert c.execute(text("show transaction_read_only")).scalar_one() == "on"
        assert c.execute(text("show transaction_isolation")).scalar_one() == "repeatable read"
        with pytest.raises(DBAPIError) as blocked:
            c.execute(text("update public.organizations set name='not allowed' where id=cast(:id as uuid)"), {"id": org})
        assert blocked.value.orig.sqlstate == "25006"


def test_review_paginates_and_never_calls_truncated_page_complete(pilot):
    from fmc.provider_provenance_review import review_provider_provenance
    db, owner, _, org, _, pc = pilot
    args = dict(user_id=owner, organization_id=org, connection_id=pc, now=NOW, max_age_seconds=60, limit=3)
    first = review_provider_provenance(db, **args)
    second = review_provider_provenance(db, **args, after_booking_id=first["next_after_booking_id"])
    assert first["has_more"] is True and first["status"] == "needs_review"
    assert second["has_more"] is False
    assert {i["booking_id"] for i in first["items"]}.isdisjoint({i["booking_id"] for i in second["items"]})
    assert len(first["items"]) + len(second["items"]) == 5
