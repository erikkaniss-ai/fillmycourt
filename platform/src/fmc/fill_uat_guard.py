"""Opt-in Operations staging fixture lease and durable, ban-only cleanup.

BanAdmin stays ban-only. An optional private, once-only bootstrap can enroll the
ledger under separate runtime authority; no SQL Auth writes or runtime DDL.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
import re
import time
import uuid

import httpx
from sqlalchemy import text
from starlette.responses import JSONResponse

from .common import DomainError

PROJECT = "yclqnbcrchwieyzkyumx"
ORIGIN = f"https://{PROJECT}.supabase.co"
ORGANIZATIONS = frozenset({"af24d8dd-813f-4919-bd6d-49a6d1169b25",
                           "4484cf28-1947-41dd-9b41-14891ac93752"})
OLD_USERS = frozenset({"b82a8774-839f-4b73-8c4d-5c76c10dd957",
                       "45ef3b07-f811-4e27-b41b-64fe5970d675",
                       "4ff65a8d-3d3b-4fd7-a032-a81fd8f51fce",
                       "c29ba3be-d7ae-4dff-b662-88d1b0504024"})
HEALTH_SECONDS = 45
POLL_SECONDS = 10
MAX_RESPONSE = 4_000_000


def utcnow():
    return datetime.now(timezone.utc)


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Timestamp required")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timezone required")
    return result.astimezone(timezone.utc)


def uid(value):
    if str(uuid.UUID(value)) != value:
        raise ValueError("Canonical UUID required")
    return value


def denied():
    return DomainError("FILL_UAT_CLOSED", "Fictional test access is closed or unavailable.", 403)


@dataclass(frozen=True)
class Principal:
    id: str
    label: str
    ban_at: datetime
    expires_at: datetime


@dataclass(frozen=True)
class Lease:
    run_id: str
    candidate_sha: str
    starts_at: datetime
    expires_at: datetime
    principals: tuple[Principal, ...]
    # A canonical string, rather than a mutable nested configuration object.
    document: str

    @classmethod
    def parse(cls, data):
        if not isinstance(data, dict) or set(data) != {
            "run_id", "candidate_sha", "project_ref", "organization_ids",
            "starts_at", "expires_at", "principals",
        }:
            raise ValueError("Invalid lease")
        run_id = uid(data["run_id"])
        if data["project_ref"] != PROJECT or not re.fullmatch(r"[0-9a-f]{40}", data["candidate_sha"]):
            raise ValueError("Invalid deployment")
        if (not isinstance(data["organization_ids"], list)
                or len(data["organization_ids"]) != 2
                or set(data["organization_ids"]) != ORGANIZATIONS):
            raise ValueError("Fictional organizations required")
        start, end = timestamp(data["starts_at"]), timestamp(data["expires_at"])
        if not timedelta(0) < end - start <= timedelta(minutes=30):
            raise ValueError("Maximum lease is 30 minutes")
        members = data["principals"]
        if not isinstance(members, list) or not 1 <= len(members) <= 3:
            raise ValueError("Maximum three principals")
        principals = []
        for p in members:
            if not isinstance(p, dict) or set(p) != {"id", "label", "ban_at", "expires_at"}:
                raise ValueError("Invalid principal")
            principal = Principal(uid(p["id"]), p["label"], timestamp(p["ban_at"]), timestamp(p["expires_at"]))
            if (principal.id in OLD_USERS or principal.label not in {"a", "b", "canary"}
                    or not start < principal.ban_at < principal.expires_at <= end
                    or principal.expires_at - principal.ban_at < timedelta(seconds=30)):
                raise ValueError("Invalid principal scope")
            if principal.label == "canary" and principal.expires_at - start > timedelta(minutes=3):
                raise ValueError("Canary maximum is three minutes")
            if principal.ban_at - start > timedelta(minutes=2 if principal.label == "canary" else 20):
                raise ValueError("Early ban required")
            principals.append(principal)
        if len({p.id for p in principals}) != len(principals) or len({p.label for p in principals}) != len(principals):
            raise ValueError("Duplicate principal")
        return cls(run_id, data["candidate_sha"], start, end, tuple(principals),
                   json.dumps(data, sort_keys=True, separators=(",", ":")))

    def principal(self, user_id):
        return next((p for p in self.principals if p.id == user_id), None)


class SQLLedger:
    """Only the private guard ledger is writable. No enrolment API exists."""
    def __init__(self, engine):
        self.engine = engine
        self.bootstrap_barrier = False

    def pending(self):
        with self.engine.begin() as c:
            return [dict(r) for r in c.execute(text(
                "select spec, stopped from fill_private.uat_runs where not cleanup_complete"
            )).mappings()]

    def snapshot(self, lease, user_id):
        with self.engine.begin() as c:
            row = c.execute(text("""
                select spec, armed, stopped, healthy_at, receipts,
                       clock_timestamp() as db_now,
                       not exists (
                           select 1 from public.organization_members m
                           where m.user_id=cast(:uid as uuid)
                             and m.organization_id::text not in (:org_a, :org_b)
                       ) as isolated
                from fill_private.uat_runs where run_id=cast(:run as uuid)
            """), {"run": lease.run_id, "uid": user_id, "org_a": sorted(ORGANIZATIONS)[0],
                   "org_b": sorted(ORGANIZATIONS)[1]}).mappings().first()
            return dict(row) if row else None

    def record(self, lease, receipts, healthy):
        # The immutable spec comparison protects against a changed registry.
        with self.engine.begin() as c:
            barrier = (" and not exists (select 1 from fill_private.uat_bootstrap_attempts a "
                       "where a.run_id=cast(:run as uuid) and a.operation='activate' "
                       "and (not a.settled or a.first_ban_readback_at is null))"
                       if self.bootstrap_barrier else "")
            result = c.execute(text("""
                update fill_private.uat_runs
                set receipts=cast(:receipts as jsonb),
                    healthy_at=case when :healthy then clock_timestamp() else null end,
                    cleanup_complete=(:complete""" + barrier + """), attempts=attempts+1
                where run_id=cast(:run as uuid) and spec=cast(:spec as jsonb)
            """), {"run": lease.run_id, "spec": lease.document,
                   "receipts": json.dumps(receipts), "healthy": healthy,
                   "complete": all(receipts.get(p.id) is True for p in lease.principals)})
            if result.rowcount != 1:
                raise RuntimeError("Ledger changed")


class BanAdmin:
    """Pinned supported Auth Admin GET / PUT only; never activate or delete."""
    def __init__(self, key, transport=None):
        if not key or not key.strip():
            raise ValueError("Guard Admin key required")
        self.http = httpx.Client(base_url=ORIGIN + "/auth/v1/", timeout=5,
                                 follow_redirects=False, trust_env=False, transport=transport,
                                 headers={"apikey": key, "Authorization": "Bearer " + key})
        self.settlement = None

    def owned(self, lease, principal):
        # Defence in depth even when called without Guard.sweep().
        if principal.id in OLD_USERS or lease.principal(principal.id) != principal:
            raise ValueError("Foreign principal")
        response = self.http.get("admin/users/" + principal.id)
        if response.status_code != 200:
            raise ValueError("Unverified identity")
        data = response.json()
        metadata = data.get("app_metadata")
        if (data.get("id") != principal.id or data.get("role") != "authenticated"
                or not isinstance(metadata, dict) or metadata.get("fill_f1_run") != lease.run_id
                or metadata.get("fictional") is not True
                or not lease.starts_at <= timestamp(data["created_at"]) < lease.expires_at):
            raise ValueError("Unverified fixture ownership")
        return data

    def inspect(self, lease, principal, *, ban):
        data = self.owned(lease, principal)
        newly_settled = self.settlement.observe(lease, principal, data) if self.settlement else False
        if not ban:
            return False
        if not newly_settled and data.get("banned_until") and timestamp(data["banned_until"]) > utcnow() + timedelta(days=365):
            if self.settlement:
                self.settlement.ban_proof(lease, principal, data)
            return True
        response = self.http.put("admin/users/" + principal.id, json={"ban_duration": "876000h"})
        if response.status_code != 200:
            raise ValueError("Ban unverified")
        data = self.owned(lease, principal)
        if timestamp(data["banned_until"]) <= utcnow() + timedelta(days=365):
            raise ValueError("Ban readback unverified")
        if self.settlement:
            self.settlement.ban_proof(lease, principal, data)
        return True

    def close(self):
        self.http.close()


class Guard:
    def __init__(self, lease=None, ledger=None, admin=None, *, clock=utcnow, monotonic=time.monotonic):
        self.lease, self.ledger, self.admin = lease, ledger, admin
        self.clock, self.monotonic = clock, monotonic
        self.anchor_wall, self.anchor_tick = clock(), monotonic()
        self.cleanup_error = False
        self.bootstrap = None

    def now(self):
        wall = self.clock()
        elapsed = self.monotonic() - self.anchor_tick
        if elapsed < 0 or abs((wall - self.anchor_wall).total_seconds() - elapsed) > 2:
            raise denied()
        return wall

    def is_fixture(self, actor):
        return (actor.id in OLD_USERS or actor.fill_f1_run is not None or actor.fill_f1_fictional
                or bool(self.lease and self.lease.principal(actor.id)))

    def check(self, actor, method="GET"):
        if not self.is_fixture(actor):
            return
        try:
            lease = self.lease
            principal = lease.principal(actor.id) if lease else None
            if (not principal or actor.id in OLD_USERS or actor.fill_f1_run != lease.run_id
                    or not actor.fill_f1_fictional or method not in {"GET", "HEAD"}):
                raise denied()
            now = self.now()
            if not lease.starts_at <= now < principal.expires_at or self.cleanup_error:
                raise denied()
            row = self.ledger.snapshot(lease, actor.id)
            # The registry query may itself have stalled beyond the cutoff.
            now = self.now()
            if (not row or Lease.parse(row["spec"]) != lease or not row["armed"]
                    or row["stopped"] or not row["isolated"]
                    or row["receipts"].get(actor.id) is True or row["healthy_at"] is None
                    or not 0 <= (now - row["healthy_at"]).total_seconds() <= HEALTH_SECONDS
                    or abs((now - row["db_now"]).total_seconds()) > 2
                    or now >= principal.expires_at or self.cleanup_error):
                raise denied()
        except DomainError:
            raise
        except Exception:
            # No upstream body, SQL, account details or secrets in responses.
            raise denied() from None

    def sweep(self):
        """Persist pending failures; restart always rereads original deadlines.

        Bounded ten-second retries, no creation/unban, no deadline renewal.
        A whole-service or Auth outage may delay an actual ban; API expiry is
        independent of this worker, as long as Operations can serve a request.
        """
        self.cleanup_error = True
        try:
            healthy_all = True
            for row in self.ledger.pending():
                lease = Lease.parse(row["spec"])
                receipts, healthy = {}, True
                for principal in lease.principals:
                    try:
                        receipts[principal.id] = self.admin.inspect(
                            lease, principal, ban=row["stopped"] or self.now() >= principal.ban_at)
                    except Exception:
                        receipts[principal.id] = False
                        healthy = False
                self.ledger.record(lease, receipts, healthy)
                healthy_all = healthy_all and healthy
            self.cleanup_error = not healthy_all
        except Exception:
            # The durable pending row survives. Never log an exception that may
            # contain a credential-bearing HTTP request or connection URL.
            self.cleanup_error = True

    @asynccontextmanager
    async def lifespan(self, app):
        if self.lease is None and self.bootstrap is None:
            yield
            return
        # Start before accepting traffic, including after crash/restart.
        await asyncio.to_thread(self.sweep)
        stop = asyncio.Event()

        async def run():
            pending = None
            due = time.monotonic() + POLL_SECONDS
            try:
                while not stop.is_set():
                    try:
                        await asyncio.wait_for(stop.wait(), timeout=1 if self.bootstrap else POLL_SECONDS)
                    except TimeoutError:
                        if not self.bootstrap or time.monotonic() >= due:
                            # Bootstrap HTTP never blocks this existing cleanup cadence.
                            await asyncio.to_thread(self.sweep)
                            due = time.monotonic() + POLL_SECONDS
                        if self.bootstrap and (pending is None or pending.done()):
                            if pending is not None:
                                pending.result()  # tick contains sanitized, fail-closed handling.
                            pending = asyncio.create_task(asyncio.to_thread(self.bootstrap.tick))
            finally:
                if pending is not None:
                    await pending

        worker = asyncio.create_task(run())
        try:
            yield
        finally:
            stop.set()
            # Let an in-flight bounded Admin request finish before closing its
            # client. A hard kill instead recovers from the durable pending row.
            await worker
            self.admin.close()


def from_environment(settings, service, engine):
    mode = os.environ.get("FILL_UAT_GUARD", "off")
    bootstrap_mode = os.environ.get("FILL_UAT_BOOTSTRAP", "off")
    if mode == "off" and bootstrap_mode == "off":
        return Guard()
    if mode != "on" or service != "operations" or settings.environment != "staging" or settings.supabase_url.rstrip("/") != ORIGIN:
        raise RuntimeError("Fill guard requires pinned Operations staging")
    try:
        if bootstrap_mode == "on":
            from .fill_uat_bootstrap import Bootstrap, FixtureAdmin, Journal, Plan, TARGET
            if "FILL_UAT_LEASE" in os.environ or any(os.environ.get(k) != v for k, v in TARGET.items()):
                raise ValueError("Bootstrap target mismatch")
            plan = Plan.parse(json.loads(os.environ["FILL_UAT_BOOTSTRAP_INPUT"]))
            if os.environ.get("RAILWAY_GIT_COMMIT_SHA") != plan.candidate_sha:
                raise ValueError("Candidate mismatch")
            deployment = uid(os.environ["RAILWAY_DEPLOYMENT_ID"])
            admin = BanAdmin(os.environ["FILL_UAT_ADMIN_KEY"])
            guard = Guard(None, SQLLedger(engine), admin)
            guard.bootstrap = Bootstrap(plan, Journal(engine, deployment=deployment), FixtureAdmin(admin), guard)
            guard.ledger.bootstrap_barrier = True
            admin.settlement = guard.bootstrap.journal
            return guard
        if bootstrap_mode != "off":
            raise ValueError("Invalid bootstrap mode")
        lease = Lease.parse(json.loads(os.environ["FILL_UAT_LEASE"]))
        if os.environ.get("RAILWAY_GIT_COMMIT_SHA") != lease.candidate_sha:
            raise ValueError("Candidate mismatch")
        admin = BanAdmin(os.environ["FILL_UAT_ADMIN_KEY"])
    except Exception:
        raise RuntimeError("Fill guard configuration invalid") from None
    return Guard(lease, SQLLedger(engine), admin)


class DeliveryGuard:
    """Buffer fixture replies until final authorization, before any bytes leave.

    Normal traffic is streamed unchanged. Fixture streaming/oversize responses
    are not supported. Rechecking only at response headers would leak late data.
    """
    def __init__(self, app, guard, auth):
        self.app, self.guard, self.auth = app, guard, auth

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        buffered, size = [], 0

        async def guarded_send(message):
            nonlocal size
            actor = scope.get("state", {}).get("fill_f1_actor")
            if actor is None or not self.guard.is_fixture(actor):
                return await send(message)
            size += len(message.get("body", b""))
            if size <= MAX_RESPONSE:
                buffered.append(message)
            if message["type"] != "http.response.body" or message.get("more_body", False):
                return
            try:
                token = dict(scope["headers"]).get(b"authorization", b"").decode("latin-1")
                current = await asyncio.to_thread(self.auth.verify, token)
                if current != actor or size > MAX_RESPONSE:
                    raise denied()
                await asyncio.to_thread(self.guard.check, current, scope["method"])
            except Exception:
                buffered.clear()
                response = JSONResponse({"error": "FILL_UAT_CLOSED",
                                         "message": "Fictional test access is closed or unavailable."},
                                        status_code=403, headers={"Cache-Control": "no-store",
                                            "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                                            "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex,nofollow"})
                await response(scope, receive, send)
                return
            for item in buffered:
                await send(item)
            buffered.clear()

        await self.app(scope, receive, guarded_send)
