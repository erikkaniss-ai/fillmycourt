"""Dummy IDs/times, mocked HTTP/journal/clock only. Never hosted acceptance."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import threading
from types import SimpleNamespace
import uuid

import httpx
import pytest

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
    guard = g.Guard(g.Lease.parse(e.spec), SimpleNamespace(pending=lambda: calls.append(1) or []), SimpleNamespace(close=lambda: None), clock=e.clock.wall, monotonic=e.clock.tick)
    guard.bootstrap = None
    runner = s.from_environment(SimpleNamespace(environment="staging"), "operations", guard, None)
    assert isinstance(runner, s.RejectedValidator) and not runner.admission_ready
    monkeypatch.setattr(g, "POLL_SECONDS", .01)
    async def exercise():
        async with guard.lifespan(None):
            async with runner.lifespan(None):
                await asyncio.sleep(.04)
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
