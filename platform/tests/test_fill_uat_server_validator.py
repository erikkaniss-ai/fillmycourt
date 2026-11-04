"""Dummy IDs/times, mocked HTTP/journal/clock only. Never hosted acceptance."""
import asyncio
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
import threading
from types import SimpleNamespace
import uuid

import httpx
import pytest
from sqlalchemy import create_engine, text

from fmc import fill_uat_guard as g
from fmc import fill_uat_bootstrap as b
from fmc import fill_uat_server_validator as s

ID = lambda n: str(uuid.UUID(int=n))
START = datetime(2030, 1, 1, tzinfo=timezone.utc)
PUBLIC_KEY = "sb_publishable_" + "PUBLIC_SENTINEL" * 3
PASSWORD = "PUBLIC_PASSWORD_SENTINEL_" + "x" * 40
TOKEN = "PUBLIC_USER_JWT_SENTINEL." + "x" * 30 + ".signature"


class Clock:
    seconds = 0
    skew = 0
    def wall(self):
        return START + timedelta(seconds=self.seconds + self.skew)
    def tick(self):
        return self.seconds
    async def sleep(self, n):
        self.seconds += n
        await asyncio.sleep(0)


class Port:
    def __init__(self, env):
        self.e, self.calls, self.stopped, self.initial, self.mutate = env, 0, False, True, None
    def read(self):
        self.calls += 1
        e, n, now = self.e, self.e.clock.seconds, self.e.clock.wall()
        creates = [{"label": label, "operation": "create", "user_id": e.ids[label], "verified": True,
                    "settled": False, "activation_nonce": ID(200+i), "reserved_at": START+timedelta(seconds=i+1),
                    "first_ban_readback_at": None} for i, label in enumerate(s.LABELS) if n >= i+1]
        actions = list(creates)
        for label, reserved, settled in (("canary", 5, n >= 6), ("a", 186, n >= 187), ("b", 188, n >= 191)):
            if n >= reserved and (label == "canary" or e.runner.root_ready):
                actions.append({"label": label, "operation": "activate", "user_id": e.ids[label] if settled else None,
                    "verified": settled, "settled": settled, "activation_nonce": ID(300+s.LABELS.index(label)),
                    "reserved_at": START+timedelta(seconds=reserved),
                    "first_ban_readback_at": START+timedelta(seconds=120) if label == "canary" and n >= 120 else now if self.stopped else None})
        row = {"run_id": e.cfg.run_id, "authorization_id": e.cfg.authorization_id, "candidate_sha": e.cfg.operations_sha,
            "deployment_id": e.cfg.deployment_id, "project_ref": g.PROJECT, "organization_ids": sorted(g.ORGANIZATIONS),
            "db_now": now, "stopped": self.stopped, "reconciliation_required": self.stopped,
            "starts_at": None if self.initial else START, "executor": e.boot.executor,
            "request_expires_at": START+timedelta(seconds=300), "attempts": actions,
            "lease_digest": "e"*64, "verdict": None, "verdict_at": None}
        self.initial = False
        if e.runner.proof and n >= 184:
            row["verdict"] = {"run_id": e.cfg.run_id, "candidate_sha": e.cfg.operations_sha,
                "lease_digest": "e"*64, "decision": "pass", "positive_get": True, "denied_login": True,
                "denied_api": True, "evidence_ref": e.cfg.receipt_document+"#"+e.runner.proof_digest}
            row["verdict_at"] = START+timedelta(seconds=184)
        active = lambda label: not self.stopped and (6 <= n < 120 if label == "canary" else e.runner.root_ready and n >= (187 if label == "a" else 191))
        bans = {uid: START+timedelta(days=36500) for uid in e.cfg.historical_ids}
        bans.update({e.ids[a["label"]]: None if active(a["label"]) else START+timedelta(days=36500) for a in creates})
        markers = {e.ids[a["label"]]: {"run_marker": e.cfg.run_id, "fictional": "true", "created_at": START+timedelta(seconds=3),
                   "nonce": ID(300+s.LABELS.index(a["label"]))} for a in creates}
        members = [{"user_id": e.ids[label], "organization_id": e.cfg.organizations["b" if label == "b" else "a"],
                    "role": "manager" if label == "b" else "owner"} for label in s.LABELS]
        run = {"spec": e.spec, "armed": True, "stopped": self.stopped, "cleanup_complete": self.stopped,
               "healthy_at": now, "receipts": {uid: self.stopped or label == "canary" and n >= 120 for label, uid in e.ids.items()}}
        data = {"intent": row, "run": run if n >= 4 else None, "bans": bans, "markers": markers, "members": members, "prior_unknown": False}
        if self.mutate:
            self.mutate(data)
        return data
    def stop(self):
        self.stopped = True
        return True


@pytest.fixture
def e(monkeypatch):
    monkeypatch.setattr(g, "OLD_USERS", frozenset(ID(i) for i in range(1, 5)))
    monkeypatch.setattr(g, "ORGANIZATIONS", frozenset({ID(101), ID(102)}))
    clock = Clock()
    cfg = s.Binding.parse({"operations_sha": "a"*40, "preview_sha": "b"*40, "deployment_id": ID(105),
        "run_id": ID(106), "authorization_id": ID(107), "historical_ids": [ID(i) for i in range(1, 18)],
        "organizations": {"a": ID(101), "b": ID(102)}, "receipt_document": "https://docs.google.com/document/d/DUMMY_PRIVATE_DOC/edit",
        "admission_expires_at": (START+timedelta(seconds=300)).isoformat(), "operations_origin": "https://ops-dummy.up.railway.app"})
    plan = b.Plan.parse({"run_id": cfg.run_id, "authorization_id": cfg.authorization_id, "candidate_sha": cfg.operations_sha,
                         "passwords": {label: PASSWORD+label for label in s.LABELS}})
    ids = dict(zip(s.LABELS, (ID(111), ID(112), ID(113))))
    spec = {"run_id": cfg.run_id, "candidate_sha": cfg.operations_sha, "project_ref": g.PROJECT, "organization_ids": sorted(g.ORGANIZATIONS),
        "starts_at": START.isoformat(), "expires_at": (START+timedelta(seconds=1800)).isoformat(),
        "principals": [{"id": ids[label], "label": label, "ban_at": (START+timedelta(seconds=120 if label == "canary" else 1200)).isoformat(),
                        "expires_at": (START+timedelta(seconds=180 if label == "canary" else 1800)).isoformat()} for label in s.LABELS]}
    env = SimpleNamespace(clock=clock, cfg=cfg, plan=plan, ids=ids, spec=spec, logs=[], http=[], fault=None)
    env.boot = SimpleNamespace(plan=plan, executor=ID(109), guard=SimpleNamespace(cleanup_error=False))
    env.port = Port(env)
    def handler(request):
        env.http.append((request.method, request.url.path, clock.seconds))
        if request.url.path == "/auth/v1/token":
            assert request.method == "POST" and request.headers["apikey"] == PUBLIC_KEY and "authorization" not in request.headers
            payload = json.loads(request.content)
            label = next(k for k in s.LABELS if payload["email"] == plan.email(k))
            assert payload["password"] == plan.passwords[label]
            if label == "canary" and clock.seconds >= 120:
                return httpx.Response(400, json={"error_code": "user_banned"} if env.fault != "ban-code" else {"error_code": "invalid_credentials"})
            user = {"id": ids[label], "email": plan.email(label), "role": "authenticated", "email_confirmed_at": START.isoformat(),
                    "created_at": (START+timedelta(seconds=3)).isoformat(), "app_metadata": {"fill_f1_run": cfg.run_id, "fictional": True}}
            if env.fault == "foreign-user":
                user["id"] = ID(999)
            return httpx.Response(200, json={"user": user, "access_token": TOKEN, "refresh_token": "UNUSED_REFRESH_SENTINEL", "expires_in": 3600})
        assert request.method == "GET" and request.headers["authorization"] == "Bearer "+TOKEN and "apikey" not in request.headers
        path = request.url.path
        if clock.seconds >= 120 and not env.runner.operator_gate:
            return httpx.Response(200 if env.fault == "retained-200" else 403, json={})
        if ID(102) in path and not env.runner.operator_gate:
            return httpx.Response(403, json={})
        label = "b" if sum(1 for method, url, _ in env.http if method == "POST" and url == "/auth/v1/token") >= 4 else "a"
        # Mock user identities are selected by the test's serialized login order.
        if not env.runner.operator_gate:
            label = "canary"
        own = cfg.organizations["b" if label == "b" else "a"]
        if path == "/api/me":
            body = {"user": {"id": ids[label]}}
        elif path == "/api/fmc/organizations":
            body = {"items": [{"id": own, "role": "manager" if label == "b" else "owner"}]}
        elif "provider-provenance" in path:
            if label == "b":
                return httpx.Response(403, json={})
            body = {"items": []}
        elif own not in path:
            return httpx.Response(403, json={})
        elif path.endswith("today"):
            body = {"date": START.date().isoformat(), "courts": []}
        else:
            body = {"bookings": [], "holds": [], "blocks": []}
        return httpx.Response(200, json=body)
    env.client = None
    def factory():
        env.client = s.Clients(PUBLIC_KEY, plan, cfg.operations_origin, auth_transport=httpx.MockTransport(handler), ops_transport=httpx.MockTransport(handler), clock=clock.wall)
        return env.client
    env.runner = s.ServerValidator(cfg, env.boot, env.port, factory, clock=clock.wall, monotonic=clock.tick, sink=env.logs.append, sleep=clock.sleep)
    return env


def test_happy_private_proof_root_gate_staggered_roles_and_cleanup(e, caplog):
    asyncio.run(e.runner.run())
    final = e.logs[-1]
    assert final["status"] == "READS_COMPLETE", e.logs
    assert final["durable_stop"] and final["client_closed"] and final["owned_pending"] == 0
    assert final["cleanup"]["status"] == "ALLOCATED_IDENTITIES_VERIFIED" and final["cleanup"]["known_banned"] == 20
    assert len(e.runner.events) == 21 and e.runner.operator_gate
    assert len([x for x in e.http if x[0] == "POST"]) == 4
    assert all(at >= 191 for method, path, at in e.http if e.runner.operator_gate and at >= 184)
    proof = next(x for x in e.logs if x["kind"] == "PRIVATE_FINAL_CANARY")
    assert proof["sha256"] == hashlib.sha256(s.canonical(proof["proof"]).encode()).hexdigest()
    assert proof["proof"]["operations_sha"] != proof["proof"]["preview_sha"]
    encoded = s.canonical(e.logs)+caplog.text+repr(e.runner)+repr(e.cfg)
    for value in (PASSWORD, TOKEN, PUBLIC_KEY, "UNUSED_REFRESH_SENTINEL", e.plan.digest):
        assert value not in encoded
    assert not e.client.sessions and e.port.stopped


@pytest.mark.parametrize("fault", ["foreign-user", "ban-code", "retained-200"])
def test_http_foreign_or_ambiguous_denial_stops_without_operator_gate(e, fault):
    e.fault = fault
    asyncio.run(e.runner.run())
    assert e.runner.failed and e.port.stopped and not e.runner.operator_gate
    assert e.logs[-1]["status"] != "READS_COMPLETE"


@pytest.mark.parametrize("mutation", [
    lambda d: d["intent"].update(stopped=True),
    lambda d: d["intent"].update(authorization_id=ID(999)),
    lambda d: d["intent"].update(deployment_id=ID(999)),
    lambda d: d["intent"].update(candidate_sha="f"*40),
    lambda d: d["intent"].update(db_now=START-timedelta(seconds=11)),
    lambda d: d.update(prior_unknown=True),
    lambda d: d["bans"].pop(ID(1)),
    lambda d: d["bans"].update({ID(1): START}),
    lambda d: d["markers"][ID(111)].update(nonce="wrong"),
    lambda d: d["members"][0].update(role="manager"),
    lambda d: d["members"].append({"user_id": ID(111), "organization_id": ID(999), "role": "owner"}),
    lambda d: d["run"].update(healthy_at=START-timedelta(seconds=50)),
])
def test_binding_stale_foreign_nonce_and_isolation_denied_before_http(e, mutation):
    e.port.initial = False
    e.clock.seconds = 10
    e.runner.ready = True
    e.port.mutate = mutation
    asyncio.run(e.runner.run())
    assert e.runner.failed and not e.http and e.port.stopped


def test_restart_started_run_cannot_replay_login(e):
    e.port.initial = False
    e.clock.seconds = 10
    asyncio.run(e.runner.run())
    assert not e.http and e.runner.failed and e.port.stopped


@pytest.mark.parametrize("change", ["reference", "source", "future", "proof"])
def test_root_grant_private_digest_source_and_time_rejected(e, change):
    original = e.port.read
    def read():
        d = original()
        if d["intent"]["verdict"]:
            if change == "reference":
                d["intent"]["verdict"]["evidence_ref"] = "https://example.invalid/public"
            elif change == "source":
                d["intent"]["verdict"]["candidate_sha"] = "f"*40
            elif change == "future":
                d["intent"]["verdict_at"] = e.clock.wall()+timedelta(seconds=1)
            else:
                e.runner.proof["preview_sha"] = "f"*40
        return d
    e.port.read = read
    asyncio.run(e.runner.run())
    assert e.runner.failed and not e.runner.operator_gate
    assert len([x for x in e.http if x[0] == "POST"]) == 2


def test_default_off_no_config_clients_or_bootstrap_access(monkeypatch):
    monkeypatch.delenv("FILL_UAT_SERVER_VALIDATOR", raising=False)
    monkeypatch.setenv("FILL_UAT_SERVER_BINDING", "PRIVATE_INVALID_SENTINEL")
    assert s.from_environment(None, "core", None, None) is None
    assert s.from_environment(None, "operations", None, None) is None


def test_enabled_requires_ops_and_runtime_binding_without_constructing_client(e, monkeypatch):
    monkeypatch.setenv("FILL_UAT_SERVER_VALIDATOR", "on")
    raw = dict(e.cfg.__dict__, historical_ids=list(e.cfg.historical_ids), admission_expires_at=e.cfg.admission_expires_at.isoformat(), deployment_id="runtime")
    monkeypatch.setenv("FILL_UAT_SERVER_BINDING", json.dumps(raw))
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", e.cfg.operations_sha)
    monkeypatch.setenv("RAILWAY_DEPLOYMENT_ID", e.cfg.deployment_id)
    monkeypatch.setenv("RAILWAY_PUBLIC_DOMAIN", "ops-dummy.up.railway.app")
    guard = SimpleNamespace(bootstrap=e.boot, clock=e.clock.wall, monotonic=e.clock.tick, is_fixture=lambda a: True, check=lambda *a: None)
    settings = SimpleNamespace(environment="staging", supabase_publishable_key=PUBLIC_KEY)
    assert s.from_environment(settings, "core", guard, None) is None
    r = s.from_environment(settings, "operations", guard, None)
    assert r.client is None and r.read_pool is None and not r.admission_ready
    r.failed = True
    with pytest.raises(Exception):
        guard.check(object())


def test_bootstrap_gates_admission_before_any_admin_call(e):
    journal = SimpleNamespace(read=lambda _: {"db_now": e.clock.wall(), "stopped": False})
    guard = SimpleNamespace(now=e.clock.wall)
    boot = b.Bootstrap(e.plan, journal, object(), guard)
    boot.server_validator = SimpleNamespace(admission_ready=False)
    boot.step()  # no journal.claim/reserve or Admin method is available


def test_validator_hung_read_does_not_block_existing_guard_cleanup(e, monkeypatch):
    release = threading.Event()
    calls = []
    def hung():
        release.wait(5)
        return None
    e.port.read = hung
    ledger = SimpleNamespace(pending=lambda: calls.append(1) or [])
    guard = g.Guard(g.Lease.parse(e.spec), ledger, SimpleNamespace(close=lambda: None), clock=e.clock.wall, monotonic=e.clock.tick)
    e.boot.guard = guard
    monkeypatch.setattr(g, "POLL_SECONDS", .01)
    async def exercise():
        try:
            async with guard.lifespan(None):
                await asyncio.wait_for(e.runner.run(), 4)
                assert len(calls) > 3
                assert e.logs[-1]["owned_pending"] == 1
                assert e.logs[-1]["cleanup"]["status"] == "UNKNOWN"
        finally:
            release.set()
            await asyncio.gather(*list(e.runner.jobs), return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    assert not e.runner.jobs and not e.http
    assert any(x["kind"] == "PRIVATE_VALIDATOR_OWNERSHIP_DRAINED" for x in e.logs)
    timeout = next(x for x in e.logs if x["kind"] == "PRIVATE_VALIDATOR_STAGE_TIMEOUT")
    late = next(x for x in e.logs if x["kind"] == "PRIVATE_VALIDATOR_LATE_STAGE")
    assert timeout["stage"] == late["stage"] == "admission_snapshot"
    assert timeout["elapsed_ms"] >= 1900 and late["outcome"] == "complete"


def test_late_auth_response_after_close_cannot_restore_session(e):
    async def exercise():
        entered, release = asyncio.Event(), asyncio.Event()
        async def late(request):
            entered.set()
            await release.wait()
            return httpx.Response(200, json={"access_token": TOKEN, "expires_in": 3600,
                "user": {"id": e.ids["canary"], "email": e.plan.email("canary"), "role": "authenticated",
                "email_confirmed_at": START.isoformat(), "created_at": START.isoformat(),
                "app_metadata": {"fill_f1_run": e.cfg.run_id, "fictional": True}}})
        client = s.Clients(PUBLIC_KEY, e.plan, e.cfg.operations_origin, auth_transport=httpx.MockTransport(late), ops_transport=httpx.MockTransport(late), clock=e.clock.wall)
        task = asyncio.create_task(client.login("canary", e.ids["canary"], START))
        await entered.wait()
        await client.close()
        release.set()
        with pytest.raises(s.Closed):
            await task
        assert not client.sessions
    asyncio.run(exercise())


def test_expired_user_session_denies_before_operations_request(e):
    async def exercise():
        client = e.runner.client_factory()
        client.sessions["a"] = (TOKEN, START)
        with pytest.raises(s.Closed):
            await client.get("a", "me", e.ids["a"], e.cfg.organizations, START.date().isoformat())
        await client.close()
        assert not e.http
    asyncio.run(exercise())


@pytest.mark.parametrize("key", ["sb_secret_"+"x"*40, "service_role_sentinel", "opaque.jwt.sentinel"])
def test_user_clients_refuse_privileged_or_opaque_key(e, key):
    with pytest.raises(s.Closed):
        s.Clients(key, e.plan, e.cfg.operations_origin)


def test_bootstrap_operator_activation_waits_for_private_server_gate(e):
    e.clock.seconds = 10
    e.port.initial = False
    e.runner.ready = True
    data = e.port.read()
    row = data["intent"]
    journal = SimpleNamespace(read=lambda _: row, hydrate=lambda _: g.Lease.parse(e.spec))
    boot = b.Bootstrap(e.plan, journal, object(), SimpleNamespace(now=e.clock.wall), executor=e.boot.executor)
    boot.server_validator = SimpleNamespace(admission_ready=True, root_grant_ready=False)
    boot.step()  # no Admin activate/reserve method exists: private gate wins


def test_consume_request_slot_even_on_ambiguous_http_failure(e):
    e.runner.client = e.runner.client_factory()
    e.port.initial = False
    e.clock.seconds = 10
    e.runner.ready = True
    async def exercise():
        e.runner.read_pool = s.ThreadPoolExecutor(max_workers=1)
        try:
            async def fail(*args, **kwargs):
                raise httpx.ReadTimeout(PASSWORD)
            e.runner.client.login = fail
            with pytest.raises(httpx.ReadTimeout):
                await e.runner.action("canary", "login", login=True)
            with pytest.raises(s.Closed):
                await e.runner.action("canary", "login", login=True)
        finally:
            await e.runner.client.close()
            e.runner.read_pool.shutdown()
    asyncio.run(exercise())


def test_document_reference_fits_existing_verdict_schema_and_no_public_sink(e):
    assert len(e.cfg.receipt_document+"#"+"a"*64) <= 200
    assert s.re.fullmatch(r"[A-Za-z0-9_:/#.-]{1,200}", e.cfg.receipt_document+"#"+"a"*64)
    raw = dict(e.cfg.__dict__, historical_ids=list(e.cfg.historical_ids), admission_expires_at=e.cfg.admission_expires_at.isoformat())
    raw["receipt_document"] = "https://github.com/example/repo/pull/1"
    with pytest.raises(s.Closed):
        s.Binding.parse(raw)


def test_clock_rollback_and_unknown_create_never_issue_http(e):
    e.port.initial = False
    e.clock.seconds = -1
    asyncio.run(e.runner.run())
    assert e.runner.failed and not e.http


def test_missing_identity_and_unsettled_nonce_are_not_ready(e):
    e.port.initial = False
    e.clock.seconds = 10
    e.runner.ready = True
    def mutate(data):
        data["intent"]["attempts"][0].update(verified=False, user_id=None, reserved_at=START)
    e.port.mutate = mutate
    asyncio.run(e.runner.run())
    assert e.runner.failed and not e.http and e.port.stopped


def test_core_creation_ignores_server_mode_and_has_no_new_public_endpoint(e, monkeypatch):
    from fmc import v1_app
    from fmc.config import Settings
    monkeypatch.setenv("FILL_UAT_SERVER_VALIDATOR", "on")
    monkeypatch.setenv("FILL_UAT_GUARD", "off")
    monkeypatch.setenv("FILL_UAT_BOOTSTRAP", "off")
    monkeypatch.setattr(v1_app, "V1Store", lambda _: SimpleNamespace(engine=None))
    app = v1_app.create_v1_app(Settings(database="dummy", environment="staging"), "core", auth_override=object())
    assert app.router.lifespan_context == app.state.fill_uat_guard.lifespan
    assert all("validator" not in route.path for route in app.routes)


def test_existing_journal_remains_only_control_schema_and_has_once_only_authority():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    schema = (root/"supabase/migrations/20261031004340_fill_uat_bootstrap.sql").read_text()
    assert "authorization_id uuid not null unique" in schema
    assert "(old.stopped and not new.stopped)" in schema
    source = (root/"src/fmc/fill_uat_server_validator.py").read_text()
    assert "create table" not in source.lower() and "subprocess" not in source
    assert '"/auth/v1/admin' not in source and '"FILL_UAT_ADMIN_KEY"' not in source


def test_runtime_default_is_pinned_https_not_local_asgi(e):
    async def exercise():
        client = s.Clients(PUBLIC_KEY, e.plan, e.cfg.operations_origin)
        assert str(client.ops.base_url).startswith("https://ops-dummy.up.railway.app")
        assert not isinstance(client.ops._transport, httpx.ASGITransport)
        assert not client.ops.follow_redirects and client.ops.trust_env is False
        await client.close()  # constructs/closes transport, sends no request
    asyncio.run(exercise())


@pytest.mark.parametrize("origin", ["http://localhost", "https://example.invalid", "https://ops-dummy.up.railway.app/foreign", "https://ops-dummy.up.railway.app:444"])
def test_foreign_redirect_or_local_origin_denied(e, origin):
    raw = dict(e.cfg.__dict__, historical_ids=list(e.cfg.historical_ids), admission_expires_at=e.cfg.admission_expires_at.isoformat())
    raw["operations_origin"] = origin
    with pytest.raises(s.Closed):
        s.Binding.parse(raw)


def test_invalid_validator_leaves_guard_lifespan_running_and_bootstrap_closed(e, monkeypatch):
    monkeypatch.setenv("FILL_UAT_SERVER_VALIDATOR", "on")
    monkeypatch.setenv("FILL_UAT_SERVER_BINDING", "INVALID_PRIVATE_INPUT_SENTINEL")
    calls = []
    monkeypatch.setattr(g, "POLL_SECONDS", .01)
    async def exercise():
        loop, two_sweeps = asyncio.get_running_loop(), asyncio.Event()
        def pending():
            calls.append(1)
            if len(calls) >= 2:
                loop.call_soon_threadsafe(two_sweeps.set)
            return []
        guard = g.Guard(g.Lease.parse(e.spec), SimpleNamespace(pending=pending), SimpleNamespace(close=lambda: None), clock=e.clock.wall, monotonic=e.clock.tick)
        guard.bootstrap = None
        runner = s.from_environment(SimpleNamespace(environment="staging"), "operations", guard, None)
        assert isinstance(runner, s.RejectedValidator) and not runner.admission_ready
        async with guard.lifespan(None):
            async with runner.lifespan(None):
                await asyncio.wait_for(two_sweeps.wait(), timeout=2)
                assert len(calls) >= 2
    asyncio.run(exercise())


def test_runtime_origin_mismatch_quarantines_before_admission(e, monkeypatch):
    monkeypatch.setenv("FILL_UAT_SERVER_VALIDATOR", "on")
    raw = dict(e.cfg.__dict__, historical_ids=list(e.cfg.historical_ids), admission_expires_at=e.cfg.admission_expires_at.isoformat(), deployment_id="runtime")
    monkeypatch.setenv("FILL_UAT_SERVER_BINDING", json.dumps(raw))
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", e.cfg.operations_sha)
    monkeypatch.setenv("RAILWAY_DEPLOYMENT_ID", e.cfg.deployment_id)
    monkeypatch.setenv("RAILWAY_PUBLIC_DOMAIN", "different-dummy.up.railway.app")
    guard = SimpleNamespace(bootstrap=e.boot, clock=e.clock.wall, monotonic=e.clock.tick, is_fixture=lambda a: True, check=lambda *a: None)
    runner = s.from_environment(SimpleNamespace(environment="staging", supabase_publishable_key=PUBLIC_KEY), "operations", guard, None)
    assert isinstance(runner, s.RejectedValidator) and not e.boot.server_validator.admission_ready and not e.http


def wire_snapshot(e):
    """Public synthetic wire payload for the single-statement decoder."""
    e.clock.seconds = 10
    e.port.initial = False
    data = e.port.read()
    row = deepcopy(data["intent"])
    row.update(input_digest=e.plan.digest, created_at=START, settled_at=START,
               preflight_at=START, released_at=START)
    row["verdict_at"] = None
    def wire(value):
        return json.loads(json.dumps(value, default=str))
    row["_attempts"] = wire([dict(x, run_id=e.cfg.run_id) for x in row.pop("attempts")])
    row["_run"] = wire(data["run"])
    row["_bans"] = wire([{"id": k, "banned_until": v} for k, v in data["bans"].items()])
    row["_markers"] = wire([dict(v, id=k) for k, v in data["markers"].items()])
    row["_members"] = wire(data["members"])
    row["_prior_unknown"] = data["prior_unknown"]
    return row


def query_port(e, payload):
    calls = []
    @contextmanager
    def tx():
        def execute(statement, params):
            calls.append((statement, params))
            return SimpleNamespace(mappings=lambda: SimpleNamespace(first=lambda: deepcopy(payload)))
        yield SimpleNamespace(execute=execute)
    e.boot.journal = SimpleNamespace(tx=tx, deployment=e.cfg.deployment_id)
    return s.JournalPort(e.boot, e.cfg), calls


def test_single_data_statement_and_native_nested_type_parity(e):
    raw = wire_snapshot(e)
    port, calls = query_port(e, raw)
    got = port.read()
    assert len(calls) == 1 and calls[0][0] is s.JournalPort.SNAPSHOT
    assert calls[0][1] == {"run": e.cfg.run_id, "history": list(e.cfg.historical_ids), "ban_limit": 21}
    assert got["intent"]["db_now"] == e.clock.wall()
    assert got["intent"]["input_digest"] == e.plan.digest
    assert isinstance(got["intent"]["attempts"][0]["activation_nonce"], uuid.UUID)
    assert isinstance(got["intent"]["attempts"][0]["run_id"], uuid.UUID)
    assert isinstance(got["members"][0]["user_id"], uuid.UUID)
    assert isinstance(got["markers"][e.ids["a"]]["id"], uuid.UUID)
    assert got["run"]["healthy_at"] == e.clock.wall()
    assert got["bans"][ID(1)] > START+timedelta(days=365)
    assert "_bans" not in got["intent"] and got["prior_unknown"] is False


def test_single_statement_no_intent_does_not_read_legacy_journal(e):
    port, calls = query_port(e, None)
    assert port.read() is None and len(calls) == 1


@pytest.mark.parametrize("key,value", [
    ("authorization_id", ID(999)), ("candidate_sha", "f"*40), ("project_ref", "foreign"),
    ("deployment_id", ID(999)), ("input_digest", "f"*64), ("organization_ids", []),
    ("db_now", START.isoformat()), ("db_now", None), ("db_now", START.replace(tzinfo=None)),
    ("stopped", "false"), ("_prior_unknown", 0), ("_attempts", {}), ("_members", None),
])
def test_single_snapshot_rejects_authority_and_wire_type_corruption(e, key, value):
    raw = wire_snapshot(e)
    raw[key] = value
    port, calls = query_port(e, raw)
    with pytest.raises(s.Closed):
        port.read()
    assert len(calls) == 1 and not e.http


@pytest.mark.parametrize("change", ["naive_date", "duplicate_ban", "bad_uuid", "attempt_bool", "foreign_attempt", "overflow"])
def test_nested_json_does_not_coerce_or_hide_ambiguous_payload(e, change):
    raw = wire_snapshot(e)
    if change == "naive_date":
        raw["_run"]["healthy_at"] = START.replace(tzinfo=None).isoformat()
    elif change == "duplicate_ban":
        raw["_bans"].append(raw["_bans"][0])
    elif change == "bad_uuid":
        raw["_members"][0]["user_id"] = "invalid"
    elif change == "attempt_bool":
        raw["_attempts"][0]["verified"] = "false"
    elif change == "foreign_attempt":
        raw["_attempts"][0]["run_id"] = ID(999)
    else:
        raw["_attempts"] = raw["_attempts"]*3
    port, _ = query_port(e, raw)
    with pytest.raises(s.Closed):
        port.read()


@pytest.mark.parametrize("fault", ["freshness", "history", "nonce", "role", "membership", "prior", "spec"])
def test_decoded_snapshot_still_enforces_freshness_history_nonce_roles(e, fault):
    raw = wire_snapshot(e)
    port, _ = query_port(e, raw)
    e.runner.port = port
    e.runner.ready = True
    if fault == "freshness":
        raw["db_now"] = START-timedelta(seconds=11)
    elif fault == "history":
        raw["_bans"] = [x for x in raw["_bans"] if x["id"] != ID(1)]
    elif fault == "nonce":
        raw["_markers"][0]["nonce"] = ID(999)
    elif fault == "role":
        raw["_members"][0]["role"] = "manager"
    elif fault == "membership":
        raw["_members"][0]["organization_id"] = ID(999)
    elif fault == "prior":
        raw["_prior_unknown"] = True
    else:
        raw["_run"]["spec"]["candidate_sha"] = "f"*40
    asyncio.run(e.runner.run())
    assert e.runner.failed and not e.http


def test_late_stop_does_not_block_client_closure_or_claim_cleanup(e):
    release = threading.Event()
    e.fault = "foreign-user"
    def stop():
        release.wait(5)
        e.port.stopped = True
        return True
    e.port.stop = stop
    async def exercise():
        try:
            await asyncio.wait_for(e.runner.run(), 4)
            final = next(x for x in e.logs if x["kind"] == "PRIVATE_VALIDATOR_TASK_STOPPED")
            assert not final["durable_stop"] and final["client_closed"] and final["owned_pending"] == 1
            assert final["cleanup"]["status"] == "UNKNOWN"
        finally:
            release.set()
            await asyncio.gather(*list(e.runner.jobs), return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    timeouts = [x for x in e.logs if x["kind"] == "PRIVATE_VALIDATOR_STAGE_TIMEOUT"]
    late = [x for x in e.logs if x["kind"] == "PRIVATE_VALIDATOR_LATE_STAGE"]
    assert timeouts[0]["stage"] == late[0]["stage"] == "durable_stop"
    assert timeouts[0]["elapsed_ms"] >= 1900 and late[0]["outcome"] == "complete"
    assert all(set(x) <= {"kind", "stage", "elapsed_ms", "outcome"} for x in timeouts+late)
    assert e.port.stopped and not e.runner.jobs and not e.runner.operator_gate
    for sentinel in (PASSWORD, TOKEN, PUBLIC_KEY, e.plan.digest):
        assert sentinel not in s.canonical(timeouts+late)


async def delayed_get_diagnostics(e, monkeypatch, route, trigger, outcome):
    """Injected HTTP and an accelerated wait only; production deadlines asserted."""
    entered, release = asyncio.Event(), asyncio.Event()
    e.clock.seconds = 10
    e.port.initial = False
    e.runner.ready = True
    e.runner.read_pool = s.ThreadPoolExecutor(max_workers=1)
    bodies = {
        "me": {"user": {"id": e.ids["canary"]}},
        "organizations": {"items": [{"id": e.cfg.organizations["a"], "role": "owner"}]},
        "own_today": {"date": START.date().isoformat(), "courts": []},
        "own_calendar": {"bookings": [], "holds": [], "blocks": []},
        "provider_connections": {"items": []},
    }
    async def delayed(request):
        e.http.append((request.method, request.url.path, e.clock.seconds))
        entered.set()
        await release.wait()
        if outcome == "error":
            raise httpx.ReadTimeout(PASSWORD + TOKEN)
        if outcome == "cancelled":
            raise asyncio.CancelledError()
        return httpx.Response(403 if route.startswith("foreign_") else 200, json=bodies.get(route, {}))
    client = s.Clients(PUBLIC_KEY, e.plan, e.cfg.operations_origin,
                       auth_transport=httpx.MockTransport(delayed), ops_transport=httpx.MockTransport(delayed), clock=e.clock.wall)
    client.sessions["canary"] = (TOKEN, START + timedelta(hours=1))
    e.runner.client = client
    bounded = e.runner.bounded
    async def controlled_wait(awaitable, seconds, **context):
        if context["stage"] == "user_get":
            assert seconds == s.CONTROL_SECONDS == 2.0
            # Only this test's injected wait expires immediately; no runtime
            # constant or clock/deadline is changed in the application.
            seconds = 0 if trigger == "timeout" else seconds
        return await bounded(awaitable, seconds, **context)
    monkeypatch.setattr(e.runner, "bounded", controlled_wait)
    task = asyncio.create_task(e.runner.action("canary", route))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        if trigger == "interrupted":
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(s.Closed) as stopped:
                await task
            assert stopped.value.code == "TIMEOUT"
        assert len(e.runner.jobs) == 1 and not e.runner.events
        assert ("canary", route, False) in e.runner.used
        with pytest.raises(s.Closed) as replay:
            await e.runner.action("canary", route)
        assert replay.value.code == "REPLAY" and len(e.http) == 1
    finally:
        release.set()
        await asyncio.gather(task, *list(e.runner.jobs), return_exceptions=True)
        await asyncio.sleep(0)
        await client.close()
        e.runner.read_pool.shutdown()
    assert client.closed and not client.sessions and not e.runner.jobs and not e.runner.events
    return [x for x in e.logs if x.get("stage") == "user_get"]


@pytest.mark.parametrize("route", s.ROUTES)
@pytest.mark.parametrize("trigger", ["timeout", "interrupted"])
@pytest.mark.parametrize("outcome", ["complete", "error", "cancelled"])
def test_delayed_user_get_diagnostics_preserve_fixed_route_and_ownership(e, monkeypatch, route, trigger, outcome):
    events = asyncio.run(delayed_get_diagnostics(e, monkeypatch, route, trigger, outcome))
    first = "PRIVATE_VALIDATOR_STAGE_TIMEOUT" if trigger == "timeout" else "PRIVATE_VALIDATOR_STAGE_INTERRUPTED"
    assert [x["kind"] for x in events] == [first, "PRIVATE_VALIDATOR_LATE_STAGE"]
    assert [x["route"] for x in events] == [route, route]
    assert events[-1]["outcome"] == outcome
    assert all(set(x) <= {"kind", "stage", "elapsed_ms", "outcome", "route", "phase", "phase_elapsed_ms"} for x in events)
    for event in events:
        assert ("phase" in event) == ("phase_elapsed_ms" in event)
        if "phase" in event:
            assert type(event["phase"]) is str and event["phase"] in {"prepare", "headers", "body", "decode", "stream_exit", "validate"}
            assert type(event["phase_elapsed_ms"]) is float and math.isfinite(event["phase_elapsed_ms"])
            assert 0 <= event["phase_elapsed_ms"] <= event["elapsed_ms"]
    assert all(type(x["elapsed_ms"]) in {int, float} and x["elapsed_ms"] >= 0 for x in events)
    encoded = s.canonical(events)
    for sentinel in (PASSWORD, TOKEN, PUBLIC_KEY, e.plan.digest, e.cfg.run_id, e.cfg.authorization_id,
                     e.cfg.operations_sha, e.cfg.organizations["a"], e.ids["canary"], "canary", "https://", "/api/"):
        assert sentinel not in encoded


@pytest.mark.parametrize("metadata", [None, "unknown-route", PASSWORD, TOKEN, PUBLIC_KEY, ID(999),
    "https://ops-dummy.up.railway.app/api/me?token=" + TOKEN, "/api/me", "canary", ["me"], {"route": "me"}, 123])
def test_untrusted_route_metadata_is_omitted_without_serializing_values(e, metadata):
    async def exercise():
        release = asyncio.Event()
        async def delayed():
            await release.wait()
            raise ValueError(PASSWORD + TOKEN)
        try:
            with pytest.raises(s.Closed):
                await e.runner.bounded(delayed(), 0, stage="user_get", route=metadata)
        finally:
            release.set()
            await asyncio.gather(*list(e.runner.jobs), return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    assert len(e.logs) == 2 and not e.http and not e.runner.jobs
    assert all(set(x) <= {"kind", "stage", "elapsed_ms", "outcome"} for x in e.logs)
    encoded = s.canonical(e.logs)
    for sentinel in (PASSWORD, TOKEN, PUBLIC_KEY, ID(999), "unknown-route", "https://", "/api/", "canary"):
        assert sentinel not in encoded


@pytest.mark.parametrize("stage", ["admission_snapshot", "control_snapshot", "cleanup_snapshot", "durable_stop", "client_close", "user_login"])
@pytest.mark.parametrize("trigger", ["timeout", "interrupted"])
def test_non_get_diagnostic_shapes_ignore_route_metadata(e, stage, trigger):
    async def exercise():
        entered, release = asyncio.Event(), asyncio.Event()
        async def delayed():
            entered.set()
            await release.wait()
        task = asyncio.create_task(e.runner.bounded(delayed(), 0 if trigger == "timeout" else 2, stage=stage, route="own_today"))
        try:
            await asyncio.wait_for(entered.wait(), 1)
            if trigger == "interrupted":
                task.cancel()
                with pytest.raises(asyncio.CancelledError): await task
            else:
                with pytest.raises(s.Closed): await task
        finally:
            release.set()
            await asyncio.gather(task, *list(e.runner.jobs), return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    first = "PRIVATE_VALIDATOR_STAGE_TIMEOUT" if trigger == "timeout" else "PRIVATE_VALIDATOR_STAGE_INTERRUPTED"
    assert [x["kind"] for x in e.logs] == [first, "PRIVATE_VALIDATOR_LATE_STAGE"]
    assert all(x["stage"] == stage and set(x) <= {"kind", "stage", "elapsed_ms", "outcome"} for x in e.logs)
    assert not e.http and not e.runner.jobs


@pytest.mark.parametrize("stage", ["user_get", "user_login", "control_snapshot"])
def test_successful_bounded_operations_emit_no_new_diagnostic_stream(e, stage):
    async def exercise():
        async def done(): return 200
        assert await e.runner.bounded(done(), 2, stage=stage, route="own_today") == 200
        await asyncio.sleep(0)
    asyncio.run(exercise())
    assert not e.logs and not e.runner.jobs and not e.http


@pytest.mark.parametrize("outcome", ["complete", "error", "cancelled"])
def test_overlapping_abandoned_gets_keep_their_own_route(e, outcome):
    async def exercise():
        releases = {route: asyncio.Event() for route in ("own_today", "own_calendar")}
        jobs = {}
        async def delayed(route):
            await releases[route].wait()
            if route == "own_today" and outcome == "error": raise ValueError(PASSWORD + TOKEN)
            if route == "own_today" and outcome == "cancelled": raise asyncio.CancelledError()
            return {"unlogged": PASSWORD + TOKEN}
        try:
            for route in releases:
                before = set(e.runner.jobs)
                with pytest.raises(s.Closed):
                    await e.runner.bounded(delayed(route), 0, stage="user_get", route=route)
                jobs[route] = (e.runner.jobs - before).pop()
            assert len(e.runner.jobs) == 2
            # B completes while abandoned A is still owned; A must retain A.
            for route in reversed(releases):
                releases[route].set()
                await asyncio.gather(jobs[route], return_exceptions=True)
                await asyncio.sleep(0)
        finally:
            for release in releases.values(): release.set()
            await asyncio.gather(*list(e.runner.jobs), return_exceptions=True)
    asyncio.run(exercise())
    assert [(x["kind"], x["route"]) for x in e.logs] == [
        ("PRIVATE_VALIDATOR_STAGE_TIMEOUT", "own_today"),
        ("PRIVATE_VALIDATOR_STAGE_TIMEOUT", "own_calendar"),
        ("PRIVATE_VALIDATOR_LATE_STAGE", "own_calendar"),
        ("PRIVATE_VALIDATOR_LATE_STAGE", "own_today"),
    ]
    assert e.logs[-1]["outcome"] == outcome and not e.runner.jobs and not e.http
    assert PASSWORD not in s.canonical(e.logs) and TOKEN not in s.canonical(e.logs)


@pytest.mark.parametrize("route", ["unknown-route", PASSWORD, TOKEN, "https://ops-dummy.up.railway.app/api/me?token=" + TOKEN])
def test_unknown_action_route_never_sends_http_or_diagnostic_input(e, route):
    e.clock.seconds = 10
    e.port.initial = False
    e.runner.ready = True
    async def exercise():
        e.runner.read_pool = s.ThreadPoolExecutor(max_workers=1)
        e.runner.client = e.runner.client_factory()  # explicitly injected MockTransport fixture
        e.runner.client.sessions["canary"] = (TOKEN, START + timedelta(hours=1))
        try:
            with pytest.raises(KeyError): await e.runner.action("canary", route)
            with pytest.raises(s.Closed): await e.runner.action("canary", route)
        finally:
            await e.runner.client.close()
            e.runner.read_pool.shutdown()
        await asyncio.sleep(0)
    asyncio.run(exercise())
    assert not e.http and not e.logs and not e.runner.events and not e.runner.jobs


@pytest.mark.parametrize("outcome", ["complete", "error", "cancelled"])
def test_user_get_timeout_closes_task_without_false_cleanup_then_drains(e, outcome):
    release = asyncio.Event()
    factory = e.runner.client_factory
    def delayed_factory():
        client = factory()  # fixture sends only injected public MockTransport requests
        get = client.get
        async def delayed(*args, **kwargs):
            status = await get(*args, **kwargs)
            await release.wait()
            if outcome == "error": raise ValueError(PASSWORD + TOKEN)
            if outcome == "cancelled": raise asyncio.CancelledError()
            return status
        client.get = delayed
        return client
    e.runner.client_factory = delayed_factory
    async def exercise():
        try:
            await asyncio.wait_for(e.runner.run(), 4)
            final = next(x for x in e.logs if x["kind"] == "PRIVATE_VALIDATOR_TASK_STOPPED")
            assert final["status"] == "TIMEOUT" and final["durable_stop"] and final["client_closed"]
            assert final["owned_pending"] == 1 and final["cleanup"]["status"] == "UNKNOWN"
            assert not e.runner.admission_ready and not e.runner.operator_gate and e.port.stopped
            assert not any(x["kind"] == "PRIVATE_VALIDATOR_OWNERSHIP_DRAINED" for x in e.logs)
        finally:
            release.set()
            await asyncio.gather(*list(e.runner.jobs), return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    relevant = [x for x in e.logs if x.get("stage") == "user_get"]
    assert [(x["kind"], x["route"]) for x in relevant] == [
        ("PRIVATE_VALIDATOR_STAGE_TIMEOUT", "own_today"), ("PRIVATE_VALIDATOR_LATE_STAGE", "own_today")]
    assert relevant[0]["elapsed_ms"] >= 1900 and relevant[-1]["outcome"] == outcome
    assert e.logs[-1] == {"kind": "PRIVATE_VALIDATOR_OWNERSHIP_DRAINED", "owned_pending": 0, "client_closed": True}
    assert not e.runner.jobs and not e.client.sessions and not e.runner.operator_gate
    assert all(x["kind"] != "PRIVATE_FINAL_CANARY" for x in e.logs)
    assert PASSWORD not in s.canonical(e.logs) and TOKEN not in s.canonical(e.logs)


async def stalled_get_phase(e, boundary, *, trigger="interrupted", outcome="complete", real_wait=False):
    """Public controlled transport/stream, exercised through normal action()."""
    entered, release = asyncio.Event(), asyncio.Event()
    route = "foreign_today" if boundary == "stream_exit" else "own_today"
    async def stall():
        entered.set()
        await release.wait()
        if outcome == "error": raise httpx.ReadError(PASSWORD + TOKEN)
        if outcome == "cancelled": raise asyncio.CancelledError()
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            assert boundary != "stream_exit", "denied response body must not be read"
            if boundary == "body_first": await stall()
            yield b'{"date":"2030-01-01",'
            if boundary == "body_later": await stall()
            yield b'"courts":[]}'
        async def aclose(self):
            if boundary in {"stream_exit", "body_close"}: await stall()
    async def transport(request):
        e.http.append((request.method, request.url.path, e.clock.seconds))
        if boundary == "headers": await stall()
        return httpx.Response(403 if boundary == "stream_exit" else 200, stream=Stream())
    client = s.Clients(PUBLIC_KEY, e.plan, e.cfg.operations_origin, clock=e.clock.wall,
        auth_transport=httpx.MockTransport(transport), ops_transport=httpx.MockTransport(transport))
    client.sessions["canary"] = (TOKEN, START + timedelta(hours=1))
    e.clock.seconds = 10
    e.port.initial = False
    e.runner.ready = True
    e.runner.client = client
    e.runner.read_pool = s.ThreadPoolExecutor(max_workers=1)
    bounded = e.runner.bounded
    async def controlled_wait(awaitable, seconds, **context):
        if context["stage"] == "user_get":
            assert seconds == s.CONTROL_SECONDS == 2.0
            if trigger == "timeout" and not real_wait:
                seconds = 0
        return await bounded(awaitable, seconds, **context)
    e.runner.bounded = controlled_wait
    task = asyncio.create_task(e.runner.action("canary", route))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        if trigger == "interrupted":
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
        else:
            with pytest.raises(s.Closed) as failure: await asyncio.wait_for(task, 3)
            assert failure.value.code == "TIMEOUT"
        assert len(e.runner.jobs) == 1 and len(e.http) == 1 and not e.runner.events
        with pytest.raises(s.Closed) as replay: await e.runner.action("canary", route)
        assert replay.value.code == "REPLAY" and len(e.http) == 1
    finally:
        release.set()
        await asyncio.gather(task, *list(e.runner.jobs), return_exceptions=True)
        await asyncio.sleep(0)
        await client.close()
        e.runner.read_pool.shutdown()
    assert not client.sessions and not e.runner.jobs and not e.runner.events
    return [x for x in e.logs if x.get("stage") == "user_get"]


@pytest.mark.parametrize("boundary", ["headers", "body_first", "body_later", "stream_exit"])
@pytest.mark.parametrize("trigger", ["interrupted", "timeout"])
@pytest.mark.parametrize("outcome", ["complete", "error", "cancelled"])
def test_client_phase_distinguishes_controlled_stream_stalls(e, boundary, trigger, outcome):
    events = asyncio.run(stalled_get_phase(e, boundary, trigger=trigger, outcome=outcome))
    kind = "PRIVATE_VALIDATOR_STAGE_INTERRUPTED" if trigger == "interrupted" else "PRIVATE_VALIDATOR_STAGE_TIMEOUT"
    assert events[0]["kind"] == kind
    expected = "body" if boundary.startswith("body_") else boundary
    assert events[0]["phase"] == expected
    late_phase = "validate" if outcome == "complete" else "headers" if boundary == "headers" else "stream_exit"
    assert events[-1]["kind"] == "PRIVATE_VALIDATOR_LATE_STAGE" and events[-1]["phase"] == late_phase
    assert events[-1]["outcome"] == outcome
    for event in events:
        assert 0 <= event["phase_elapsed_ms"] <= event["elapsed_ms"]
        assert set(event) <= {"kind", "stage", "elapsed_ms", "outcome", "route", "phase", "phase_elapsed_ms"}
    encoded = s.canonical(events)
    for sentinel in (PASSWORD, TOKEN, PUBLIC_KEY, e.plan.digest, e.cfg.run_id, e.ids["canary"], "https://", "/api/", "canary"):
        assert sentinel not in encoded


def test_client_phase_body_includes_httpx_eof_close_wait(e):
    events = asyncio.run(stalled_get_phase(e, "body_close"))
    assert events[0]["phase"] == "body" and events[-1]["phase"] == "validate"


@pytest.mark.parametrize("denied", [False, True])
def test_client_phase_sync_checkpoints_share_monotonic_origin_without_success_logs(e, monkeypatch, denied):
    samples = iter((100.01, 100.02, 100.03, 100.04, 100.05, 100.06))
    monkeypatch.setattr(s, "time", SimpleNamespace(monotonic=lambda: next(samples)))
    marks = []
    mark = s._GetPhase.mark
    def observe(phase, name):
        mark(phase, name)
        marks.append((name, phase.fields(100.0, 100.1)))
    monkeypatch.setattr(s._GetPhase, "mark", observe)
    phase = s._GetPhase()
    phase.started = 100.0
    calls = []
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            assert not denied, "denied response body must not be read"
            yield b'{"date":"2030-01-01","courts":[]}'
        async def aclose(self): pass
    def transport(request):
        calls.append(request.method)
        return httpx.Response(403 if denied else 200, stream=Stream())
    async def exercise():
        client = s.Clients(PUBLIC_KEY, e.plan, e.cfg.operations_origin, clock=e.clock.wall,
            auth_transport=httpx.MockTransport(transport), ops_transport=httpx.MockTransport(transport))
        client.sessions["canary"] = (TOKEN, START + timedelta(hours=1))
        try:
            assert await client.get("canary", "foreign_today" if denied else "own_today", e.ids["canary"], e.cfg.organizations,
                                    START.date().isoformat(), phase=phase) == (403 if denied else 200)
        finally:
            await client.close()
    asyncio.run(exercise())
    expected = ["prepare", "headers", "stream_exit", "validate"] if denied else ["prepare", "headers", "body", "decode", "stream_exit", "validate"]
    assert [name for name, _ in marks] == expected and calls == ["GET"] and not e.logs
    assert all(fields["phase"] == name and 0 <= fields["phase_elapsed_ms"] <= 100 for name, fields in marks)


@pytest.mark.parametrize("fault", ["json", "not_dict", "size", "status", "dto"])
def test_client_phase_preserves_existing_exception_and_exit_semantics(e, fault):
    payload = {"json": b'{', "not_dict": b'[]', "size": b'x' * (s.MAX_BODY + 1),
               "status": b'{"date":"2030-01-01","courts":[]}', "dto": b'{"date":"wrong","courts":[]}' }[fault]
    outcomes = []
    for tracked in (False, True):
        calls, closed = [], []
        phase = s._GetPhase() if tracked else None
        if phase is not None: phase.started = 100.0
        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self): yield payload
            async def aclose(self): closed.append(True)
        def transport(request):
            calls.append(request.method)
            return httpx.Response(500 if fault == "status" else 200, stream=Stream())
        async def exercise():
            client = s.Clients(PUBLIC_KEY, e.plan, e.cfg.operations_origin, clock=e.clock.wall,
                auth_transport=httpx.MockTransport(transport), ops_transport=httpx.MockTransport(transport))
            client.sessions["canary"] = (TOKEN, START + timedelta(hours=1))
            try:
                with pytest.raises((s.Closed, json.JSONDecodeError)) as raised:
                    await client.get("canary", "own_today", e.ids["canary"], e.cfg.organizations, START.date().isoformat(), phase=phase)
                outcomes.append((type(raised.value), getattr(raised.value, "code", None)))
            finally:
                await client.close()
        asyncio.run(exercise())
        assert calls == ["GET"] and closed == [True] and not e.logs
        if phase is not None:
            assert phase.checkpoint[0] == ("validate" if fault in {"status", "dto"} else "stream_exit")
    assert outcomes[0] == outcomes[1]


@pytest.mark.parametrize("checkpoint", [None, {}, [], ("body",), ("body", 1.0, 2.0),
    (PASSWORD, 100.5), (TOKEN, 100.5), ("https://private.invalid/" + TOKEN, 100.5),
    (ID(999), 100.5), ("body", None), ("body", True), ("body", 100), ("body", float("nan")),
    ("body", float("inf")), ("body", 99.0), ("body", 102.0)])
def test_client_phase_invalid_checkpoint_omits_both_fields(e, checkpoint):
    phase = s._GetPhase()
    phase.started = 100.0
    phase.checkpoint = checkpoint
    assert phase.fields(100.0, 101.0) == {}
    assert phase.fields(99.0, 101.0) == {}


@pytest.mark.parametrize("started,began,now", [(None,100.0,101.0), (True,100.0,101.0), (100.0,100.0,float("nan")),
    (100.0,100.0,float("inf")), (100.0,100.0,99.0), (-1e308,-1e308,1e308)])
def test_client_phase_invalid_clock_or_overflow_omits_pair(started, began, now):
    phase = s._GetPhase()
    phase.started = started
    phase.checkpoint = ("body", began)
    assert phase.fields(began, now) == {}


@pytest.mark.parametrize("metadata", [None, PASSWORD, TOKEN, {"phase": "body"}, ["body"], 123])
def test_client_phase_untrusted_tracker_never_serializes_or_invokes_it(e, metadata):
    async def exercise():
        release = asyncio.Event()
        async def stalled(): await release.wait()
        try:
            with pytest.raises(s.Closed):
                await e.runner.bounded(stalled(), 0, stage="user_get", route="own_today", phase=metadata)
        finally:
            release.set()
            await asyncio.gather(*list(e.runner.jobs), return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    assert len(e.logs) == 2 and all("phase" not in x and "phase_elapsed_ms" not in x for x in e.logs)
    assert PASSWORD not in s.canonical(e.logs) and TOKEN not in s.canonical(e.logs) and not e.http


@pytest.mark.parametrize("outcome", ["complete", "error", "cancelled"])
def test_client_phase_overlapping_jobs_keep_independent_checkpoint_history(e, outcome):
    async def exercise():
        a, b = s._GetPhase(), s._GetPhase()
        release_a, release_b = asyncio.Event(), asyncio.Event()
        async def first():
            a.mark("headers")
            await release_a.wait()
            a.mark("stream_exit")
            if outcome == "error": raise ValueError(PASSWORD + TOKEN)
            if outcome == "cancelled": raise asyncio.CancelledError()
            a.mark("validate")
        async def second():
            b.mark("body")
            await release_b.wait()
            b.mark("validate")
        try:
            for operation, phase, route in ((first(),a,"own_today"),(second(),b,"own_calendar")):
                with pytest.raises(s.Closed): await e.runner.bounded(operation,0,stage="user_get",route=route,phase=phase)
            jobs = list(e.runner.jobs)
            release_b.set()
            await asyncio.wait_for(asyncio.shield(next(job for job in jobs if job.get_coro().__name__ == "second")), 1)
            await asyncio.sleep(0)
            assert len(e.runner.jobs) == 1 and e.logs[-1]["route"] == "own_calendar"
        finally:
            release_a.set()
            release_b.set()
            await asyncio.gather(*list(e.runner.jobs), return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    assert [(x["route"], x["phase"]) for x in e.logs] == [
        ("own_today","headers"),("own_calendar","body"),("own_calendar","validate"),
        ("own_today","validate" if outcome == "complete" else "stream_exit")]
    assert not e.runner.jobs and not e.http


@pytest.mark.parametrize("stage,route", [("user_login","own_today"),("durable_stop","own_today"),("control_snapshot","own_today"),("user_get","unknown")])
def test_client_phase_non_get_or_unknown_route_ignores_tracker(e, stage, route):
    phase = s._GetPhase()
    async def exercise():
        release = asyncio.Event()
        async def stalled():
            phase.mark("body")
            await release.wait()
        try:
            with pytest.raises(s.Closed): await e.runner.bounded(stalled(),0,stage=stage,route=route,phase=phase)
        finally:
            release.set()
            await asyncio.gather(*list(e.runner.jobs), return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    assert all("phase" not in x and "phase_elapsed_ms" not in x for x in e.logs) and phase.started is None


def test_client_phase_before_coroutine_checkpoint_is_unknown(e):
    phase = s._GetPhase()
    async def exercise():
        release = asyncio.Event()
        async def stalled(): await release.wait()
        try:
            with pytest.raises(s.Closed): await e.runner.bounded(stalled(),0,stage="user_get",route="own_today",phase=phase)
        finally:
            release.set()
            await asyncio.gather(*list(e.runner.jobs), return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    assert all("phase" not in x and "phase_elapsed_ms" not in x for x in e.logs)


@pytest.mark.parametrize("replacement", ["get", "_request"])
def test_client_phase_legacy_injected_callables_keep_existing_signature(e, replacement):
    e.clock.seconds = 10
    e.port.initial = False
    e.runner.ready = True
    async def exercise():
        release, entered = asyncio.Event(), asyncio.Event()
        client = e.runner.client_factory()
        client.sessions["canary"] = (TOKEN, START + timedelta(hours=1))
        async def legacy_get(label, route, identity, organizations, day, *, deny=False):
            entered.set()
            await release.wait()
            return 200
        async def legacy_request(client, method, path, *, headers, payload=None, body=True):
            entered.set()
            await release.wait()
            return 200, {"date":"2030-01-01","courts":[]}
        setattr(client, replacement, legacy_get if replacement == "get" else legacy_request)
        e.runner.client = client
        e.runner.read_pool = s.ThreadPoolExecutor(max_workers=1)
        task = asyncio.create_task(e.runner.action("canary","own_today"))
        try:
            await asyncio.wait_for(entered.wait(),1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
            assert len(e.runner.jobs) == 1
        finally:
            release.set()
            await asyncio.gather(task,*list(e.runner.jobs),return_exceptions=True)
            await asyncio.sleep(0)
            await client.close()
            e.runner.read_pool.shutdown()
    asyncio.run(exercise())
    assert [x["route"] for x in e.logs] == ["own_today","own_today"]
    assert all("phase" not in x and "phase_elapsed_ms" not in x for x in e.logs) and not e.http


def test_client_phase_real_timeout_keeps_unknown_cleanup_until_owned_stream_drains(e):
    release = asyncio.Event()
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            await release.wait()
            yield b'{"date":"2030-01-01","courts":[]}'
        async def aclose(self): pass
    def transport(request):
        e.http.append((request.method,request.url.path,e.clock.seconds))
        return httpx.Response(200,stream=Stream())
    factory = e.runner.client_factory
    def controlled_factory():
        client = factory()
        client.ops._transport = httpx.MockTransport(transport)
        return client
    e.runner.client_factory = controlled_factory
    async def exercise():
        try:
            await asyncio.wait_for(e.runner.run(),4)
            final = next(x for x in e.logs if x["kind"] == "PRIVATE_VALIDATOR_TASK_STOPPED")
            assert final["status"] == "TIMEOUT" and final["durable_stop"] and final["client_closed"]
            assert final["owned_pending"] == 1 and final["cleanup"]["status"] == "UNKNOWN"
            assert not e.runner.operator_gate and not any(x["kind"] == "PRIVATE_VALIDATOR_OWNERSHIP_DRAINED" for x in e.logs)
        finally:
            release.set()
            await asyncio.gather(*list(e.runner.jobs),return_exceptions=True)
            await asyncio.sleep(0)
    asyncio.run(exercise())
    diagnostics = [x for x in e.logs if x.get("stage") == "user_get"]
    assert diagnostics[0]["phase"] == "body" and diagnostics[0]["elapsed_ms"] >= 1900
    assert diagnostics[-1]["phase"] == "stream_exit" and diagnostics[-1]["outcome"] == "error"
    assert e.logs[-1] == {"kind":"PRIVATE_VALIDATOR_OWNERSHIP_DRAINED","owned_pending":0,"client_closed":True}
    assert len([x for x in e.http if x[0] == "GET"]) == 1 and not e.runner.jobs and not e.client.sessions


def snapshot_fixture_engine(url, opt_in):
    from test_fill_provenance_uat import fixture_database
    # Validation happens before create_engine or connection/fixture DDL. Reuse
    # the existing driver/loopback/fmc_test/no-query/explicit-opt-in boundary.
    return create_engine(fixture_database(url, opt_in))


@pytest.mark.parametrize("url,opt_in", [
    ("postgresql+psycopg://fixture:NEVER_PRINT@remote.invalid/fmc_test", "ci-local-only"),
    ("postgresql+psycopg://fixture@localhost/production", "ci-local-only"),
    ("postgresql+psycopg://fixture@localhost/fmc_test?host=remote.invalid", "ci-local-only"),
    ("postgresql+psycopg://fixture@localhost/fmc_test", ""),
    ("postgresql://fixture@localhost/fmc_test", "ci-local-only"),
    ("not-a-url", "ci-local-only"), (None, "ci-local-only"),
])
def test_snapshot_fixture_rejects_unsafe_target_before_engine(url, opt_in, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("engine must not be constructed for rejected fixture target")
    monkeypatch.setattr(f"{__name__}.create_engine", forbidden)
    with pytest.raises(ValueError) as rejected:
        snapshot_fixture_engine(url, opt_in)
    assert "NEVER_PRINT" not in str(rejected.value)
    assert not url or url not in str(rejected.value)


def set_history(e, count):
    raw = dict(e.cfg.__dict__, historical_ids=[ID(i) for i in range(1,count+1)],
               admission_expires_at=e.cfg.admission_expires_at.isoformat())
    e.cfg = s.Binding.parse(raw)
    e.runner.binding = e.cfg


@pytest.mark.parametrize("count", [17,20,23])
def test_supported_history_and_three_new_principals_complete_with_same_budget(e,count):
    set_history(e,count)
    asyncio.run(e.runner.run())
    final = next(x for x in e.logs if x["kind"]=="PRIVATE_VALIDATOR_TASK_STOPPED")
    assert final["status"]=="READS_COMPLETE" and final["owned_pending"]==0
    assert final["durable_stop"] and final["client_closed"] and e.port.stopped
    assert final["cleanup"]["status"]=="ALLOCATED_IDENTITIES_VERIFIED" and final["cleanup"]["full_three"]
    assert final["cleanup"]["known_banned"]==count+3
    assert len(e.runner.identities)==3 and len(e.runner.events)==21
    assert len([x for x in e.http if x[0]=="POST"])==4
    raw=wire_snapshot(e)
    port,calls=query_port(e,raw)
    assert len(port.read()["bans"])==count+3
    assert calls[0][1]["ban_limit"]==count+4<=27


@pytest.mark.parametrize("count", [0,16,18,19,21,22,24,25,26,27])
def test_only_three_explicit_history_cardinalities_are_supported(e,count):
    with pytest.raises(s.Closed): set_history(e,count)
    assert not e.http


@pytest.mark.parametrize("count", [16,18,21,22,24,26,27])
def test_journal_rejects_unsupported_history_before_query(e,count):
    port,calls=query_port(e,None)
    port.binding=SimpleNamespace(run_id=e.cfg.run_id,historical_ids=tuple(ID(i) for i in range(1,count+1)))
    with pytest.raises(s.Closed): port.read()
    assert not calls and not e.http


@pytest.mark.parametrize("count", [20,23])
@pytest.mark.parametrize("fault", ["duplicate","missing_old","invalid_uuid"])
def test_history_scope_rejects_duplicate_missing_protected_or_noncanonical_id(e,count,fault):
    raw=dict(e.cfg.__dict__,historical_ids=[ID(i) for i in range(1,count+1)],
             admission_expires_at=e.cfg.admission_expires_at.isoformat())
    if fault=="duplicate": raw["historical_ids"][-1]=ID(1)
    elif fault=="missing_old": raw["historical_ids"][0]=ID(999)
    else: raw["historical_ids"][-1]="invalid"
    with pytest.raises(s.Closed): s.Binding.parse(raw)
    assert not e.http


@pytest.mark.parametrize("count", [20,23])
@pytest.mark.parametrize("fault", ["missing_history_ban","active_history","short_history_ban","ledger_identity_omitted"])
def test_full_history_is_required_before_admission_not_just_old_subset(e,count,fault):
    set_history(e,count)
    def mutate(data):
        if fault=="missing_history_ban": data["bans"].pop(ID(count))
        elif fault=="active_history": data["bans"][ID(count)]=None
        elif fault=="short_history_ban": data["bans"][ID(count)]=START+timedelta(days=365)
        else: data["prior_unknown"]=True
    e.port.mutate=mutate
    asyncio.run(e.runner.run())
    assert e.runner.failed and not e.runner.admission_ready and not e.http
    assert e.port.stopped and not e.runner.operator_gate


@pytest.mark.parametrize("count", [17,20,23])
@pytest.mark.parametrize("fault", ["sentinel","overflow","duplicate","missing_current","missing_history","fourth_new","overlap","prior_unknown","consumed"])
def test_bounded_decoded_history_requires_exact_known_set_before_http(e,count,fault):
    set_history(e,count)
    raw=wire_snapshot(e)
    assert len(raw["_bans"])==count+3
    if fault in {"sentinel","overflow","fourth_new"}:
        raw["_bans"].append({"id":ID(999),"banned_until":(START+timedelta(days=36500)).isoformat()})
        if fault=="overflow":
            raw["_bans"].append({"id":ID(998),"banned_until":(START+timedelta(days=36500)).isoformat()})
        elif fault=="fourth_new":
            raw["_attempts"].append(dict(raw["_attempts"][0],label="fourth",user_id=ID(999)))
    elif fault=="duplicate": raw["_bans"].append(dict(raw["_bans"][0]))
    elif fault in {"missing_current","missing_history"}:
        omitted=e.ids["b"] if fault=="missing_current" else ID(count)
        raw["_bans"]=[x for x in raw["_bans"] if x["id"]!=omitted]
    elif fault=="overlap": raw["_attempts"][0]["user_id"]=ID(count)
    elif fault=="prior_unknown": raw["_prior_unknown"]=True
    else: raw["stopped"]=raw["reconciliation_required"]=True
    port,calls=query_port(e,raw)
    if fault in {"duplicate","overflow"}:
        with pytest.raises(s.Closed): port.read()
    else:
        decoded=port.read()
        if fault=="sentinel":
            # The bounded sentinel is decoded, but never admitted as a known ID.
            assert len(decoded["bans"])==count+4
        e.runner.port=port
        e.runner.ready=True
        asyncio.run(e.runner.run())
        final=next(x for x in e.logs if x["kind"]=="PRIVATE_VALIDATOR_TASK_STOPPED")
        assert e.runner.failed and not e.runner.admission_ready and not e.runner.operator_gate
        assert final["cleanup"]["status"]!="ALLOCATED_IDENTITIES_VERIFIED"
    assert calls[0][1]["ban_limit"]==count+4<=27 and not e.http


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Disposable local/CI PostgreSQL only")
@pytest.mark.parametrize("history_count", [17, 20, 23])
def test_postgres_single_snapshot_matches_legacy_payload_and_privileges(history_count):
    # Synthetic SQL contract only, never supported Auth provisioning/hosted UAT.
    # All fixture schema/data changes roll back in the disposable CI database.
    opt_in = os.environ.get("FILL_SERVER_SNAPSHOT_FIXTURES")
    if os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GITHUB_JOB") == "contract":
        opt_in = "ci-local-only"  # existing disposable PostgreSQL job only
    engine = snapshot_fixture_engine(os.environ["TEST_DATABASE_URL"], opt_in)
    run, authority, deployment, executor = (str(uuid.uuid4()) for _ in range(4))
    history = list(g.OLD_USERS) + [str(uuid.uuid4()) for _ in range(history_count-len(g.OLD_USERS))]
    plan = b.Plan.parse({"run_id": run, "authorization_id": authority, "candidate_sha": "a"*40,
                         "passwords": {k: PASSWORD+k for k in s.LABELS}})
    with engine.connect() as c:
        transaction = c.begin()
        class ConnectionEngine:
            @contextmanager
            def begin(self):
                yield c
        journal = b.Journal(ConnectionEngine(), deployment=deployment)
        boot = SimpleNamespace(plan=plan, journal=journal)
        try:
            c.execute(text("alter table auth.users add column if not exists banned_until timestamptz, "
                           "add column if not exists created_at timestamptz, add column if not exists raw_app_meta_data jsonb"))
            for uid in history:
                c.execute(text("insert into auth.users(id,banned_until) values(cast(:id as uuid),clock_timestamp()+interval '100 years') "
                               "on conflict(id) do update set banned_until=excluded.banned_until"), {"id": uid})
            for org in sorted(g.ORGANIZATIONS):
                c.execute(text("insert into public.organizations(id,slug,name) values(cast(:id as uuid),:slug,'FICTIONAL CI') "
                               "on conflict(id) do nothing"), {"id": org, "slug": "snapshot-ci-"+org})
            c.execute(text("insert into fill_private.uat_bootstrap_intents "
                "(run_id,authorization_id,candidate_sha,project_ref,organization_ids,input_digest,deployment_id,settled_at,request_expires_at) "
                "values(cast(:run as uuid),cast(:authority as uuid),:sha,:project,cast(:orgs as jsonb),:digest,cast(:deployment as uuid),"
                "clock_timestamp(),clock_timestamp()+interval '4 minutes')"),
                {"run": run, "authority": authority, "sha": plan.candidate_sha, "project": g.PROJECT,
                 "orgs": json.dumps(sorted(g.ORGANIZATIONS)), "digest": plan.digest, "deployment": deployment})
            cfg = SimpleNamespace(run_id=run, historical_ids=history)
            port = s.JournalPort(boot, cfg)
            before = port.read()
            assert before["run"] is None and before["intent"]["attempts"] == [] and len(before["bans"]) == history_count
            journal.preflight(plan, executor)
            c.execute(text("update fill_private.uat_bootstrap_intents set released_at=clock_timestamp() where run_id=cast(:run as uuid)"), {"run": run})
            journal.claim(plan, executor)
            for label in s.LABELS:
                uid = str(uuid.uuid4())
                journal.reserve(plan, executor, label, "create")
                c.execute(text("insert into auth.users(id,banned_until,created_at,raw_app_meta_data) "
                    "values(cast(:id as uuid),clock_timestamp()+interval '100 years',clock_timestamp(),cast(:meta as jsonb))"),
                    {"id": uid, "meta": json.dumps({"fill_f1_run": run, "fictional": True})})
                journal.record(plan, executor, label, "create", uid, verified=True)
            legacy = journal.read(plan)
            lease = b.lease_for(plan, legacy["starts_at"], legacy["attempts"])
            journal.members(plan, lease)
            journal.enroll(plan, lease, stopped=False)
            g.SQLLedger(ConnectionEngine()).record(lease, {}, True)
            nonce = journal.reserve(plan, executor, "canary", "activate")
            principal = next(p for p in lease.principals if p.label == "canary")
            c.execute(text("update auth.users set raw_app_meta_data=raw_app_meta_data||cast(:meta as jsonb) where id=cast(:id as uuid)"),
                      {"id": principal.id, "meta": json.dumps({"fill_f1_activation_nonce": nonce})})
            journal.record(plan, executor, "canary", "activate", principal.id, verified=True)
            legacy = journal.read(plan)
            expected = dict(legacy)
            decoded = port.read()
            # SQL clock is observed at each statement; all remaining native
            # intent fields/attempt UUIDs/timestamps must remain exactly equal.
            now = expected.pop("db_now")
            got = dict(decoded["intent"])
            assert abs((got.pop("db_now")-now).total_seconds()) < 10
            assert got == expected
            assert decoded["run"]["spec"] == json.loads(lease.document)
            assert decoded["run"]["healthy_at"].tzinfo is not None
            assert len(decoded["bans"]) == history_count+3 and len(decoded["markers"]) == len(decoded["members"]) == 3
            assert set(decoded["bans"]) == set(history) | {p.id for p in lease.principals}
            assert decoded["prior_unknown"] is False
            if history_count==23:
                for omitted in (history[-1],lease.principals[-1].id):
                    savepoint=c.begin_nested()
                    try:
                        c.execute(text("delete from auth.users where id=cast(:id as uuid)"),{"id":omitted})
                        partial=port.read()
                        assert omitted not in partial["bans"] and len(partial["bans"])==25
                    finally:
                        savepoint.rollback()
            native_members = [dict(x) for x in c.execute(text("select user_id,organization_id,role::text "
                "from public.organization_members where user_id=any(cast(:ids as uuid[]))"),
                {"ids": [p.id for p in lease.principals]}).mappings()]
            assert sorted(decoded["members"], key=lambda x: str(x["user_id"])) == sorted(native_members, key=lambda x: str(x["user_id"]))
            for role in ("anon", "authenticated"):
                with pytest.raises(Exception), c.begin_nested():
                    c.execute(text("set local role "+role))
                    port.read()  # no SECURITY DEFINER/elevated SQL or RLS bypass
            # New inactive synthetic intent checks earlier-journal completeness
            # before any new admission/action; this is not Auth provisioning.
            next_plan=b.Plan.parse({"run_id":str(uuid.uuid4()),"authorization_id":str(uuid.uuid4()),
                                   "candidate_sha":plan.candidate_sha,"passwords":{k:PASSWORD+k for k in s.LABELS}})
            c.execute(text("insert into fill_private.uat_bootstrap_intents "
                "(run_id,authorization_id,candidate_sha,project_ref,organization_ids,input_digest,deployment_id,settled_at,request_expires_at) "
                "select cast(:next as uuid),cast(:authority as uuid),candidate_sha,project_ref,organization_ids,:digest,"
                "deployment_id,clock_timestamp(),clock_timestamp()+interval '4 minutes' "
                "from fill_private.uat_bootstrap_intents where run_id=cast(:prior as uuid)"),
                {"next":next_plan.run_id,"authority":next_plan.authorization_id,"digest":next_plan.digest,"prior":run})
            next_port=s.JournalPort(SimpleNamespace(plan=next_plan,journal=journal),SimpleNamespace(run_id=next_plan.run_id,historical_ids=history))
            assert next_port.read()["prior_unknown"] is True
            if history_count in {17,20}:
                complete=history+[p.id for p in lease.principals]
                next_port.binding=SimpleNamespace(run_id=next_plan.run_id,historical_ids=complete)
                readback=next_port.read()
                assert readback["prior_unknown"] is False and len(readback["bans"])==history_count+3
                incomplete=list(complete)
                incomplete[-1]=str(uuid.uuid4())
                next_port.binding=SimpleNamespace(run_id=next_plan.run_id,historical_ids=incomplete)
                assert next_port.read()["prior_unknown"] is True
            else:
                # 23+3 completed identities do not authorize a new history26 mode.
                next_port.binding=SimpleNamespace(run_id=next_plan.run_id,historical_ids=history+[p.id for p in lease.principals])
                with pytest.raises(s.Closed): next_port.read()
        finally:
            transaction.rollback()
    engine.dispose()
