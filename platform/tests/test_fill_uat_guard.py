"""Offline fault/route tests; optional local PostgreSQL contract, never hosted."""
import asyncio
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
import threading
from types import SimpleNamespace
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from fmc.common import DomainError
from fmc.config import Settings
from fmc import fill_uat_guard as f
from fmc.supabase_v1 import Actor, SupabaseAuth

START = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)
SHA = "a" * 40
A, B, C = [str(uuid.UUID(int=i)) for i in (101, 102, 103)]
RUN = str(uuid.UUID(int=104))


def manifest():
    return {"run_id": RUN, "candidate_sha": SHA, "project_ref": f.PROJECT,
            "organization_ids": sorted(f.ORGANIZATIONS),
            "starts_at": START.isoformat(), "expires_at": (START + timedelta(minutes=30)).isoformat(),
            "principals": [{"id": uid, "label": label,
                            "ban_at": (START + timedelta(seconds=ban)).isoformat(),
                            "expires_at": (START + timedelta(seconds=expiry)).isoformat()}
                           for uid, label, ban, expiry in [(A, "a", 1200, 1800),
                                                          (B, "b", 1200, 1800), (C, "canary", 60, 120)]]}


class Clock:
    seconds = 0
    skew = 0
    def wall(self):
        return START + timedelta(seconds=self.seconds + self.skew)
    def tick(self):
        return self.seconds
    def advance(self, seconds):
        self.seconds += seconds


class Ledger:
    def __init__(self, clock, spec):
        self.clock = clock
        self.row = {"spec": deepcopy(spec), "armed": True, "stopped": False,
                    "healthy_at": clock.wall(), "receipts": {}, "isolated": True}
        self.complete, self.attempts, self.fail = False, 0, False
    def snapshot(self, *_):
        if self.fail:
            raise RuntimeError("fictional private failure")
        return dict(self.row, db_now=self.clock.wall())
    def pending(self):
        if self.fail:
            raise RuntimeError("fictional private failure")
        return [] if self.complete else [self.row]
    def record(self, lease, receipts, healthy):
        if self.fail:
            raise RuntimeError("fictional private failure")
        assert lease.document == f.Lease.parse(self.row["spec"]).document
        self.row.update(receipts=receipts, healthy_at=self.clock.wall() if healthy else None)
        self.complete = all(receipts.get(p.id) is True for p in lease.principals)
        self.attempts += 1


class Admin:
    def __init__(self):
        self.calls, self.fail = [], False
    def inspect(self, lease, principal, *, ban):
        assert principal.id not in f.OLD_USERS
        self.calls.append((lease.run_id, principal.id, ban))
        if self.fail:
            raise RuntimeError("fictional Auth outage")
        return ban
    def close(self):
        pass


@pytest.fixture
def e():
    clock, spec, admin = Clock(), manifest(), Admin()
    ledger = Ledger(clock, spec)
    lease = f.Lease.parse(spec)
    guard = f.Guard(lease, ledger, admin, clock=clock.wall, monotonic=clock.tick)
    return SimpleNamespace(clock=clock, spec=spec, admin=admin, ledger=ledger, lease=lease, guard=guard,
                           actor=Actor(A, "fixture@example.invalid", RUN, True))


@pytest.mark.parametrize("change", [
    lambda s: s.update(project_ref="production"),
    lambda s: s.update(candidate_sha="short"),
    lambda s: s.update(run_id="not-a-uuid"),
    lambda s: s.update(expires_at=(START + timedelta(minutes=31)).isoformat()),
    lambda s: s.update(starts_at="2026-10-30T12:00:00"),
    lambda s: s.update(organization_ids=[str(uuid.uuid4()), str(uuid.uuid4())]),
    lambda s: s["principals"].append(dict(s["principals"][0])),
    lambda s: s["principals"][1].update(id=A),
    lambda s: s["principals"][1].update(label="a"),
    lambda s: s["principals"][0].update(ban_at=(START + timedelta(minutes=21)).isoformat()),
    lambda s: s["principals"][2].update(expires_at=(START + timedelta(minutes=4)).isoformat()),
    lambda s: s["principals"][0].update(expires_at=START.isoformat()),
])
def test_invalid_or_extended_manifest_rejected(change):
    spec = manifest()
    change(spec)
    with pytest.raises((ValueError, TypeError, AttributeError)):
        f.Lease.parse(spec)


@pytest.mark.parametrize("old", sorted(f.OLD_USERS))
def test_old_principals_never_enrolled_or_allowed(old, e):
    spec = manifest()
    spec["principals"][0]["id"] = old
    with pytest.raises(ValueError):
        f.Lease.parse(spec)
    with pytest.raises(DomainError):
        e.guard.check(Actor(old))


@pytest.mark.parametrize("mutation", [
    lambda e: e.ledger.row.update(armed=False),
    lambda e: e.ledger.row.update(stopped=True),
    lambda e: e.ledger.row.update(isolated=False),
    lambda e: e.ledger.row.update(healthy_at=None),
    lambda e: e.ledger.row.update(receipts={A: True}),
    lambda e: e.ledger.row["spec"].update(candidate_sha="b" * 40),
    lambda e: setattr(e.ledger, "fail", True),
    lambda e: setattr(e.guard, "cleanup_error", True),
    lambda e: setattr(e.clock, "skew", -10),
    lambda e: setattr(e.clock, "skew", 10),
    lambda e: e.clock.advance(46),
    lambda e: e.clock.advance(1800),
])
def test_fixture_fails_closed(mutation, e):
    e.guard.check(e.actor)
    mutation(e)
    with pytest.raises(DomainError) as err:
        e.guard.check(e.actor)
    assert err.value.code == "FILL_UAT_CLOSED"


@contextmanager
def paused_sweep(e, monkeypatch, *, fail_first=False):
    """Hold a real sweep inside Admin inspection while requests check access."""
    entered, release = threading.Event(), threading.Event()
    inspect = e.admin.inspect
    calls = 0

    def paused(lease, principal, *, ban):
        nonlocal calls
        calls += 1
        if fail_first and calls == 1:
            raise RuntimeError("fictional observed Admin failure")
        if calls == (2 if fail_first else 1):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test inspection barrier timed out")
        return inspect(lease, principal, ban=ban)

    monkeypatch.setattr(e.admin, "inspect", paused)
    worker = threading.Thread(target=e.guard.sweep)
    worker.start()
    try:
        assert entered.wait(5), "Sweep never reached the inspection barrier"
        yield
    finally:
        release.set()
        worker.join(5)
        assert not worker.is_alive(), "Sweep did not finish"


@pytest.mark.parametrize("elapsed", [0, 46])
def test_inflight_healthy_sweep_uses_previous_health_without_renewing_it(e, monkeypatch, elapsed):
    e.guard.sweep()
    e.guard.check(e.actor)
    previous_health = e.ledger.row["healthy_at"]
    with paused_sweep(e, monkeypatch):
        e.guard.check(e.actor)  # Routine work must not close a healthy session.
        e.clock.advance(elapsed)
        assert e.ledger.row["healthy_at"] == previous_health
        if elapsed:
            with pytest.raises(DomainError):
                e.guard.check(e.actor)  # A hung sweep cannot extend health past 45s.
    e.guard.check(e.actor)
    assert e.ledger.row["healthy_at"] == e.clock.wall()


def test_observed_admin_failure_denies_before_remaining_inspections_finish(e, monkeypatch):
    e.guard.check(e.actor)
    with paused_sweep(e, monkeypatch, fail_first=True):
        assert e.ledger.row["healthy_at"] == e.clock.wall()
        with pytest.raises(DomainError):
            e.guard.check(e.actor)
    assert e.guard.cleanup_error and e.ledger.row["healthy_at"] is None


def test_failed_ledger_record_stays_closed_until_whole_recovery_finishes(e, monkeypatch):
    record = e.ledger.record

    def failed_record(*_):
        raise RuntimeError("fictional failed health persistence")

    monkeypatch.setattr(e.ledger, "record", failed_record)
    e.guard.sweep()
    assert e.guard.cleanup_error
    # A failed write leaves the previously healthy database row unchanged.
    assert e.ledger.row["healthy_at"] == e.clock.wall()
    monkeypatch.setattr(e.ledger, "record", record)
    with paused_sweep(e, monkeypatch):
        with pytest.raises(DomainError):
            e.guard.check(e.actor)
        assert e.guard.cleanup_error
    e.guard.check(e.actor)
    assert not e.guard.cleanup_error


def test_startup_without_completed_health_denies_during_first_sweep(e, monkeypatch):
    e.ledger.row["healthy_at"] = None
    with paused_sweep(e, monkeypatch):
        with pytest.raises(DomainError):
            e.guard.check(e.actor)
    e.guard.check(e.actor)


@pytest.mark.parametrize("actor", [Actor(A), Actor(A, fill_f1_run=RUN),
    Actor(A, fill_f1_run="forged", fill_f1_fictional=True),
    Actor(str(uuid.UUID(int=999)), fill_f1_run=RUN, fill_f1_fictional=True)])
def test_manifest_and_trusted_classification_both_required(actor, e):
    with pytest.raises(DomainError):
        e.guard.check(actor)


def test_normal_user_unchanged_during_registry_outage_and_default_off(e):
    e.ledger.fail = True
    e.guard.cleanup_error = True
    normal = Actor(str(uuid.UUID(int=999)))
    e.guard.check(normal, "POST")
    f.Guard().check(normal)
    with pytest.raises(DomainError):
        f.Guard().check(e.actor)
    with pytest.raises(DomainError):
        e.guard.check(e.actor, "POST")


def test_slow_registry_crossing_deadline_denied(e):
    def slow(*_):
        e.clock.advance(1801)
        return dict(e.ledger.row, db_now=e.clock.wall(), healthy_at=e.clock.wall())
    e.ledger.snapshot = slow
    with pytest.raises(DomainError):
        e.guard.check(e.actor)


@pytest.mark.parametrize("failure", ["missing", "clock", "future-health", "malformed"])
def test_missing_or_invalid_registry_is_closed(e, failure):
    row = e.ledger.snapshot(e.lease, A)
    if failure == "missing":
        row = None
    elif failure == "clock":
        row["db_now"] += timedelta(seconds=3)
    elif failure == "future-health":
        row["healthy_at"] += timedelta(seconds=1)
    else:
        row["spec"] = {}
    e.ledger.snapshot = lambda *_: row
    with pytest.raises(DomainError):
        e.guard.check(e.actor)


def test_no_chat_cleanup_early_ban_canary_and_durable_retry(e):
    e.guard.sweep()
    assert len(e.admin.calls) == 3 and not any(c[2] for c in e.admin.calls)
    e.clock.advance(60)
    e.guard.sweep()
    assert e.ledger.row["receipts"][C] is True
    assert e.ledger.row["receipts"][A] is False
    e.guard.check(e.actor)
    with pytest.raises(DomainError):
        e.guard.check(Actor(C, fill_f1_run=RUN, fill_f1_fictional=True))
    e.clock.advance(1200)
    e.admin.fail = True
    e.guard.sweep()
    assert not e.ledger.complete and e.ledger.row["healthy_at"] is None
    with pytest.raises(DomainError):
        e.guard.check(e.actor)
    # Simulate a new process; the same persisted absolute lease, not now+30min.
    restarted = f.Guard(e.lease, e.ledger, e.admin, clock=e.clock.wall, monotonic=e.clock.tick)
    e.admin.fail = False
    restarted.sweep()
    assert e.ledger.complete and e.ledger.attempts == 4
    assert e.lease.expires_at == START + timedelta(minutes=30)
    with pytest.raises(DomainError):
        restarted.check(e.actor)


def test_suspended_controller_does_not_extend_access(e):
    e.clock.advance(46)
    with pytest.raises(DomainError):
        e.guard.check(e.actor)
    assert e.admin.calls == []
    e.clock.advance(1800)
    restarted = f.Guard(e.lease, e.ledger, e.admin, clock=e.clock.wall, monotonic=e.clock.tick)
    restarted.sweep()
    assert e.ledger.complete and all(c[2] for c in e.admin.calls)


def test_lifespan_sweeps_at_startup_without_chat_and_retries(e, monkeypatch):
    monkeypatch.setattr(f, "POLL_SECONDS", 0.001)
    e.clock.advance(1801)
    e.admin.fail = True
    async def scenario():
        async with e.guard.lifespan(None):
            assert e.guard.cleanup_error and not e.ledger.complete
            e.admin.fail = False
            for _ in range(100):
                if e.ledger.complete:
                    break
                await asyncio.sleep(0.001)
            assert e.ledger.complete
    asyncio.run(scenario())


@pytest.mark.parametrize("environment,service,url", [("production", "operations", f.ORIGIN),
    ("test", "operations", f.ORIGIN), ("staging", "core", f.ORIGIN),
    ("staging", "all", f.ORIGIN), ("staging", "operations", "https://foreign.supabase.co")])
def test_enabled_only_pinned_operations_staging(environment, service, url, monkeypatch):
    monkeypatch.setenv("FILL_UAT_GUARD", "on")
    settings = SimpleNamespace(environment=environment, supabase_url=url)
    with pytest.raises(RuntimeError):
        f.from_environment(settings, service, None)


def test_off_is_no_ledger_or_admin_io_and_bad_candidate_rejected(monkeypatch):
    monkeypatch.delenv("FILL_UAT_GUARD", raising=False)
    assert f.from_environment(None, "core", None).lease is None
    monkeypatch.setenv("FILL_UAT_GUARD", "on")
    monkeypatch.setenv("FILL_UAT_LEASE", json.dumps(manifest()))
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "b" * 40)
    with pytest.raises(RuntimeError):
        f.from_environment(SimpleNamespace(environment="staging", supabase_url=f.ORIGIN), "operations", None)


def admin_response(e, *, marker=RUN, readback=True, status=200):
    calls = []
    banned = False
    def reply(request):
        nonlocal banned
        calls.append(request)
        assert request.url.host == f.PROJECT + ".supabase.co"
        assert request.url.path == "/auth/v1/admin/users/" + A
        if request.method == "PUT":
            assert json.loads(request.content) == {"ban_duration": "876000h"}
            banned = readback
        return httpx.Response(status, json={"id": A, "role": "authenticated",
            "created_at": START.isoformat(), "app_metadata": {"fill_f1_run": marker, "fictional": True},
            "banned_until": (datetime.now(timezone.utc) + timedelta(days=36500)).isoformat() if banned else None})
    return calls, reply


@pytest.mark.parametrize("failure", ["none", "forged", "readback", "outage", "timeout"])
def test_supported_admin_ban_only_exact_identity_readback(e, failure):
    calls, reply = admin_response(e, marker="foreign" if failure == "forged" else RUN,
                                 readback=failure != "readback", status=503 if failure == "outage" else 200)
    def authority(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("fictional timeout", request=request)
        return reply(request)
    admin = f.BanAdmin("fictional-server-key", transport=httpx.MockTransport(authority))
    try:
        if failure == "none":
            assert admin.inspect(e.lease, e.lease.principal(A), ban=True)
            assert [r.method for r in calls] == ["GET", "PUT", "GET"]
        else:
            with pytest.raises((ValueError, TypeError, httpx.HTTPError)):
                admin.inspect(e.lease, e.lease.principal(A), ban=True)
        assert all(r.method in {"GET", "PUT"} for r in calls)
        if failure == "forged":
            assert [r.method for r in calls] == ["GET"]
    finally:
        admin.close()


def test_user_metadata_cannot_enrol_fixture_or_grant_role():
    def authority(_):
        return httpx.Response(200, json={"id": A, "user_metadata": {"fill_f1_run": RUN,
                                         "fictional": True, "role": "owner"}})
    with httpx.Client(transport=httpx.MockTransport(authority)) as http:
        actor = SupabaseAuth(f.ORIGIN, "fixture-key", http=http).verify("Bearer fictional")
    assert actor == Actor(A) and not hasattr(actor, "role")


def test_creation_before_fixed_start_and_foreign_id_never_banned(e):
    calls, reply = admin_response(e)
    def authority(request):
        response = reply(request)
        data = response.json()
        data["created_at"] = (START - timedelta(seconds=1)).isoformat()
        return httpx.Response(200, json=data)
    admin = f.BanAdmin("fictional-server-key", transport=httpx.MockTransport(authority))
    try:
        with pytest.raises(ValueError):
            admin.inspect(e.lease, e.lease.principal(A), ban=True)
        assert [r.method for r in calls] == ["GET"]
        for old in f.OLD_USERS:
            principal = f.Principal(old, "a", START, START)
            with pytest.raises(ValueError):
                admin.inspect(e.lease, principal, ban=True)
        assert len(calls) == 1
    finally:
        admin.close()


@pytest.mark.parametrize("marker", [None, "", [], {}, 1])
def test_malformed_trusted_marker_cannot_become_normal_user(marker):
    def authority(_):
        return httpx.Response(200, json={"id": A, "app_metadata": {"fill_f1_run": marker}})
    with httpx.Client(transport=httpx.MockTransport(authority)) as http:
        actor = SupabaseAuth(f.ORIGIN, "fixture-key", http=http).verify("Bearer fictional")
    with pytest.raises(DomainError):
        f.Guard().check(actor)


@pytest.mark.parametrize("path", ["/api/me", "/api/fmc/organizations"])
@pytest.mark.parametrize("failure", ["none", "late-data", "late-auth", "revoked", "registry", "suspended", "oversize", "late-removal"])
def test_actual_operations_routes_buffer_and_recheck_before_delivery(e, monkeypatch, path, failure):
    from fmc import v1_app as v
    calls = []
    def authority(request):
        calls.append(request)
        if len(calls) > 1 and failure == "late-auth":
            e.clock.advance(1801)
        if len(calls) > 1 and failure == "revoked":
            return httpx.Response(401)
        return httpx.Response(200, json={"id": A, "app_metadata": {"fill_f1_run": RUN, "fictional": True}})
    def organizations(_):
        if failure == "late-data":
            e.clock.advance(1801)
        if failure == "late-removal":
            e.ledger.row["stopped"] = True
        if failure == "oversize":
            return [{"name": "SENSITIVE FICTIONAL RESULT" + "x" * f.MAX_RESPONSE}]
        return [{"id": sorted(f.ORGANIZATIONS)[0], "name": "SENSITIVE FICTIONAL RESULT", "role": "support"}]
    db = SimpleNamespace(engine=None, organizations_for=organizations)
    monkeypatch.setattr(v, "V1Store", lambda _: db)
    monkeypatch.setattr(v, "fill_guard_from_environment", lambda *_: e.guard)
    if failure == "registry":
        e.ledger.fail = True
    if failure == "suspended":
        e.clock.advance(46)
    with httpx.Client(transport=httpx.MockTransport(authority)) as http:
        auth = SupabaseAuth(f.ORIGIN, "fixture-key", http=http)
        # No TestClient context: represents a suspended controller, no sweep.
        client = TestClient(v.create_v1_app(Settings(database="postgresql://unused", environment="test"),
                                          service="operations", auth_override=auth))
        response = client.get(path, headers={"Authorization": "Bearer fictional"})
        assert response.headers["cache-control"] == "no-store"
        if failure == "none":
            assert response.status_code == 200 and "SENSITIVE FICTIONAL RESULT" in response.text
            assert len(calls) == 2
        else:
            assert response.status_code == 403 and "SENSITIVE FICTIONAL RESULT" not in response.text
            assert "fixture-key" not in response.text


def test_fixture_post_is_rejected_before_route_mutation(e, monkeypatch):
    from fmc import v1_app as v
    monkeypatch.setattr(v, "V1Store", lambda _: SimpleNamespace(engine=None))
    monkeypatch.setattr(v, "fill_guard_from_environment", lambda *_: e.guard)
    auth = SimpleNamespace(verify=lambda _: e.actor)
    client = TestClient(v.create_v1_app(Settings(database="postgresql://unused"), "operations", auth))
    response = client.post("/api/fmc/organizations", headers={"Authorization": "Bearer fictional"},
                           json={"name": "FICTIONAL", "slug": "fictional"})
    assert response.status_code == 403


def test_default_off_normal_route_and_core_unchanged(e, monkeypatch):
    from fmc import v1_app as v
    monkeypatch.setattr(v, "V1Store", lambda _: SimpleNamespace(engine=None, organizations_for=lambda _: []))
    monkeypatch.delenv("FILL_UAT_GUARD", raising=False)
    for service, actor, expected in [("operations", Actor(A), 200),
                                      ("operations", e.actor, 403), ("core", e.actor, 200)]:
        auth = SimpleNamespace(verify=lambda _, a=actor: a)
        with TestClient(v.create_v1_app(Settings(database="postgresql://unused"), service, auth)) as client:
            assert client.get("/api/me", headers={"Authorization": "Bearer fictional"}).status_code == expected


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Local PostgreSQL/CI only")
def test_private_sql_ledger_immutable_deadlines_reuse_and_rls():
    # Entire test rolls back; never run against staging. Existing CI owns schema.
    engine = create_engine(os.environ["TEST_DATABASE_URL"])
    with engine.connect() as c:
        tx = c.begin()
        class ConnectionEngine:
            @contextmanager
            def begin(self):
                yield c
        try:
            spec = manifest()
            spec["run_id"] = str(uuid.uuid4())
            for p in spec["principals"]:
                p["id"] = str(uuid.uuid4())
            lease = f.Lease.parse(spec)
            c.execute(text("insert into fill_private.uat_runs(run_id,spec) values(cast(:id as uuid),cast(:spec as jsonb))"),
                      {"id": lease.run_id, "spec": lease.document})
            c.execute(text("update fill_private.uat_runs set armed=true where run_id=cast(:id as uuid)"), {"id": lease.run_id})
            ledger = f.SQLLedger(ConnectionEngine())
            ledger.record(lease, {}, True)
            row = ledger.snapshot(lease, lease.principals[0].id)
            assert row["armed"] and row["healthy_at"] and row["isolated"]
            assert f.Lease.parse(row["spec"]) == lease
            for statement, params in [
                ("update fill_private.uat_runs set spec=jsonb_set(spec,'{expires_at}','\"2099-01-01T00:00:00Z\"') where run_id=cast(:id as uuid)", {"id": lease.run_id}),
                ("delete from fill_private.uat_runs where run_id=cast(:id as uuid)", {"id": lease.run_id}),
            ]:
                with pytest.raises(Exception), c.begin_nested():
                    c.execute(text(statement), params)
            reused = deepcopy(spec)
            reused["run_id"] = str(uuid.uuid4())
            with pytest.raises(Exception), c.begin_nested():
                c.execute(text("insert into fill_private.uat_runs(run_id,spec) values(cast(:id as uuid),cast(:spec as jsonb))"),
                          {"id": reused["run_id"], "spec": json.dumps(reused)})
            for role in ("anon", "authenticated"):
                with pytest.raises(Exception), c.begin_nested():
                    c.execute(text("set local role " + role))
                    c.execute(text("select * from fill_private.uat_runs"))
            assert any(r["spec"]["run_id"] == lease.run_id for r in ledger.pending())
        finally:
            tx.rollback()
    engine.dispose()
