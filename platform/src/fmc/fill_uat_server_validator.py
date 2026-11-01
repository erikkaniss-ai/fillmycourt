"""Default-disabled, in-process fictional read-only validator. No public API.

Only the existing bootstrap provisions/activates; only the independent guard
bans. This task can durably stop, never release or write an independent verdict.
Operational evidence belongs ONLY in the existing private service log/Docs.
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import json
import logging
import os
import re
import time
import uuid
from urllib.parse import urlencode

import httpx
from sqlalchemy import text

from . import fill_uat_guard as g

LABELS = ("canary", "a", "b")
ROUTES = ("me", "organizations", "own_today", "foreign_today", "own_calendar", "foreign_calendar", "provider_connections")
CONTROL_SECONDS, READ_SECONDS = 2.0, 6.0
MAX_BODY = 16384
LOG = logging.getLogger("fmc.fill_uat.private")


class Closed(Exception):
    def __init__(self, code="CLOSED"):
        self.code = code if code in {"CLOSED", "TIMEOUT", "REPLAY", "BINDING", "STALE", "IDENTITY", "HTTP", "ROOT", "CLOCK"} else "CLOSED"
        super().__init__("FILL_SERVER_VALIDATOR_CLOSED")


def require(ok, code="CLOSED"):
    if not ok:
        raise Closed(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def check_public_key(value):
    require(isinstance(value, str) and re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]{20,240}", value), "BINDING")


@dataclass(frozen=True, repr=False)
class Binding:
    operations_sha: str
    preview_sha: str
    deployment_id: str
    run_id: str
    authorization_id: str
    historical_ids: tuple
    organizations: dict
    receipt_document: str
    admission_expires_at: object
    operations_origin: str

    @classmethod
    def parse(cls, value):
        try:
            require(isinstance(value, dict) and set(value) == set(cls.__dataclass_fields__), "BINDING")
            for key in ("operations_sha", "preview_sha"):
                require(isinstance(value[key], str) and re.fullmatch(r"[0-9a-f]{40}", value[key]), "BINDING")
            for key in ("deployment_id", "run_id", "authorization_id"):
                g.uid(value[key])
            history = value["historical_ids"]
            require(isinstance(history, list) and len(history) in {17, 20} and len(history) == len(set(history))
                    and g.OLD_USERS.issubset(set(history)), "BINDING")
            for uid in history:
                g.uid(uid)
            orgs = value["organizations"]
            require(isinstance(orgs, dict) and set(orgs) == {"a", "b"} and set(orgs.values()) == g.ORGANIZATIONS, "BINDING")
            doc = value["receipt_document"]
            require(isinstance(doc, str) and re.fullmatch(r"https://docs\.google\.com/document/d/[A-Za-z0-9_-]{10,100}/edit", doc) and len(doc) + 65 <= 200, "BINDING")
            expiry = g.timestamp(value["admission_expires_at"])
            require(isinstance(value["operations_origin"], str) and re.fullmatch(r"https://[a-z0-9][a-z0-9-]*\.up\.railway\.app", value["operations_origin"]), "BINDING")
            return cls(**dict(value, historical_ids=tuple(history), organizations=dict(orgs), admission_expires_at=expiry))
        except Exception:
            raise Closed("BINDING") from None


class JournalPort:
    """Narrow reads of existing objects; the only mutation is existing stop()."""
    # One MVCC data statement, through the existing timeout-bounded transaction.
    # Do not call Journal.read first: that would open a separate snapshot and
    # repeat its round trips. No locks, new objects or credential columns.
    SNAPSHOT = text("""
        with attempts as materialized (
          select * from fill_private.uat_bootstrap_attempts
          where run_id=cast(:run as uuid) order by label,operation limit 7
        ), created as materialized (
          select user_id as id from attempts where operation='create' and user_id is not null
        ), known as (
          select unnest(cast(:history as uuid[])) as id union select id from created
        )
        select i.*,clock_timestamp() as db_now,
          encode(sha256(convert_to(r.spec::text,'UTF8')),'hex') as lease_digest,
          coalesce((select jsonb_agg(to_jsonb(a) order by label,operation) from attempts a),'[]'::jsonb) as _attempts,
          case when r.run_id is null then null else jsonb_build_object(
            'spec',r.spec,'armed',r.armed,'stopped',r.stopped,'healthy_at',r.healthy_at,
            'receipts',r.receipts,'cleanup_complete',r.cleanup_complete) end as _run,
          coalesce((select jsonb_agg(to_jsonb(b)) from (
            select id,banned_until from auth.users where id in (select id from known) limit :ban_limit
          ) b),'[]'::jsonb) as _bans,
          coalesce((select jsonb_agg(to_jsonb(m)) from (
            select id,created_at,raw_app_meta_data->>'fill_f1_run' as run_marker,
              raw_app_meta_data->>'fictional' as fictional,raw_app_meta_data->>'fill_f1_activation_nonce' as nonce
            from auth.users where id in (select id from created) limit 4
          ) m),'[]'::jsonb) as _markers,
          coalesce((select jsonb_agg(to_jsonb(m)) from (
            select user_id,organization_id,role::text from public.organization_members
            where user_id in (select id from created) limit 7
          ) m),'[]'::jsonb) as _members,
          exists(select 1 from fill_private.uat_bootstrap_attempts
            where operation='create' and run_id<>cast(:run as uuid) and user_id is not null
            and not(user_id=any(cast(:history as uuid[])))) as _prior_unknown
        from fill_private.uat_bootstrap_intents i
        left join fill_private.uat_runs r using(run_id)
        where i.run_id=cast(:run as uuid)
    """)

    def __init__(self, bootstrap, binding):
        self.bootstrap, self.binding = bootstrap, binding

    def read(self):
        boot, cfg = self.bootstrap, self.binding
        require(boot.plan.run_id == cfg.run_id and len(cfg.historical_ids) in {17, 20}, "BINDING")
        with boot.journal.tx() as c:
            raw = c.execute(self.SNAPSHOT, {"run": cfg.run_id, "history": list(cfg.historical_ids),
                                          "ban_limit": len(cfg.historical_ids)+4}).mappings().first()
        if raw is None:
            return None
        try:
            return self.decode(dict(raw))
        except (KeyError, TypeError, ValueError):
            raise Closed("BINDING") from None

    def decode(self, row):
        plan, journal = self.bootstrap.plan, self.bootstrap.journal
        # Preserve every Journal.row authority/digest/order check. Native intent
        # timestamps/JSON types are retained; only nested JSON timestamps decode.
        require(str(row["run_id"]) == plan.run_id and str(row["authorization_id"]) == plan.authorization_id
                and row["candidate_sha"] == plan.candidate_sha and row["project_ref"] == g.PROJECT
                and row["organization_ids"] == sorted(g.ORGANIZATIONS) and row["input_digest"] == plan.digest
                and (journal.deployment is None or str(row["deployment_id"]) == journal.deployment), "BINDING")
        for key in ("db_now", "created_at", "settled_at", "request_expires_at", "preflight_at", "released_at", "starts_at", "verdict_at"):
            value = row[key]
            require((value is None and key not in {"db_now", "created_at", "settled_at", "request_expires_at"})
                    or isinstance(value, datetime) and value.tzinfo is not None, "BINDING")
        for key in ("stopped", "reconciliation_required", "_prior_unknown"):
            require(type(row[key]) is bool, "BINDING")
        def rows(key, maximum):
            value = row.pop(key)
            require(isinstance(value, list) and len(value) <= maximum and all(isinstance(x, dict) for x in value), "BINDING")
            return [dict(x) for x in value]
        def date_fields(value, keys):
            for key in keys:
                value[key] = g.timestamp(value[key]) if value[key] is not None else None
            return value
        attempts = rows("_attempts", 6)
        for attempt in attempts:
            require(type(attempt["verified"]) is bool and type(attempt["settled"]) is bool, "BINDING")
            for key in ("run_id", "activation_nonce"):
                attempt[key] = uuid.UUID(g.uid(attempt[key]))
            require(str(attempt["run_id"]) == plan.run_id, "BINDING")
            if attempt["user_id"] is not None:
                g.uid(attempt["user_id"])
            date_fields(attempt, ("reserved_at", "first_ban_readback_at"))
        run = row.pop("_run")
        if run is not None:
            require(isinstance(run, dict) and isinstance(run["spec"], dict) and isinstance(run["receipts"], dict)
                    and all(type(run[k]) is bool for k in ("armed", "stopped", "cleanup_complete")), "BINDING")
            run = date_fields(dict(run), ("healthy_at",))
        bans = rows("_bans", min(len(self.binding.historical_ids)+4, 24))
        markers = rows("_markers", 4)
        members = rows("_members", 7)
        for ban in bans:
            g.uid(ban["id"])
            date_fields(ban, ("banned_until",))
        for marker in markers:
            marker["id"] = uuid.UUID(g.uid(marker["id"]))
            date_fields(marker, ("created_at",))
        for member in members:
            member["user_id"] = uuid.UUID(g.uid(member["user_id"]))
            member["organization_id"] = uuid.UUID(g.uid(member["organization_id"]))
            require(isinstance(member["role"], str), "BINDING")
        require(len({x["id"] for x in bans}) == len(bans) and len({x["id"] for x in markers}) == len(markers), "BINDING")
        prior_unknown = row.pop("_prior_unknown")
        row["attempts"] = attempts
        return {"intent": row, "run": run, "bans": {x["id"]: x["banned_until"] for x in bans},
                "markers": {str(x["id"]): x for x in markers}, "members": members, "prior_unknown": prior_unknown}

    def stop(self):
        self.bootstrap.journal.stop(self.bootstrap.plan, reconcile=True)
        row = self.bootstrap.journal.read(self.bootstrap.plan)
        return row is None or row["stopped"] and row["reconciliation_required"]


class Clients:
    """User client only. No Admin credential, arbitrary destination or redirects."""
    def __init__(self, publishable_key, plan, operations_origin, *, auth_transport=None, ops_transport=None, clock=g.utcnow):
        check_public_key(publishable_key)
        require(isinstance(operations_origin, str) and re.fullmatch(r"https://[a-z0-9][a-z0-9-]*\.up\.railway\.app", operations_origin), "BINDING")
        self.plan, self.key, self.sessions = plan, publishable_key, {}
        self.clock = clock
        self.closed = False
        self.auth = httpx.AsyncClient(base_url=g.ORIGIN, transport=auth_transport, follow_redirects=False, trust_env=False, timeout=CONTROL_SECONDS)
        self.ops = httpx.AsyncClient(base_url=operations_origin, transport=ops_transport, follow_redirects=False, trust_env=False, timeout=CONTROL_SECONDS)

    def __repr__(self):
        return "<FillUserClients private>"

    async def _request(self, client, method, path, *, headers, payload=None, body=True):
        require(not self.closed, "HTTP")
        async with client.stream(method, path, headers=headers, json=payload) as response:
            data = bytearray()
            if body:
                async for chunk in response.aiter_bytes():
                    require(len(data) + len(chunk) <= MAX_BODY, "HTTP")
                    data.extend(chunk)
            status = response.status_code
            parsed = json.loads(data) if body else {}
            require(not self.closed and isinstance(parsed, dict), "HTTP")
            return status, parsed

    async def login(self, label, identity, t0, *, deny=False):
        status, body = await self._request(self.auth, "POST", "/auth/v1/token?grant_type=password",
            headers={"apikey": self.key, "content-type": "application/json"},
            payload={"email": self.plan.email(label), "password": self.plan.passwords[label]})
        if deny:
            codes = [body[k] for k in ("code", "error_code") if isinstance(body.get(k), str)]
            require(status in (400, 401, 403) and codes and all(x == "user_banned" for x in codes), "HTTP")
            return status
        user = body.get("user", {})
        meta = user.get("app_metadata", {})
        token, expiry = body.get("access_token"), body.get("expires_in")
        require(status == 200 and user.get("id") == identity and user.get("email") == self.plan.email(label)
                and user.get("role") == "authenticated" and user.get("email_confirmed_at")
                and meta.get("fill_f1_run") == self.plan.run_id and meta.get("fictional") is True
                and t0 <= g.timestamp(user["created_at"]) < t0 + timedelta(seconds=60)
                and isinstance(token, str) and 20 <= len(token) <= 4096 and token.count(".") == 2
                and type(expiry) is int and 0 < expiry <= 86400, "IDENTITY")
        self.sessions[label] = (token, self.clock() + timedelta(seconds=expiry))
        return status

    async def get(self, label, route, identity, organizations, day, *, deny=False):
        token, expiry = self.sessions[label]
        require(deny or self.clock() < expiry, "HTTP")
        own = organizations["b" if label == "b" else "a"]
        foreign = organizations["a" if label == "b" else "b"]
        start = day + "T00:00:00Z"
        end = (g.timestamp(start) + timedelta(days=1)).isoformat()
        paths = {"me": "/api/me", "organizations": "/api/fmc/organizations",
            "own_today": f"/api/fmc/{own}/today?" + urlencode({"date": day}),
            "foreign_today": f"/api/fmc/{foreign}/today?" + urlencode({"date": day}),
            "own_calendar": f"/api/fmc/{own}/calendar?" + urlencode({"start": start, "end": end}),
            "foreign_calendar": f"/api/fmc/{foreign}/calendar?" + urlencode({"start": start, "end": end}),
            "provider_connections": f"/api/fmc/{own}/provider-provenance/connections"}
        expected_deny = deny or route.startswith("foreign_") or route == "provider_connections" and label == "b"
        status, body = await self._request(self.ops, "GET", paths[route], headers={"Authorization": "Bearer " + token}, body=not expected_deny)
        if expected_deny:
            require(status in ((401, 403) if deny else (403,)), "HTTP")
        else:
            require(status == 200, "HTTP")
            if route == "me":
                require(body.get("user", {}).get("id") == identity, "IDENTITY")
            elif route == "organizations":
                items = body.get("items")
                require(isinstance(items, list) and len(items) == 1 and items[0].get("id") == own
                        and items[0].get("role") == ("manager" if label == "b" else "owner"), "IDENTITY")
            elif route == "own_today":
                require(body.get("date") == day and isinstance(body.get("courts"), list), "HTTP")
            elif route == "own_calendar":
                require(all(isinstance(body.get(k), list) for k in ("bookings", "holds", "blocks")), "HTTP")
            elif route == "provider_connections":
                require(isinstance(body.get("items"), list), "HTTP")
        return status

    async def close(self):
        self.closed = True
        self.sessions.clear()
        await asyncio.gather(self.auth.aclose(), self.ops.aclose())


class ServerValidator:
    def __init__(self, binding, bootstrap, port, client_factory, *, clock=g.utcnow, monotonic=time.monotonic, sink=None, sleep=asyncio.sleep):
        self.binding, self.bootstrap, self.port, self.client_factory = binding, bootstrap, port, client_factory
        self.clock, self.monotonic = clock, monotonic
        self.sleep = sleep
        self.anchor, self.tick = clock(), monotonic()
        require(self.anchor < binding.admission_expires_at <= self.anchor + timedelta(seconds=300), "BINDING")
        self.sink = sink or (lambda value: LOG.warning("FILL_UAT_PRIVATE %s", canonical(value)))
        self.ready = self.root_ready = self.failed = self.finished = False
        self.started = self.spec_digest = self.spec_document = self.proof = None
        self.proof_digest = None
        self.events, self.used, self.sessions = [], set(), set()
        self.last_observed = None
        self.jobs, self.read_pool, self.stop_pool, self.client = set(), None, None, None
        self.stop_confirmed = False
        self.operator_gate = False
        self.identities = {}
        self.client_closed = False

    def emit(self, value):
        try:
            self.sink(json.loads(canonical(value)))
            return True
        except Exception:
            return False

    def __repr__(self):
        return "<FillServerValidator default-disabled private state>"

    @property
    def admission_ready(self):
        return self.ready and not self.failed and not self.finished

    @property
    def root_grant_ready(self):
        return (self.root_ready and self.admission_ready and self.started is not None and self.last_observed is not None
                and 0 <= (self.now() - self.last_observed).total_seconds() <= 10 and self.now() < self.started + timedelta(seconds=600))

    def now(self):
        wall, elapsed = self.clock(), self.monotonic() - self.tick
        require(elapsed >= 0 and abs((wall - self.anchor).total_seconds() - elapsed) <= 2, "CLOCK")
        require(not self.started or self.started <= wall < self.started + timedelta(seconds=1800), "CLOCK")
        return wall

    async def bounded(self, awaitable, seconds, *, stage):
        require(stage in {"admission_snapshot", "control_snapshot", "cleanup_snapshot", "durable_stop", "client_close", "user_login", "user_get"})
        began, abandoned = time.monotonic(), False
        def evidence(kind, outcome=None):
            value = {"kind": kind, "stage": stage, "elapsed_ms": round(max(0, time.monotonic() - began) * 1000, 3)}
            if outcome is not None:
                value["outcome"] = outcome
            self.emit(value)  # fixed labels/duration only; no SQL, values or exception
        job = asyncio.ensure_future(awaitable)
        self.jobs.add(job)
        def settled(task):
            self.jobs.discard(task)
            error = None if task.cancelled() else task.exception()
            if abandoned:
                evidence("PRIVATE_VALIDATOR_LATE_STAGE", "cancelled" if task.cancelled() else "error" if error else "complete")
            if self.finished and not self.jobs:
                self.emit({"kind": "PRIVATE_VALIDATOR_OWNERSHIP_DRAINED", "owned_pending": 0, "client_closed": self.client_closed})
        job.add_done_callback(settled)
        try:
            done, _ = await asyncio.wait({job}, timeout=seconds)
        except asyncio.CancelledError:
            abandoned = True
            evidence("PRIVATE_VALIDATOR_STAGE_INTERRUPTED")
            raise
        if not done:
            abandoned = True
            evidence("PRIVATE_VALIDATOR_STAGE_TIMEOUT")
            raise Closed("TIMEOUT")  # not cancellation; late job stays owned
        return job.result()

    async def threaded(self, callback, pool):
        future = asyncio.get_running_loop().run_in_executor(pool, callback)
        return await asyncio.shield(future)

    async def snapshot(self, *, allow_stopped=False):
        begin = self.monotonic()
        data = await self.bounded(self.threaded(self.port.read, self.read_pool), CONTROL_SECONDS,
                                  stage="admission_snapshot" if self.started is None else "control_snapshot")
        require(self.monotonic() - begin <= CONTROL_SECONDS, "STALE")
        now = self.now()
        if data is None:
            require(not self.started and now < self.binding.admission_expires_at, "STALE")
            return None
        row, cfg = data["intent"], self.binding
        require(str(row["run_id"]) == cfg.run_id and str(row["authorization_id"]) == cfg.authorization_id
                and row["candidate_sha"] == cfg.operations_sha and str(row["deployment_id"]) == cfg.deployment_id
                and row["project_ref"] == g.PROJECT and set(row["organization_ids"]) == g.ORGANIZATIONS
                and 0 <= (now - row["db_now"]).total_seconds() <= 10 and not data["prior_unknown"], "BINDING")
        require(self.last_observed is None or row["db_now"] >= self.last_observed, "STALE")
        require(allow_stopped or not row["stopped"] and not row["reconciliation_required"], "REPLAY")
        require(all(uid in data["bans"] and data["bans"][uid] is not None
                    and data["bans"][uid] > now + timedelta(days=365) for uid in cfg.historical_ids), "IDENTITY")
        if row["starts_at"] is None:
            require(not self.started and now < row["request_expires_at"], "REPLAY")
            self.ready = True
            return None
        require(self.ready and str(row["executor"]) == self.bootstrap.executor, "REPLAY")
        if self.started is None:
            self.started = row["starts_at"]
        require(self.started == row["starts_at"] and self.started <= now < self.started + timedelta(seconds=1800), "REPLAY")
        attempts = row["attempts"]
        require(len(attempts) <= 6 and len({(a["label"], a["operation"]) for a in attempts}) == len(attempts), "IDENTITY")
        creates = {a["label"]: a for a in attempts if a["operation"] == "create"}
        require(all(a["label"] in LABELS and a["operation"] in {"create", "activate"} for a in attempts), "IDENTITY")
        require(all(a["verified"] and a["user_id"] or (now - a["reserved_at"]).total_seconds() < 10 for a in attempts), "IDENTITY")
        require(all(a["activation_nonce"] and self.started <= a["reserved_at"] < self.started + timedelta(seconds=60 if a["operation"] == "create" or a["label"] == "canary" else 600) for a in attempts), "IDENTITY")
        if len(creates) != 3 or any(not a["verified"] or not a["user_id"] for a in creates.values()) or data["run"] is None:
            require(now < self.started + timedelta(seconds=60), "IDENTITY")
            return None
        ids = {label: creates[label]["user_id"] for label in LABELS}
        require(len(set(ids.values())) == 3 and not set(ids.values()) & set(cfg.historical_ids), "IDENTITY")
        require(set(data["bans"]) == set(ids.values()) | set(cfg.historical_ids) and set(data["markers"]) == set(ids.values()), "IDENTITY")
        run = data["run"]
        if not self.events and run["healthy_at"] is None and now < self.started + timedelta(seconds=60):
            return None
        require(run["armed"] and (allow_stopped or not run["stopped"]) and run["healthy_at"] is not None
                and 0 <= (now - run["healthy_at"]).total_seconds() <= 45 and (allow_stopped or not run["cleanup_complete"]), "STALE")
        require(row["lease_digest"] and re.fullmatch(r"[0-9a-f]{64}", row["lease_digest"]), "BINDING")
        document = canonical(run["spec"])
        if self.spec_digest is None:
            self.spec_digest, self.spec_document = row["lease_digest"], document
        require(self.spec_digest == row["lease_digest"] and self.spec_document == document, "BINDING")
        lease = g.Lease.parse(run["spec"])
        require(lease.run_id == cfg.run_id and lease.candidate_sha == cfg.operations_sha and lease.starts_at == self.started
                and lease.expires_at == self.started + timedelta(seconds=1800) and len(lease.principals) == 3, "BINDING")
        for label, uid in ids.items():
            require(lease.principal(uid) is not None and lease.principal(uid).label == label, "IDENTITY")
            m = data["markers"].get(uid)
            require(m and m["run_marker"] == cfg.run_id and m["fictional"] == "true"
                    and self.started <= m["created_at"] < self.started + timedelta(seconds=60), "IDENTITY")
            members = [x for x in data["members"] if str(x["user_id"]) == uid]
            require(len(members) == 1 and str(members[0]["organization_id"]) == cfg.organizations["b" if label == "b" else "a"]
                    and members[0]["role"] == ("manager" if label == "b" else "owner"), "IDENTITY")
        for a in attempts:
            if a["operation"] == "activate":
                require(a["user_id"] is None or a["user_id"] == ids[a["label"]], "IDENTITY")
                if a["verified"] and a["settled"]:
                    require(a["user_id"] == ids[a["label"]] and str(a["activation_nonce"]) == data["markers"][a["user_id"]]["nonce"], "IDENTITY")
        require(not self.identities or self.identities == ids, "IDENTITY")
        self.identities = ids
        self.last_observed = row["db_now"]
        return dict(data, ids=ids)

    def activated(self, data, label):
        return any(a["operation"] == "activate" and a["label"] == label and a["verified"] and a["settled"]
                   and a["user_id"] == data["ids"][label] for a in data["intent"]["attempts"])

    async def action(self, label, route, *, login=False, deny=False):
        slot = (label, route, deny)
        require(slot not in self.used, "REPLAY")
        self.used.add(slot)  # consumed before any request, even ambiguity
        began = self.monotonic()
        data = await self.snapshot()
        require(data is not None and self.activated(data, label), "IDENTITY")
        age = (self.now() - self.started).total_seconds()
        require(120 <= age < 180 if deny else age < (120 if label == "canary" else 600 if login else 1200), "CLOCK")
        require(label == "canary" or self.operator_gate and (not login or self.root_grant_ready), "ROOT")
        uid = data["ids"][label]
        if not deny:
            require(data["bans"].get(uid) is None or data["bans"][uid] <= self.now(), "IDENTITY")
        operation = self.client.login(label, uid, self.started, deny=deny) if login else self.client.get(label, route, uid, self.binding.organizations, self.started.date().isoformat(), deny=deny)
        status = await self.bounded(operation, CONTROL_SECONDS, stage="user_login" if login else "user_get")
        after = await self.snapshot()
        require(after is not None and self.monotonic() - began <= READ_SECONDS, "STALE")
        age = (self.now() - self.started).total_seconds()
        require(120 <= age < 180 if deny else age < (120 if label == "canary" else 600 if login else 1200), "CLOCK")
        self.events.append({"label": label, "user_id": uid, "route": route, "status": status, "verified": True,
                            "denied": deny or route.startswith("foreign_") or route == "provider_connections" and label == "b", "at": self.now().isoformat()})

    def root_grant(self, data):
        row = data["intent"]
        verdict = row["verdict"]
        if verdict is None:
            return False
        require(self.proof is not None and set(verdict) == {"candidate_sha", "decision", "denied_api", "denied_login", "evidence_ref", "lease_digest", "positive_get", "run_id"}, "ROOT")
        expected = {"kind": "FILL_SERVER_CANARY_V1", "execution_mode": "in_process_async", "operations_transport": "hosted_https", "project_ref": g.PROJECT,
                    "operations_origin": self.binding.operations_origin,
                    "run_id": self.binding.run_id, "authorization_id": self.binding.authorization_id,
                    "operations_sha": self.binding.operations_sha, "preview_sha": self.binding.preview_sha,
                    "deployment_id": self.binding.deployment_id, "spec_digest": self.spec_digest,
                    "t0": self.started.isoformat(), "expires_at": (self.started + timedelta(seconds=600)).isoformat()}
        require(all(self.proof.get(k) == value for k, value in expected.items()), "ROOT")
        require(verdict["decision"] == "pass" and verdict["run_id"] == self.binding.run_id
                and verdict["candidate_sha"] == self.binding.operations_sha and verdict["lease_digest"] == self.spec_digest
                and all(verdict[k] is True for k in ("positive_get", "denied_login", "denied_api"))
                and verdict["evidence_ref"] == self.binding.receipt_document + "#" + self.proof_digest
                and self.proof_digest == hashlib.sha256(canonical(self.proof).encode()).hexdigest(), "ROOT")
        require(self.started + timedelta(seconds=180) <= row["verdict_at"] <= self.now() < self.started + timedelta(seconds=600)
                and g.timestamp(self.proof["emitted_at"]) <= row["verdict_at"], "ROOT")
        return True

    async def run(self):
        self.read_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fill-uat-read")
        self.stop_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fill-uat-stop")
        code = "CLOSED"
        try:
            self.client = self.client_factory()
            while True:
                data = await self.snapshot()
                if data is not None and self.activated(data, "canary"):
                    require(self.now() < self.started + timedelta(seconds=72), "CLOCK")
                    break
                await self.sleep(1)
            for route, login in (("login", True), ("own_today", False), ("foreign_today", False)):
                await self.action("canary", route, login=login)
            while True:
                data = await self.snapshot()
                require(self.now() < self.started + timedelta(seconds=180), "CLOCK")
                activation = next(a for a in data["intent"]["attempts"] if a["operation"] == "activate" and a["label"] == "canary")
                ban = activation["first_ban_readback_at"]
                if self.now() >= self.started + timedelta(seconds=120) and ban is not None and data["run"]["receipts"].get(data["ids"]["canary"]) is True:
                    require(self.started <= ban <= self.now() and ban < self.started + timedelta(seconds=180)
                            and data["bans"][data["ids"]["canary"]] > self.now() + timedelta(days=365), "IDENTITY")
                    break
                await self.sleep(1)
            await self.action("canary", "me", deny=True)
            await self.action("canary", "denied_login", login=True, deny=True)
            self.proof = {"kind": "FILL_SERVER_CANARY_V1", "execution_mode": "in_process_async", "operations_transport": "hosted_https", "project_ref": g.PROJECT, "run_id": self.binding.run_id,
                "operations_origin": self.binding.operations_origin,
                "authorization_id": self.binding.authorization_id, "operations_sha": self.binding.operations_sha, "preview_sha": self.binding.preview_sha,
                "deployment_id": self.binding.deployment_id, "spec_digest": self.spec_digest, "t0": self.started.isoformat(),
                "expires_at": (self.started + timedelta(seconds=600)).isoformat(), "emitted_at": self.now().isoformat(),
                "ban_at": ban.isoformat(), "ban_readback_at": data["intent"]["db_now"].isoformat(), "observations": list(self.events)}
            self.proof_digest = hashlib.sha256(canonical(self.proof).encode()).hexdigest()
            require(self.emit({"kind": "PRIVATE_FINAL_CANARY", "proof": self.proof, "sha256": self.proof_digest}), "ROOT")
            while True:
                data = await self.snapshot()
                require(self.now() < self.started + timedelta(seconds=600), "ROOT")
                if self.root_grant(data):
                    self.root_ready = True
                    if all(self.activated(data, label) for label in ("a", "b")):
                        break
                await self.sleep(1)
            # One local gate; both activations have already been verified/settled.
            require(not self.operator_gate and self.root_grant_ready, "ROOT")
            self.operator_gate = True
            for label in ("a", "b"):
                await self.action(label, "login", login=True)
                for route in ROUTES:
                    await self.action(label, route)
            code = "READS_COMPLETE"
        except asyncio.CancelledError:
            code = "CLOSED"
        except Exception as error:
            code = error.code if isinstance(error, Closed) else "CLOSED"
        finally:
            self.failed, self.ready, self.root_ready = code != "READS_COMPLETE", False, False
            try:
                self.stop_confirmed = await self.bounded(self.threaded(self.port.stop, self.stop_pool), CONTROL_SECONDS, stage="durable_stop") is True
            except Exception:
                self.bootstrap.guard.cleanup_error = True
            if self.client is not None:
                try:
                    await self.bounded(self.client.close(), CONTROL_SECONDS, stage="client_close")
                    self.client_closed = True
                except Exception:
                    pass
            cleanup = await self.cleanup_readback() if self.stop_confirmed else {"status": "UNKNOWN"}
            self.finished = True
            self.read_pool.shutdown(wait=False, cancel_futures=True)
            self.stop_pool.shutdown(wait=False, cancel_futures=True)
            self.emit({"kind": "PRIVATE_VALIDATOR_TASK_STOPPED", "status": code, "durable_stop": self.stop_confirmed,
                       "task_closed": True, "client_closed": self.client_closed,
                       "owned_pending": sum(not j.done() for j in self.jobs), "cleanup": cleanup, "process_spawned": False})

    async def cleanup_readback(self):
        try:
            # A timed-out read is still owned. Do not queue more reads behind it.
            if any(not job.done() for job in self.jobs):
                return {"status": "UNKNOWN"}
            if self.started is None:
                return {"status": "TASK_NOT_BOUND"}
            while self.now() < self.started + timedelta(seconds=1800):
                data = await self.bounded(self.threaded(self.port.read, self.read_pool), CONTROL_SECONDS, stage="cleanup_snapshot")
                row, run = data["intent"], data["run"]
                require(str(row["run_id"]) == self.binding.run_id and str(row["authorization_id"]) == self.binding.authorization_id
                        and row["candidate_sha"] == self.binding.operations_sha and str(row["deployment_id"]) == self.binding.deployment_id
                        and row["stopped"] and row["reconciliation_required"] and 0 <= (self.now() - row["db_now"]).total_seconds() <= 10, "BINDING")
                creates = [a for a in row["attempts"] if a["operation"] == "create"]
                if any(not a["verified"] or not a["user_id"] for a in creates):
                    return {"status": "UNKNOWN"}
                ids = [a["user_id"] for a in creates]
                require(len(ids) <= 3 and len(set(ids)) == len(ids) and not set(ids) & set(self.binding.historical_ids), "IDENTITY")
                known = set(ids) | set(self.binding.historical_ids)
                banned = set(data["bans"]) == known and all(x is not None and x > self.now() + timedelta(days=365) for x in data["bans"].values())
                settled = all(a["verified"] and a["settled"] and a["first_ban_readback_at"] is not None for a in row["attempts"] if a["operation"] == "activate")
                if banned and settled and (not ids or run and run["stopped"] and run["cleanup_complete"]):
                    return {"status": "ALLOCATED_IDENTITIES_VERIFIED", "allocated_count": len(ids), "known_banned": len(known), "full_three": len(ids) == 3}
                await self.sleep(1)
        except Exception:
            pass
        return {"status": "UNKNOWN"}

    @asynccontextmanager
    async def lifespan(self, app):
        worker = asyncio.create_task(self.run(), name="fill-uat-server-validator")
        try:
            yield
        finally:
            worker.cancel()
            await worker


class RejectedValidator:
    """Invalid opt-in config quarantines fixtures without stopping the guard."""
    admission_ready = root_grant_ready = False
    failed = finished = True

    @asynccontextmanager
    async def lifespan(self, app):
        LOG.warning("FILL_UAT_PRIVATE validator configuration rejected; admission closed")
        yield


def attach(guard, runner):
    if guard.bootstrap is not None:
        guard.bootstrap.server_validator = runner
    original_check = guard.check
    def checked(actor, method="GET"):
        if guard.is_fixture(actor) and (runner.failed or runner.finished):
            raise g.denied()
        return original_check(actor, method)
    guard.check = checked  # instance-only; sweep/lifespan remain independent
    return runner


def from_environment(settings, service, guard, app):
    mode = os.environ.get("FILL_UAT_SERVER_VALIDATOR", "off")
    if mode == "off" or service != "operations":
        return None  # no config/credential/client/SQL/pool/task access
    try:
        require(mode == "on" and service == "operations" and settings.environment == "staging" and guard.bootstrap is not None, "BINDING")
        private_binding = json.loads(os.environ["FILL_UAT_SERVER_BINDING"])
        # Deployment UUID exists only at container startup. Provider runtime ID
        # is independently cross-checked against the later owner-written intent;
        # selecting "runtime" neither creates nor releases that intent.
        require(private_binding["deployment_id"] == "runtime", "BINDING")
        private_binding["deployment_id"] = g.uid(os.environ["RAILWAY_DEPLOYMENT_ID"])
        cfg = Binding.parse(private_binding)
        boot = guard.bootstrap
        check_public_key(settings.supabase_publishable_key)
        require(cfg.run_id == boot.plan.run_id and cfg.authorization_id == boot.plan.authorization_id
                and cfg.operations_sha == boot.plan.candidate_sha == os.environ.get("RAILWAY_GIT_COMMIT_SHA")
                and cfg.deployment_id == os.environ.get("RAILWAY_DEPLOYMENT_ID")
                and cfg.operations_origin == "https://" + os.environ.get("RAILWAY_PUBLIC_DOMAIN", ""), "BINDING")
        runner = ServerValidator(cfg, boot, JournalPort(boot, cfg), lambda: Clients(settings.supabase_publishable_key, boot.plan, cfg.operations_origin), clock=guard.clock, monotonic=guard.monotonic)
        return attach(guard, runner)
    except Exception:
        return attach(guard, RejectedValidator())
