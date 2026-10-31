"""Offline fault injection and existing CI PostgreSQL only; never staging."""
import asyncio
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import uuid

import httpx
import pytest
from sqlalchemy import create_engine, text

from fmc import fill_uat_bootstrap as b
from fmc import fill_uat_guard as g
from fmc.supabase_v1 import Actor

START = datetime(2026, 10, 31, tzinfo=timezone.utc)
SHA = "d" * 40


def plan_input():
    return {"run_id": str(uuid.uuid4()), "authorization_id": str(uuid.uuid4()), "candidate_sha": SHA,
            "passwords": {label: "synthetic-only-" + label + "x" * 40 for label in b.LABELS}}


class Clock:
    seconds = 0
    skew = 0
    def wall(self):
        return START + timedelta(seconds=self.seconds+self.skew)
    def tick(self):
        return self.seconds
    def advance(self, seconds):
        self.seconds += seconds


class MemoryJournal:
    """Durability boundary double; PostgreSQL constraints tested separately."""
    def __init__(self, clock):
        self.clock, self.row, self.spec = clock, None, None
        self.lock = Lock()
        self.failure = None
    def prepare(self):
        self.row = {"starts_at": None, "executor": None, "stopped": False, "released_at": None,
                    "preflight_at": None, "preflight_executor": None, "verdict": None, "verdict_at": None,
                    "attempts": [], "reconciliation_required": False, "lease_digest": "1" * 64}
    def read(self, _):
        if self.failure == "db":
            raise RuntimeError("synthetic sensitive DB failure")
        return dict(deepcopy(self.row), db_now=self.clock.wall()) if self.row else None
    def preflight(self, _, executor):
        self.row.update(preflight_at=self.clock.wall(), preflight_executor=executor)
    def invalidate_preflight(self, _):
        self.row.update(preflight_at=None, preflight_executor=None)
    def claim(self, _, executor):
        with self.lock:
            if self.row["starts_at"] or self.row["preflight_executor"] != executor:
                return False
            self.row.update(starts_at=self.clock.wall(), executor=executor)
            return True
    def reserve(self, _, executor, label, operation):
        with self.lock:
            assert executor == self.row["executor"] and not self.row["stopped"]
            if any(a["label"] == label and a["operation"] == operation for a in self.row["attempts"]):
                raise b.Closed()
            nonce = str(uuid.uuid4())
            self.row["attempts"].append({"label": label, "operation": operation, "user_id": None,
                                         "verified": False, "activation_nonce": nonce, "settled": False})
            return nonce
    def record(self, _, executor, label, operation, user_id, *, verified=False):
        assert executor == self.row["executor"]
        if self.failure == "record":
            raise RuntimeError("synthetic DB outcome unknown")
        attempt = next(a for a in self.row["attempts"] if a["label"] == label and a["operation"] == operation)
        if attempt["user_id"] and attempt["user_id"] != user_id:
            raise b.Closed()
        attempt.update(user_id=user_id, verified=verified)
    def observe(self, lease, principal, data):
        for a in self.row["attempts"]:
            if (a["operation"] == "activate" and a["label"] == principal.label and not a["settled"]
                    and data["app_metadata"].get("fill_f1_activation_nonce") == a["activation_nonce"]):
                a["settled"] = True
                return True
        return False
    def ban_proof(self, lease, principal, data):
        for a in self.row["attempts"]:
            if (a["operation"] == "activate" and a["label"] == principal.label and a["settled"]
                    and data["app_metadata"].get("fill_f1_activation_nonce") == a["activation_nonce"]):
                a.setdefault("first_ban_readback_at", self.clock.wall())
    def stop(self, _, *, reconcile):
        self.row.update(stopped=True, reconciliation_required=self.row["reconciliation_required"] or reconcile)
    def hydrate(self, _):
        return self.spec
    def enroll(self, _, lease, *, stopped):
        if self.spec and self.spec != lease:
            raise b.Closed()
        self.spec = lease
        self.row["stopped"] |= stopped
    def members(self, *_):
        if self.failure == "members":
            raise b.Closed()


class MemoryLedger:
    def __init__(self, journal):
        self.journal, self.receipts, self.healthy_at, self.complete = journal, {}, None, False
    def pending(self):
        if not self.journal.spec or self.complete:
            return []
        return [{"spec": json.loads(self.journal.spec.document), "stopped": self.journal.row["stopped"]}]
    def snapshot(self, *_):
        return {"spec": json.loads(self.journal.spec.document), "armed": True,
                "stopped": self.journal.row["stopped"], "healthy_at": self.healthy_at,
                "db_now": self.journal.clock.wall(), "receipts": self.receipts, "isolated": True}
    def record(self, lease, receipts, healthy):
        self.receipts, self.healthy_at = receipts, self.journal.clock.wall() if healthy else None
        self.complete = all(receipts.get(p.id) for p in lease.principals) and not any(
            a["operation"] == "activate" and (not a["settled"] or not a.get("first_ban_readback_at"))
            for a in self.journal.row["attempts"])


class AuthServer:
    def __init__(self, clock):
        self.clock, self.users, self.calls, self.failure, self.late = clock, {}, [], None, None
    def handle(self, request):
        self.calls.append((request.method, request.url.path))
        assert request.url.host == g.PROJECT + ".supabase.co"
        assert request.headers["apikey"] == "synthetic-admin-key"
        payload = json.loads(request.content) if request.content else None
        if request.method == "POST":
            assert request.url.path == "/auth/v1/admin/users"
            assert set(payload) == {"email", "password", "email_confirm", "ban_duration", "app_metadata"}
            assert payload["ban_duration"] == "876000h" and payload["email_confirm"] is True
            assert payload["app_metadata"]["fictional"] is True
            user = {"id": str(uuid.uuid4()), "email": payload["email"], "role": "authenticated",
                    "app_metadata": payload["app_metadata"], "created_at": self.clock.wall().isoformat(),
                    "email_confirmed_at": self.clock.wall().isoformat(), "banned_until": "2126-10-31T00:00:00Z"}
            self.users[user["id"]] = user
            if self.failure == "post-timeout":
                raise httpx.ReadTimeout("synthetic sensitive error", request=request)
            if self.failure == "redirect":
                return httpx.Response(307, headers={"location": "https://example.invalid"})
            if self.failure == "late-create":
                self.clock.advance(61)
            if self.failure == "old":
                user = dict(user, id=sorted(g.OLD_USERS)[0])
            if self.failure == "forged":
                user = dict(user, app_metadata={"fill_f1_run": "foreign", "fictional": True})
            return httpx.Response(201, json=user)
        user_id = request.url.path.rsplit("/", 1)[-1]
        if user_id in g.OLD_USERS:
            assert request.method == "GET"
            if self.failure == "preflight":
                return httpx.Response(401, json={"sensitive": "synthetic-key-only"})
            return httpx.Response(200, json={"id": user_id, "role": "authenticated", "banned_until": "2126-10-31T00:00:00Z"})
        user = self.users[user_id]
        if request.method == "PUT":
            if payload["ban_duration"] == "none":
                assert set(payload) == {"ban_duration", "app_metadata"}
                assert payload["app_metadata"]["fill_f1_activation_nonce"]
                def commit():
                    user.update(banned_until=None, app_metadata=payload["app_metadata"])
                if self.failure == "late-unban":
                    self.late = commit
                    raise httpx.ReadTimeout("synthetic unknown activation", request=request)
                commit()
            else:
                assert payload == {"ban_duration": "876000h"}
                user["banned_until"] = "2126-10-31T00:00:00Z"
        return httpx.Response(200, json=user)


@pytest.fixture
def e():
    clock = Clock()
    journal = MemoryJournal(clock)
    ledger = MemoryLedger(journal)
    server = AuthServer(clock)
    admin = g.BanAdmin("synthetic-admin-key", transport=httpx.MockTransport(server.handle))
    admin.settlement = journal
    guard = g.Guard(None, ledger, admin, clock=clock.wall, monotonic=clock.tick)
    plan = b.Plan.parse(plan_input())
    bootstrap = b.Bootstrap(plan, journal, b.FixtureAdmin(admin), guard)
    yield SimpleNamespace(clock=clock, journal=journal, ledger=ledger, server=server, admin=admin,
                          guard=guard, plan=plan, boot=bootstrap)
    admin.close()


def start(e):
    e.journal.prepare()
    e.boot.tick()  # Preflight, T0 not consumed.
    assert e.journal.row["starts_at"] is None and len(e.server.calls) == 1
    e.journal.row["released_at"] = e.clock.wall()
    e.boot.tick()


def canary(e):
    start(e)
    for _ in range(4):  # Three creations, then memberships + immutable lease.
        e.boot.tick()
    e.guard.sweep()
    e.boot.tick()
    return next(p for p in e.guard.lease.principals if p.label == "canary")


def test_no_intent_has_no_auth_call_or_t0(e):
    e.boot.tick()
    assert e.server.calls == [] and e.journal.row is None


def test_preflight_failure_retries_reads_only_without_consuming_authority(e):
    e.journal.prepare()
    e.server.failure = "preflight"
    e.boot.tick()
    assert not e.journal.row["stopped"] and e.journal.row["starts_at"] is None
    assert e.journal.row["preflight_at"] is None
    e.server.failure = None
    e.boot.tick()
    assert e.journal.row["preflight_at"] and e.journal.row["attempts"] == []
    assert all(m == "GET" for m, _ in e.server.calls)


@pytest.mark.parametrize("change", ["hex", "sha", "missing", "extra", "weak", "same"])
def test_private_plan_strict_and_redacted(change):
    value = plan_input()
    if change == "hex": value["run_id"] = uuid.uuid4().hex
    if change == "sha": value["candidate_sha"] = "main"
    if change == "missing": value["passwords"].pop("b")
    if change == "extra": value["customer_email"] = "not-allowed@example.invalid"
    if change == "weak": value["passwords"]["a"] = "short"
    if change == "same": value["passwords"]["a"] = value["passwords"]["b"]
    with pytest.raises(b.Closed): b.Plan.parse(value)
    good = b.Plan.parse(plan_input())
    assert all(p not in repr(good) for p in good.passwords.values())


def test_default_off_does_not_parse_or_access_private_input(monkeypatch):
    monkeypatch.delenv("FILL_UAT_GUARD", raising=False)
    monkeypatch.delenv("FILL_UAT_BOOTSTRAP", raising=False)
    monkeypatch.setenv("FILL_UAT_BOOTSTRAP_INPUT", "malformed secret")
    assert g.from_environment(None, "core", None).bootstrap is None


@pytest.mark.parametrize("bad", ["service", "environment", "url", "sha", "target", "lease", "mode"])
def test_enabled_mode_is_pinned_before_any_db_auth(monkeypatch, bad):
    monkeypatch.setenv("FILL_UAT_GUARD", "on")
    monkeypatch.setenv("FILL_UAT_BOOTSTRAP", "on")
    value = plan_input()
    monkeypatch.setenv("FILL_UAT_BOOTSTRAP_INPUT", json.dumps(value))
    monkeypatch.setenv("FILL_UAT_ADMIN_KEY", "synthetic-admin-key")
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", SHA)
    monkeypatch.setenv("RAILWAY_DEPLOYMENT_ID", str(uuid.uuid4()))
    for k, v in b.TARGET.items(): monkeypatch.setenv(k, v)
    settings = SimpleNamespace(environment="staging", supabase_url=g.ORIGIN)
    service = "operations"
    if bad == "service": service = "core"
    if bad == "environment": settings.environment = "production"
    if bad == "url": settings.supabase_url = "https://example.invalid"
    if bad == "sha": monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "a" * 40)
    if bad == "target": monkeypatch.setenv("RAILWAY_SERVICE_ID", str(uuid.uuid4()))
    if bad == "lease": monkeypatch.setenv("FILL_UAT_LEASE", "{}")
    if bad == "mode": monkeypatch.setenv("FILL_UAT_GUARD", "off")
    with pytest.raises(RuntimeError): g.from_environment(settings, service, None)


def test_canary_positive_then_external_verdict_then_operators(e):
    principal = canary(e)
    assert len(e.server.users) == 3
    assert sum(u["banned_until"] is None for u in e.server.users.values()) == 1
    e.guard.check(Actor(principal.id, e.plan.email("canary"), e.plan.run_id, True))
    e.boot.tick()  # No verdict: operators stay banned.
    e.clock.advance(120)
    e.guard.sweep()
    assert e.server.users[principal.id]["banned_until"]
    e.clock.advance(60)
    e.guard.sweep()
    with pytest.raises(Exception): e.guard.check(Actor(principal.id, "", e.plan.run_id, True))
    e.journal.row.update(verdict={"decision": "pass", "run_id": e.plan.run_id, "candidate_sha": SHA,
        "lease_digest": "1" * 64, "positive_get": True, "denied_login": True, "denied_api": True},
        verdict_at=e.clock.wall())
    for _ in range(2): e.boot.tick()
    assert sum(u["banned_until"] is None for u in e.server.users.values()) == 2
    e.clock.advance(1020)
    e.guard.sweep()
    assert e.ledger.complete and all(u["banned_until"] for u in e.server.users.values())
    assert e.guard.lease.expires_at == START + timedelta(minutes=30)


@pytest.mark.parametrize("failure", ["post-timeout", "redirect", "old", "forged", "late-create", "record", "members"])
def test_create_failure_never_retries_or_activates_and_restart_keeps_budget(e, failure):
    start(e)
    if failure in ("record", "members"): e.journal.failure = failure
    else: e.server.failure = failure
    for _ in range(5): e.boot.tick()
    calls = deepcopy(e.server.calls)
    restarted = b.Bootstrap(e.plan, e.journal, b.FixtureAdmin(e.admin), e.guard)
    restarted.tick()
    assert e.server.calls == calls
    assert e.journal.row["stopped"] and e.journal.row["reconciliation_required"]
    assert not any(a["operation"] == "activate" for a in e.journal.row["attempts"])
    assert len([c for c in calls if c[0] == "POST"]) <= 3


def test_crash_after_reservation_before_post_is_consumed_permanently(e):
    start(e)
    e.journal.reserve(e.plan, e.boot.executor, "canary", "create")
    e.boot.tick()
    assert e.journal.row["stopped"] and len(e.server.users) == 0
    e.clock.advance(61)
    b.Bootstrap(e.plan, e.journal, b.FixtureAdmin(e.admin), e.guard).tick()
    assert len(e.server.users) == 0


def test_partial_known_users_enroll_stopped_and_use_existing_cleanup(e):
    start(e)
    e.boot.tick()
    e.server.failure = "post-timeout"
    e.boot.tick()
    assert len(e.guard.lease.principals) == 1 and e.journal.row["stopped"]
    e.guard.sweep()
    assert e.ledger.complete  # Known IDs only; unknown create remains explicitly unreconciled.
    assert e.journal.row["reconciliation_required"]


def test_late_unban_after_successful_ban_cannot_finish_cleanup_even_across_restart(e):
    start(e)
    for _ in range(4): e.boot.tick()
    e.guard.sweep()
    e.server.failure = "late-unban"
    e.boot.tick()  # Durable nonce reservation, PUT times out while still pending server-side.
    assert e.journal.row["stopped"] and e.server.late
    e.guard.sweep()  # All point-in-time GETs banned, but unknown PUT must keep pending.
    assert all(e.ledger.receipts.values()) and not e.ledger.complete
    restarted = b.Bootstrap(e.plan, e.journal, b.FixtureAdmin(e.admin), e.guard)
    restarted.tick()
    e.guard.sweep()
    assert not e.ledger.complete
    e.server.late()  # Server commits AFTER earlier successful cleanup GET/ban.
    assert any(u["banned_until"] is None for u in e.server.users.values())
    e.guard.sweep()  # Observe unique nonce, then PUT ban + GET through REAL BanAdmin path.
    assert e.ledger.complete and all(u["banned_until"] for u in e.server.users.values())
    assert len([a for a in e.journal.row["attempts"] if a["operation"] == "activate"]) == 1


@pytest.mark.parametrize("field", ["decision", "run_id", "candidate_sha", "lease_digest", "positive_get", "denied_api"])
def test_forged_or_rejected_verdict_never_activates_operators(e, field):
    canary(e)
    e.clock.advance(180)
    e.guard.sweep()
    verdict = {"decision": "pass", "run_id": e.plan.run_id, "candidate_sha": SHA,
               "lease_digest": "1" * 64, "positive_get": True, "denied_login": True, "denied_api": True}
    verdict[field] = "wrong"
    e.journal.row.update(verdict=verdict, verdict_at=e.clock.wall())
    e.boot.tick()
    assert e.journal.row["stopped"]
    assert not any(a["operation"] == "activate" and a["label"] != "canary" for a in e.journal.row["attempts"])


def test_restart_hydrates_same_lease_never_replays_activation(e):
    canary(e)
    calls = deepcopy(e.server.calls)
    e.guard.lease = None
    restarted = b.Bootstrap(e.plan, e.journal, b.FixtureAdmin(e.admin), e.guard)
    restarted.tick()
    assert e.guard.lease.starts_at == START and e.server.calls == calls
    e.clock.advance(1200)
    e.guard.sweep()
    assert e.ledger.complete


def test_first_autonomous_canary_ban_late_is_failure_even_if_latest_health_is_good(e):
    principal = canary(e)
    e.clock.advance(181)
    e.guard.sweep()
    activation = next(a for a in e.journal.row["attempts"] if a["operation"] == "activate")
    assert activation["first_ban_readback_at"] == START + timedelta(seconds=181)
    e.clock.advance(9)
    e.guard.sweep()
    assert activation["first_ban_readback_at"] == START + timedelta(seconds=181)
    e.journal.row.update(verdict={"decision": "pass", "run_id": e.plan.run_id, "candidate_sha": SHA,
        "lease_digest": "1" * 64, "positive_get": True, "denied_login": True, "denied_api": True},
        verdict_at=e.clock.wall())
    e.boot.tick()
    assert e.journal.row["stopped"] and e.server.users[principal.id]["banned_until"]
    assert not any(a["operation"] == "activate" and a["label"] != "canary" for a in e.journal.row["attempts"])


def test_activation_reservation_crash_never_replays_and_remains_unsettled(e):
    start(e)
    for _ in range(4): e.boot.tick()
    e.guard.sweep()
    e.journal.reserve(e.plan, e.boot.executor, "canary", "activate")
    e.boot.tick()
    assert e.journal.row["stopped"]
    e.guard.sweep()
    assert all(e.ledger.receipts.values()) and not e.ledger.complete
    e.clock.advance(1801)
    b.Bootstrap(e.plan, e.journal, b.FixtureAdmin(e.admin), e.guard).tick()
    e.guard.sweep()
    assert not e.ledger.complete and not any(u["banned_until"] is None for u in e.server.users.values())


@pytest.mark.parametrize("failure", ["db", "clock"])
def test_outages_and_clock_jumps_close_without_http_retry(e, failure):
    canary(e)
    if failure == "db": e.journal.failure = "db"
    else: e.clock.skew = 4
    calls = deepcopy(e.server.calls)
    e.boot.tick()
    assert e.guard.cleanup_error and e.server.calls == calls


def test_concurrent_claimants_do_not_create_twice(e):
    e.journal.prepare()
    e.boot.tick()
    e.journal.row["released_at"] = e.clock.wall()
    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(lambda _: e.journal.claim(e.plan, e.boot.executor), range(4)))
    assert sum(claims) == 1
    observer = b.Bootstrap(e.plan, e.journal, b.FixtureAdmin(e.admin), e.guard)
    observer.tick()
    assert not any(method == "POST" for method, _ in e.server.calls)


def test_bootstrap_shutdown_does_not_close_admin_before_inflight_step_finishes(e, monkeypatch):
    # Actual lifespan path: bootstrap work is separate from the sole sweep.
    import threading
    entered, release = threading.Event(), threading.Event()
    events = []
    def tick():
        entered.set()
        release.wait(timeout=3)
        events.append("bootstrap-finished")
    original_close = e.admin.close
    e.admin.close = lambda: events.append("admin-closed")
    e.guard.bootstrap = SimpleNamespace(tick=tick)
    monkeypatch.setattr(g, "POLL_SECONDS", 0.01)
    async def scenario():
        async with e.guard.lifespan(None):
            await asyncio.wait_for(asyncio.to_thread(entered.wait), timeout=2)
            release.set()
    try:
        asyncio.run(scenario())
        assert events == ["bootstrap-finished", "admin-closed"]
    finally:
        release.set()
        original_close()


def test_actual_lifespan_waits_for_sole_cleanup_health_before_canary_activation(e, monkeypatch):
    e.journal.prepare()
    e.guard.bootstrap = e.boot
    phases = []
    original_tick = e.boot.tick
    def tracked_tick():
        phases.append("start")
        original_tick()
        phases.append("done")
    e.boot.tick = tracked_tick
    monkeypatch.setattr(g, "POLL_SECONDS", 0.08)
    monkeypatch.setattr(g, "BOOTSTRAP_SECONDS", 0.005)
    async def wait_until(predicate):
        for _ in range(2000):
            if predicate(): return
            await asyncio.sleep(0.005)
        raise AssertionError("Synthetic lifespan phase: " + repr({
            "stopped": e.journal.row["stopped"], "health": e.ledger.healthy_at,
            "attempts": [(a["label"], a["operation"], a["verified"]) for a in e.journal.row["attempts"]],
            "calls": e.server.calls, "ticks": phases}))
    async def scenario():
        async with e.guard.lifespan(None):
            await wait_until(lambda: e.journal.row["preflight_at"] is not None)
            assert e.journal.row["starts_at"] is None
            e.journal.row["released_at"] = e.clock.wall()
            await wait_until(lambda: any(a["operation"] == "activate" and a["verified"]
                                         for a in e.journal.row["attempts"]))
            assert not e.journal.row["stopped"] and e.ledger.healthy_at is not None
            assert len(e.server.users) == 3
            assert sum(u["banned_until"] is None for u in e.server.users.values()) == 1
    asyncio.run(scenario())


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Existing local/CI PostgreSQL only")
def test_postgres_private_journal_constraints_barrier_and_transaction_rollback():
    engine = create_engine(os.environ["TEST_DATABASE_URL"])
    with engine.connect() as c:
        tx = c.begin()
        class ConnectionEngine:
            @contextmanager
            def begin(self): yield c
        journal = b.Journal(ConnectionEngine())
        plan = b.Plan.parse(plan_input())
        executor = str(uuid.uuid4())
        try:
            for org in sorted(g.ORGANIZATIONS):
                c.execute(text("insert into public.organizations(id,slug,name) values(cast(:id as uuid),:slug,'FICTIONAL CI') "
                               "on conflict(id) do nothing"), {"id": org, "slug": "bootstrap-ci-"+org})
            params = {"run": plan.run_id, "auth": plan.authorization_id, "sha": SHA, "digest": plan.digest,
                      "orgs": json.dumps(sorted(g.ORGANIZATIONS)), "deployment": str(uuid.uuid4())}
            insert = """insert into fill_private.uat_bootstrap_intents
              (run_id,authorization_id,candidate_sha,project_ref,organization_ids,input_digest,deployment_id,settled_at,request_expires_at)
              values(cast(:run as uuid),cast(:auth as uuid),:sha,'yclqnbcrchwieyzkyumx',cast(:orgs as jsonb),:digest,
                     cast(:deployment as uuid),clock_timestamp(),clock_timestamp()+interval '4 minutes')"""
            c.execute(text(insert), params)
            journal.preflight(plan, executor)
            assert journal.read(plan)["starts_at"] is None
            c.execute(text("update fill_private.uat_bootstrap_intents set released_at=clock_timestamp() where run_id=cast(:run as uuid)"), params)
            assert journal.claim(plan, executor) and not journal.claim(plan, str(uuid.uuid4()))
            for label in b.LABELS: journal.reserve(plan, executor, label, "create")
            for label in b.LABELS:
                with pytest.raises(Exception), c.begin_nested(): journal.reserve(plan, executor, label, "create")
            for statement in [
                "delete from fill_private.uat_bootstrap_intents where run_id=cast(:run as uuid)",
                "update fill_private.uat_bootstrap_intents set starts_at=clock_timestamp() where run_id=cast(:run as uuid)",
                "update fill_private.uat_bootstrap_intents set candidate_sha=repeat('a',40) where run_id=cast(:run as uuid)",
                "delete from fill_private.uat_bootstrap_attempts where run_id=cast(:run as uuid)",
            ]:
                with pytest.raises(Exception), c.begin_nested(): c.execute(text(statement), params)
            duplicate = dict(params, run=str(uuid.uuid4()))
            with pytest.raises(Exception), c.begin_nested(): c.execute(text(insert), duplicate)
            for role in ("anon", "authenticated"):
                with pytest.raises(Exception), c.begin_nested():
                    c.execute(text("set local role " + role))
                    c.execute(text("select * from fill_private.uat_bootstrap_intents"))
                with pytest.raises(Exception), c.begin_nested():
                    c.execute(text("set local role " + role))
                    c.execute(text("select * from fill_private.uat_bootstrap_attempts"))
            ids = [str(uuid.uuid4()) for _ in b.LABELS]
            for label, user_id in zip(b.LABELS, ids):
                journal.record(plan, executor, label, "create", user_id, verified=True)
            row = journal.read(plan)
            lease = b.lease_for(plan, row["starts_at"], row["attempts"])
            journal.enroll(plan, lease, stopped=False)
            ledger = g.SQLLedger(ConnectionEngine())
            ledger.bootstrap_barrier = True
            ledger.record(lease, {}, True)
            nonce = journal.reserve(plan, executor, "canary", "activate")
            journal.stop(plan, reconcile=True)
            ledger.record(lease, {p.id: True for p in lease.principals}, True)
            assert not c.execute(text("select cleanup_complete from fill_private.uat_runs where run_id=cast(:run as uuid)"), params).scalar_one()
            principal = lease.principal(ids[0])
            assert not journal.observe(lease, principal, {"app_metadata": {"fill_f1_activation_nonce": str(uuid.uuid4())}})
            assert journal.observe(lease, principal, {"app_metadata": {"fill_f1_activation_nonce": nonce}})
            journal.ban_proof(lease, principal, {"app_metadata": {"fill_f1_activation_nonce": nonce}})
            first = c.execute(text("select first_ban_readback_at from fill_private.uat_bootstrap_attempts "
                                   "where run_id=cast(:run as uuid) and operation='activate'"), params).scalar_one()
            assert first is not None
            journal.ban_proof(lease, principal, {"app_metadata": {"fill_f1_activation_nonce": nonce}})
            assert c.execute(text("select first_ban_readback_at from fill_private.uat_bootstrap_attempts "
                                  "where run_id=cast(:run as uuid) and operation='activate'"), params).scalar_one() == first
            with pytest.raises(Exception), c.begin_nested():
                c.execute(text("update fill_private.uat_bootstrap_attempts set first_ban_readback_at=clock_timestamp() "
                               "where run_id=cast(:run as uuid) and operation='activate'"), params)
            ledger.record(lease, {p.id: True for p in lease.principals}, True)
            assert c.execute(text("select cleanup_complete from fill_private.uat_runs where run_id=cast(:run as uuid)"), params).scalar_one()
        finally:
            tx.rollback()
    engine.dispose()


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Existing local/CI PostgreSQL only")
def test_postgres_concurrent_claim_and_budget_use_real_commits():
    # Disposable CI database only. Committed private evidence is intentionally
    # retained: production-style append-only triggers must not be bypassed.
    engine = create_engine(os.environ["TEST_DATABASE_URL"])
    plan = b.Plan.parse(plan_input())
    journal = b.Journal(engine)
    executor = str(uuid.uuid4())
    with engine.begin() as c:
        for org in sorted(g.ORGANIZATIONS):
            c.execute(text("insert into public.organizations(id,slug,name) values(cast(:id as uuid),:slug,'FICTIONAL CI') "
                           "on conflict(id) do nothing"), {"id": org, "slug": "bootstrap-ci-"+org})
        c.execute(text("""insert into fill_private.uat_bootstrap_intents
          (run_id,authorization_id,candidate_sha,project_ref,organization_ids,input_digest,deployment_id,settled_at,request_expires_at)
          values(cast(:run as uuid),cast(:auth as uuid),:sha,'yclqnbcrchwieyzkyumx',cast(:orgs as jsonb),:digest,
                 cast(:deployment as uuid),clock_timestamp(),clock_timestamp()+interval '4 minutes')"""),
          {"run": plan.run_id, "auth": plan.authorization_id, "sha": SHA, "digest": plan.digest,
           "orgs": json.dumps(sorted(g.ORGANIZATIONS)), "deployment": str(uuid.uuid4())})
    journal.preflight(plan, executor)
    with engine.begin() as c:
        c.execute(text("update fill_private.uat_bootstrap_intents set released_at=clock_timestamp() "
                       "where run_id=cast(:run as uuid)"), {"run": plan.run_id})
    with ThreadPoolExecutor(max_workers=3) as pool:
        winners = list(pool.map(lambda _: journal.claim(plan, executor), range(3)))
    assert winners.count(True) == 1
    def reserve(label):
        try:
            journal.reserve(plan, executor, label, "create")
            return True
        except Exception:
            return False
    with ThreadPoolExecutor(max_workers=5) as pool:
        reserved = list(pool.map(reserve, ("canary", "a", "b", "a", "canary")))
    assert reserved.count(True) == 3
    restarted = b.Journal(engine)
    row = restarted.read(plan)
    assert len(row["attempts"]) == 3
    assert not restarted.claim(plan, str(uuid.uuid4()))
    assert all(not reserve(label) for label in b.LABELS)
    journal.stop(plan, reconcile=True)
    engine.dispose()
