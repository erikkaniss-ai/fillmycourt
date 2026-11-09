"""Fictional booking-read provenance; no provider transport or live data."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
import uuid

import pytest
from sqlalchemy import text

from fmc import v1_workers
from fmc.common import DomainError
from fmc.supabase_v1 import V1Store

NOW = datetime(2026, 10, 21, 4, 0, tzinfo=timezone.utc)
ORG = "11111111-1111-4111-8111-111111111111"
PC = "22222222-2222-4222-8222-222222222222"
START, END = "2026-10-20T00:00:00Z", "2026-10-22T00:00:00Z"


def connection(org=ORG, pc=PC):
    return {"id": pc, "provider": "playtomic", "status": "configured",
            "organization_id": org,
            "capabilities": {"write_mode": "read_sync", "official_read_authorized": True},
            "config": {"tenant_id": "club-fixture", "official_grant": {
                "provider": "playtomic", "status": "approved",
                "authority": "club_or_certified_partner", "organization_id": org,
                "tenant_id": "club-fixture", "agreement_ref": "agreement-fixture",
                "owner_approval_ref": "approval-fixture", "scopes": ["bookings.read"],
                "approved_at": "2026-01-01T00:00:00Z", "expires_at": "2027-01-01T00:00:00Z",
            }}}


def record():
    return {"external_id": "booking-fixture", "court_external_id": "court-fixture",
            "starts_at": "2026-10-21T10:00:00Z", "ends_at": "2026-10-21T11:00:00Z",
            "status": "confirmed", "total_minor": 2000, "currency": "EUR"}


def page_state():
    return {"page": 0, "cursor": None, "window_start": START, "window_end": END}


def response(more=False, records=None):
    return {"records": [record()] if records is None else records,
            "has_more": more, "next_cursor": None}


def job(pc=PC, jid="job-fixture", lease="lease-fixture"):
    return {"id": jid, "lease_token": lease,
            "payload": {"provider_connection_id": pc, "stream": "bookings",
                        "window_start": START, "window_end": END}}


class FixtureProvider:
    calls = 0
    more = False
    def __init__(self, *_):
        pass
    def token_usable(self, **_):
        return True
    def page(self, *_args, **_kwargs):
        self.calls += 1
        return response(self.more)


def test_worker_links_shadow_booking_to_permission_and_page_receipt(monkeypatch):
    class Conn:
        def __init__(self): self.statements = []
        def execute(self, stmt, params=None):
            self.statements.append((str(stmt), params))
    class Db:
        def __init__(self): self.conn = Conn()
        def reserve_provider_request(self, _): return 0
        @contextmanager
        def trusted(self): yield self.conn
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    monkeypatch.setattr(v1_workers, "_connection", lambda *_: connection())
    monkeypatch.setattr(v1_workers, "_credential", lambda *_: ("client-fixture", "secret-fixture", "club-fixture"))
    monkeypatch.setattr(v1_workers, "Playtomic", FixtureProvider)
    monkeypatch.setattr(v1_workers, "_mapping", lambda *_:
                        {"organization_id": ORG, "venue_id": "venue-fixture", "court_id": "court-fixture"})
    db = Db()
    assert v1_workers._sync_playtomic(db, job())["records"] == 1
    observations = [p for sql, p in db.conn.statements if "insert into public.provider_observations" in sql]
    receipts = [p for p in observations if p.get("stream") == "bookings_provenance"]
    assert len(receipts) == 1, "Every successful page needs an internal permission/source receipt"
    receipt = json.loads(receipts[0]["payload"])
    assert receipt["scope"] == "bookings.read"
    assert receipt["source_kind"] == "booking_events"
    assert receipt["organization_id"] == ORG and receipt["provider_connection_id"] == PC
    assert receipt["window_start"] == START and receipt["window_end"] == END
    assert receipt["records_count"] == 1 and receipt["page"] == 0
    assert receipt["export_final_page"] is True
    assert receipt["availability_feed_authorized"] is False
    booking = next(p for sql, p in db.conn.statements if "insert into public.bookings" in sql)
    metadata = json.loads(booking["metadata"])
    assert metadata["provenance"]["read_receipt_fingerprint"] == receipts[0]["fp"]
    assert metadata["provenance"]["availability_feed_authorized"] is False
    # Reconciliation retains its original normalized booking payload and dedupe.
    raw = next(p for p in observations if p.get("stream") == "bookings")
    assert json.loads(raw["payload"]) == record()
    assert receipt["record_fingerprints"] == [raw["fp"]]
    assert "secret-fixture" not in json.dumps(receipt)


def test_receipt_whitelists_permission_snapshot_without_credentials_or_player_data(monkeypatch):
    from fmc.provider_read_provenance import booking_page_receipt
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    c = connection()
    c["config"]["client_secret"] = "never-copy-this-secret"
    c["config"]["official_grant"]["private_contact"] = "private@example.invalid"
    receipt = booking_page_receipt(c, PC, page_state(), response(), observed_at=NOW)
    assert receipt["policy_version"] == "provider-bookings-provenance/v1"
    assert receipt["observed_at"] == "2026-10-21T04:00:00Z"
    assert receipt["permission_expires_at"] == "2027-01-01T00:00:00Z"
    assert receipt["permission_evidence"] == "reviewed_internal_receipt"
    assert len(receipt["permission_receipt_sha256"]) == 64
    assert len(receipt["records_sha256"]) == 64
    assert receipt["can_display_available_slots"] is False
    assert receipt["writes_authorized"] is False
    serialized = json.dumps(receipt)
    for private in ("never-copy-this-secret", "private@example.invalid", "booking-fixture", "club-fixture"):
        assert private not in serialized
    # An unrelated private config field is neither persisted nor part of identity.
    original = connection()
    assert booking_page_receipt(original, PC, page_state(), response(), observed_at=NOW) == receipt
    changed = deepcopy(original)
    changed["config"]["official_grant"]["owner_approval_ref"] = "approval-renewed"
    renewed = booking_page_receipt(changed, PC, page_state(), response(), observed_at=NOW)
    assert renewed["permission_receipt_sha256"] != receipt["permission_receipt_sha256"]


def test_unicode_record_fingerprint_matches_existing_observation_identity(monkeypatch):
    from fmc.provider_read_provenance import booking_page_receipt
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    value = record()
    value["external_id"] = "booking-fixture-café"
    receipt = booking_page_receipt(connection(), PC, page_state(), response(records=[value]), observed_at=NOW)
    class Capture:
        def execute(self, _stmt, params): self.params = params
    capture = Capture()
    v1_workers._observe(capture, ORG, PC, "bookings", value)
    assert receipt["record_fingerprints"] == [capture.params["fp"]]


@pytest.mark.parametrize("more", [False, True])
def test_empty_page_never_proves_free_inventory_or_complete_availability(monkeypatch, more):
    from fmc.provider_read_provenance import booking_page_receipt
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    receipt = booking_page_receipt(connection(), PC, page_state(), response(more, []), observed_at=NOW)
    assert receipt["records_count"] == 0
    assert receipt["export_final_page"] is (not more)
    assert receipt["availability_feed_authorized"] is False
    assert receipt["can_display_available_slots"] is False


@pytest.mark.parametrize("failure", ["revoked", "expired", "foreign_connection", "scope", "naive_time", "window"])
def test_invalid_permission_or_page_provenance_is_rejected(monkeypatch, failure):
    from fmc.provider_read_provenance import booking_page_receipt
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    c, state, observed = connection(), page_state(), NOW
    if failure == "revoked": c["config"]["official_grant"]["status"] = "revoked"
    if failure == "expired": c["config"]["official_grant"]["expires_at"] = "2026-10-21T03:59:59Z"
    if failure == "foreign_connection": c["id"] = "foreign-connection"
    if failure == "scope": c["config"]["official_grant"]["scopes"] = ["availability.read"]
    if failure == "naive_time": observed = NOW.replace(tzinfo=None)
    if failure == "window": state["window_end"] = state["window_start"]
    with pytest.raises(DomainError):
        booking_page_receipt(c, PC, state, response(), observed_at=observed)


@pytest.mark.parametrize("rollback", [False, True])
def test_postgres_page_receipt_and_shadow_projection_commit_atomically(monkeypatch, rollback):
    url = os.getenv("TEST_DATABASE_URL")
    if not url: pytest.skip("Requires ephemeral PostgreSQL16 CI database")
    store = V1Store(url)
    org, pc, venue, court, jid, lease = [str(uuid.uuid4()) for _ in range(6)]
    c = connection(org, pc)
    with store.trusted() as sql:
        sql.execute(text("insert into public.organizations(id,slug,name) values(cast(:id as uuid),:slug,'Provenance fixture')"),
                    {"id": org, "slug": "prov-" + org})
        sql.execute(text("insert into public.venues(id,organization_id,name) values(cast(:id as uuid),cast(:org as uuid),'Fixture venue')"),
                    {"id": venue, "org": org})
        sql.execute(text("insert into public.courts(id,venue_id,name,sport) values(cast(:id as uuid),cast(:venue as uuid),'Fixture court','padel')"),
                    {"id": court, "venue": venue})
        sql.execute(text("""insert into public.provider_connections(id,organization_id,provider,status,capabilities,config)
                    values(cast(:id as uuid),cast(:org as uuid),'playtomic','configured',cast(:caps as jsonb),cast(:cfg as jsonb))"""),
                    {"id": pc, "org": org, "caps": json.dumps(c["capabilities"]), "cfg": json.dumps(c["config"])})
        sql.execute(text("""insert into public.provider_mappings(organization_id,provider_connection_id,entity_type,local_id,external_id)
                    values(cast(:org as uuid),cast(:pc as uuid),'court',cast(:court as uuid),'court-fixture')"""),
                    {"org": org, "pc": pc, "court": court})
        sql.execute(text("""insert into public.jobs(id,organization_id,kind,dedupe_key,payload,status,attempts,lease_token,lease_until)
                    values(cast(:id as uuid),cast(:org as uuid),'sync_bookings',:id,'{}','leased',1,cast(:lease as uuid),now()+interval '45 seconds')"""),
                    {"id": jid, "org": org, "lease": lease})
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    monkeypatch.setattr(v1_workers, "_credential", lambda *_: ("client-fixture", "secret-fixture", "club-fixture"))
    monkeypatch.setattr(v1_workers, "Playtomic", FixtureProvider)
    monkeypatch.setattr(FixtureProvider, "more", True)
    if rollback:
        original = store.checkpoint_provider_job
        def crash(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("Fixture crash before commit")
        monkeypatch.setattr(store, "checkpoint_provider_job", crash)
        with pytest.raises(RuntimeError, match="before commit"):
            v1_workers._sync_playtomic(store, job(pc, jid, lease))
    else:
        assert v1_workers._sync_playtomic(store, job(pc, jid, lease))["checkpointed"] is True
    with store.trusted() as sql:
        observations = sql.execute(text("select * from public.provider_observations where provider_connection_id=cast(:pc as uuid)"),
                                   {"pc": pc}).mappings().all()
        bookings = sql.execute(text("select metadata from public.bookings where organization_id=cast(:org as uuid)"),
                               {"org": org}).mappings().all()
        queued = sql.execute(text("select status,payload from public.jobs where id=cast(:id as uuid)"),
                             {"id": jid}).mappings().one()
        if rollback:
            assert not observations and not bookings
            assert queued["status"] == "leased" and queued["payload"] == {}
        else:
            assert len(observations) == 2 and len(bookings) == 1
            receipt = next(o for o in observations if o["stream"] == "bookings_provenance")
            assert receipt["complete"] is False  # never an inventory-completeness claim
            assert receipt["window_start"].isoformat() == "2026-10-20T00:00:00+00:00"
            assert receipt["payload"]["export_final_page"] is False
            assert bookings[0]["metadata"]["provenance"]["read_receipt_fingerprint"] == receipt["fingerprint"]
            assert queued["status"] == "queued" and queued["payload"]["progress"]["page"] == 1
            v1_workers._observe_booking_receipt(sql, receipt["payload"])
            assert sql.execute(text("select count(*) from public.provider_observations where provider_connection_id=cast(:pc as uuid)"),
                               {"pc": pc}).scalar_one() == 2
