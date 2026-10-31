"""Private, opt-in, once-only fictional bootstrap. No route or booking writes.

An external operator prepares/releases the intent and records the CTO verdict.
Credentials are private planned input; neither credentials nor upstream errors
are written to the journal. DB/Auth are not atomic: a lost POST consumes its
slot permanently, including a crash after reservation but before transmission.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import timedelta
import hashlib
import json
import re
import uuid

from sqlalchemy import text

from . import fill_uat_guard as g

LABELS = ("canary", "a", "b")
TARGET = {"RAILWAY_PROJECT_ID": "cbb85d2f-a9ec-4027-ac29-87bd70d31a65",
          "RAILWAY_ENVIRONMENT_ID": "16cadc45-b582-47ad-a071-d7bf4b40f450",
          "RAILWAY_SERVICE_ID": "c0c6e5e2-0040-48e0-a0af-abfb1ec81b61"}


class Closed(RuntimeError):
    def __init__(self):
        super().__init__("FILL_BOOTSTRAP_CLOSED")


@dataclass(frozen=True)
class Plan:
    run_id: str
    authorization_id: str
    candidate_sha: str
    passwords: dict = field(repr=False, compare=False)
    digest: str

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) != {
            "run_id", "authorization_id", "candidate_sha", "passwords"
        }:
            raise Closed()
        try:
            run, authorization = g.uid(value["run_id"]), g.uid(value["authorization_id"])
            passwords = value["passwords"]
            if (not isinstance(value["candidate_sha"], str)
                    or not re.fullmatch("[0-9a-f]{40}", value["candidate_sha"])
                    or not isinstance(passwords, dict) or set(passwords) != set(LABELS)
                    or any(not isinstance(p, str) or not 40 <= len(p) <= 256 for p in passwords.values())
                    or len(set(passwords.values())) != 3):
                raise Closed()
            digest = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            return cls(run, authorization, value["candidate_sha"], dict(passwords), digest)
        except Exception:
            raise Closed() from None

    def email(self, label):
        if label not in LABELS:
            raise Closed()
        return f"fill-f1-{self.run_id}-{label}@example.invalid"


def lease_for(plan, start, attempts):
    principals = [{"id": a["user_id"], "label": a["label"],
                   "ban_at": (start + timedelta(seconds=120 if a["label"] == "canary" else 1200)).isoformat(),
                   "expires_at": (start + timedelta(seconds=180 if a["label"] == "canary" else 1800)).isoformat()}
                  for a in attempts if a["operation"] == "create" and a["user_id"]]
    return g.Lease.parse({"run_id": plan.run_id, "candidate_sha": plan.candidate_sha,
                          "project_ref": g.PROJECT, "organization_ids": sorted(g.ORGANIZATIONS),
                          "starts_at": start.isoformat(), "expires_at": (start + timedelta(minutes=30)).isoformat(),
                          "principals": principals})


class Journal:
    def __init__(self, engine, *, deployment=None):
        self.engine, self.deployment = engine, deployment

    @contextmanager
    def tx(self):
        with self.engine.begin() as c:
            c.execute(text("set local statement_timeout='2000ms'"))
            c.execute(text("set local lock_timeout='500ms'"))
            yield c

    def row(self, c, plan, *, lock=False):
        row = c.execute(text("select *,clock_timestamp() as db_now from fill_private.uat_bootstrap_intents "
                             "where run_id=cast(:run as uuid)" + (" for update" if lock else "")),
                        {"run": plan.run_id}).mappings().first()
        if not row:
            return None
        if (str(row["authorization_id"]) != plan.authorization_id
                or row["candidate_sha"] != plan.candidate_sha or row["project_ref"] != g.PROJECT
                or (self.deployment is not None and str(row["deployment_id"]) != self.deployment)
                or row["organization_ids"] != sorted(g.ORGANIZATIONS) or row["input_digest"] != plan.digest):
            raise Closed()
        return dict(row)

    def read(self, plan):
        with self.tx() as c:
            row = self.row(c, plan)
            if not row:
                return None
            row["attempts"] = [dict(a, user_id=str(a["user_id"]) if a["user_id"] else None)
                               for a in c.execute(text("select * from fill_private.uat_bootstrap_attempts "
                                                       "where run_id=cast(:run as uuid) order by label,operation"),
                                                  {"run": plan.run_id}).mappings()]
            row["lease_digest"] = c.execute(text("select encode(sha256(convert_to(spec::text,'UTF8')),'hex') "
                                                "from fill_private.uat_runs where run_id=cast(:run as uuid)"),
                                           {"run": plan.run_id}).scalar_one_or_none()
            return row

    def preflight(self, plan, executor):
        with self.tx() as c:
            row = self.row(c, plan, lock=True)
            if (not row or row["stopped"] or row["starts_at"] or row["released_at"]
                    or row["db_now"] >= row["request_expires_at"]):
                raise Closed()
            count = c.execute(text("select count(*) from public.organizations where id::text in (:a,:b)"),
                              dict(zip(("a", "b"), sorted(g.ORGANIZATIONS)))).scalar_one()
            # Query both ledgers before T0, without enrolling or changing Auth.
            c.execute(text("select run_id from fill_private.uat_runs limit 0"))
            c.execute(text("select run_id from fill_private.uat_bootstrap_attempts limit 0"))
            if count != 2:
                raise Closed()
            for table, privileges in {
                "fill_private.uat_runs": ("SELECT", "INSERT", "UPDATE"),
                "fill_private.uat_bootstrap_intents": ("SELECT", "UPDATE"),
                "fill_private.uat_bootstrap_attempts": ("SELECT", "INSERT", "UPDATE"),
                "public.organization_members": ("SELECT", "INSERT"),
            }.items():
                for privilege in privileges:
                    if not c.execute(text("select has_table_privilege(current_user,:table,:privilege) "
                                          "and not row_security_active(cast(:table as regclass))"),
                                     {"table": table, "privilege": privilege}).scalar_one():
                        raise Closed()
            c.execute(text("update fill_private.uat_bootstrap_intents set preflight_at=clock_timestamp(), "
                           "preflight_executor=cast(:executor as uuid) where run_id=cast(:run as uuid)"),
                      {"run": plan.run_id, "executor": executor})

    def invalidate_preflight(self, plan):
        with self.tx() as c:
            c.execute(text("update fill_private.uat_bootstrap_intents set preflight_at=null,preflight_executor=null "
                           "where run_id=cast(:run as uuid) and starts_at is null and released_at is null"),
                      {"run": plan.run_id})

    def claim(self, plan, executor):
        with self.tx() as c:
            row = self.row(c, plan, lock=True)
            if not row or row["starts_at"] or row["stopped"] or not row["released_at"]:
                return False
            if str(row["preflight_executor"]) != executor:
                return False
            c.execute(text("update fill_private.uat_bootstrap_intents set starts_at=clock_timestamp(), "
                           "executor=cast(:executor as uuid) where run_id=cast(:run as uuid)"),
                      {"run": plan.run_id, "executor": executor})
            return True

    def reserve(self, plan, executor, label, operation):
        with self.tx() as c:
            row = self.row(c, plan, lock=True)
            if (not row or not row["starts_at"] or row["stopped"] or str(row["executor"]) != executor):
                raise Closed()
            # Unique slots + SQL trigger enforce global per-authority budget,
            # immutable time limits, armed health and external verdict again.
            return str(c.execute(text("insert into fill_private.uat_bootstrap_attempts(run_id,label,operation) "
                                      "values(cast(:run as uuid),:label,:operation) returning activation_nonce"),
                                 {"run": plan.run_id, "label": label, "operation": operation}).scalar_one())

    def observe(self, lease, principal, data):
        # Unique nonce + unban are in the SAME supported Auth Admin update.
        # Only a subsequent canonical GET can settle a possibly late PUT.
        nonce = data.get("app_metadata", {}).get("fill_f1_activation_nonce")
        if not isinstance(nonce, str):
            return False
        with self.tx() as c:
            result = c.execute(text("update fill_private.uat_bootstrap_attempts set settled=true "
                "where run_id=cast(:run as uuid) and label=:label and operation='activate' "
                "and activation_nonce::text=:nonce and not settled returning label"),
                {"run": lease.run_id, "label": principal.label, "nonce": nonce})
            return result.first() is not None

    def ban_proof(self, lease, principal, data):
        nonce = data.get("app_metadata", {}).get("fill_f1_activation_nonce")
        if not isinstance(nonce, str):
            return
        with self.tx() as c:
            c.execute(text("update fill_private.uat_bootstrap_attempts set first_ban_readback_at=clock_timestamp() "
                           "where run_id=cast(:run as uuid) and label=:label and operation='activate' and settled "
                           "and activation_nonce::text=:nonce and first_ban_readback_at is null"),
                      {"run": lease.run_id, "label": principal.label, "nonce": nonce})

    def record(self, plan, executor, label, operation, user_id, *, verified=False):
        with self.tx() as c:
            row = self.row(c, plan, lock=True)
            if not row or str(row["executor"]) != executor:
                raise Closed()
            result = c.execute(text("update fill_private.uat_bootstrap_attempts "
                                    "set user_id=cast(:uid as uuid),verified=:verified "
                                    "where run_id=cast(:run as uuid) and label=:label and operation=:operation"),
                               {"run": plan.run_id, "uid": user_id, "label": label,
                                "operation": operation, "verified": verified})
            if result.rowcount != 1:
                raise Closed()

    def stop(self, plan, *, reconcile):
        with self.tx() as c:
            if not self.row(c, plan, lock=True):
                return
            c.execute(text("update fill_private.uat_bootstrap_intents set stopped=true, "
                           "reconciliation_required=reconciliation_required or :reconcile where run_id=cast(:run as uuid)"),
                      {"run": plan.run_id, "reconcile": reconcile})
            c.execute(text("update fill_private.uat_runs set stopped=true where run_id=cast(:run as uuid)"),
                      {"run": plan.run_id})

    def hydrate(self, plan):
        with self.tx() as c:
            self.row(c, plan)
            spec = c.execute(text("select spec from fill_private.uat_runs where run_id=cast(:run as uuid)"),
                             {"run": plan.run_id}).scalar_one_or_none()
            if spec is None:
                return None
            lease = g.Lease.parse(spec)
            if lease.candidate_sha != plan.candidate_sha:
                raise Closed()
            return lease

    def enroll(self, plan, lease, *, stopped):
        with self.tx() as c:
            row = self.row(c, plan, lock=True)
            if not row or row["starts_at"] != lease.starts_at:
                raise Closed()
            present = c.execute(text("select spec from fill_private.uat_runs where run_id=cast(:run as uuid)"),
                                {"run": plan.run_id}).scalar_one_or_none()
            if present is not None:
                if g.Lease.parse(present) != lease:
                    raise Closed()
            else:
                c.execute(text("insert into fill_private.uat_runs(run_id,spec) values(cast(:run as uuid),cast(:spec as jsonb))"),
                          {"run": plan.run_id, "spec": lease.document})
            c.execute(text("update fill_private.uat_runs set armed=true,stopped=stopped or :stop "
                           "where run_id=cast(:run as uuid)"), {"run": plan.run_id, "stop": stopped or row["stopped"]})

    def members(self, plan, lease):
        with self.tx() as c:
            row = self.row(c, plan, lock=True)
            if not row or row["stopped"] or row["db_now"] >= lease.starts_at + timedelta(seconds=60):
                raise Closed()
            org_a, org_b = "af24d8dd-813f-4919-bd6d-49a6d1169b25", "4484cf28-1947-41dd-9b41-14891ac93752"
            for p in lease.principals:
                if p.id in g.OLD_USERS:
                    raise Closed()
                existing = c.execute(text("select organization_id::text,role::text from public.organization_members "
                                          "where user_id=cast(:uid as uuid)"), {"uid": p.id}).all()
                org, role = (org_b, "manager") if p.label == "b" else (org_a, "owner")
                if existing:
                    raise Closed()  # New identities must have no preexisting membership.
                c.execute(text("insert into public.organization_members(organization_id,user_id,role) "
                               "values(cast(:org as uuid),cast(:uid as uuid),cast(:role as public.fmc_member_role))"),
                          {"org": org, "uid": p.id, "role": role})


class FixtureAdmin:
    """Create/unban only NEW intent identities. BanAdmin remains ban-only."""
    def __init__(self, ban_admin):
        self.http = ban_admin.http

    def preflight(self):
        # One explicitly known, blocked historical fixture: GET only, never list.
        user_id = sorted(g.OLD_USERS)[0]
        response = self.http.get("admin/users/" + user_id)
        if response.status_code != 200:
            raise Closed()
        data = response.json()
        if (data.get("id") != user_id or data.get("role") != "authenticated"
                or g.timestamp(data.get("banned_until")) <= g.utcnow() + timedelta(days=365)):
            raise Closed()

    @staticmethod
    def owned(data, plan, label, start, now, *, user_id=None, banned=True):
        identity = g.uid(data["id"])
        if (identity in g.OLD_USERS or (user_id is not None and identity != user_id)
                or data.get("email") != plan.email(label) or data.get("role") != "authenticated"
                or data.get("app_metadata", {}).get("fill_f1_run") != plan.run_id
                or data.get("app_metadata", {}).get("fictional") is not True
                or not start <= g.timestamp(data["created_at"]) <= now < start + timedelta(minutes=30)
                or not data.get("email_confirmed_at")):
            raise Closed()
        until = data.get("banned_until")
        if banned:
            if not until or g.timestamp(until) <= now + timedelta(days=365):
                raise Closed()
        elif until is not None and g.timestamp(until) > now:
            raise Closed()
        return identity

    def create(self, plan, label):
        response = self.http.post("admin/users", json={"email": plan.email(label),
            "password": plan.passwords[label], "email_confirm": True, "ban_duration": "876000h",
            "app_metadata": {"fill_f1_run": plan.run_id, "fictional": True}})
        if response.status_code not in (200, 201):
            raise Closed()
        return response.json()

    def read(self, user_id):
        if user_id in g.OLD_USERS:
            raise Closed()
        response = self.http.get("admin/users/" + g.uid(user_id))
        if response.status_code != 200:
            raise Closed()
        return response.json()

    def activate(self, user_id, plan, nonce):
        if user_id in g.OLD_USERS:
            raise Closed()
        response = self.http.put("admin/users/" + g.uid(user_id), json={"ban_duration": "none",
            "app_metadata": {"fill_f1_run": plan.run_id, "fictional": True,
                             "fill_f1_activation_nonce": g.uid(nonce)}})
        if response.status_code != 200:
            raise Closed()


class Bootstrap:
    def __init__(self, plan, journal, admin, guard, *, executor=None):
        self.plan, self.journal, self.admin, self.guard = plan, journal, admin, guard
        self.executor = executor or str(uuid.uuid4())

    def fresh(self, *, seconds):
        row = self.journal.read(self.plan)
        now = self.guard.now()
        if (not row or row["stopped"] or not row["starts_at"] or str(row["executor"]) != self.executor
                or abs((now-row["db_now"]).total_seconds()) > 2
                or not row["starts_at"] <= now < row["starts_at"] + timedelta(seconds=seconds)):
            raise Closed()
        return row, now

    def recover(self):
        row = self.journal.read(self.plan)
        if not row or not row["starts_at"]:
            return
        existing = self.journal.hydrate(self.plan)
        known = [a for a in row["attempts"] if a["operation"] == "create" and a["user_id"]]
        if existing is None and known:
            existing = lease_for(self.plan, row["starts_at"], known)
            self.journal.enroll(self.plan, existing, stopped=True)
        if existing:
            self.guard.lease = existing

    def fail(self):
        # No exception details escape. If DB is unavailable, the journal's
        # reserved slot still prevents POST replay after restart.
        self.guard.cleanup_error = True
        try:
            row = self.journal.read(self.plan)
            if row is not None and row["starts_at"] is None and row["released_at"] is None:
                # Read-only preflight may retry; it never consumes an account
                # slot or T0. Never retain a known-failed readiness stamp.
                self.journal.invalidate_preflight(self.plan)
                return
            self.journal.stop(self.plan, reconcile=True)
            self.recover()
        except Exception:
            pass

    def tick(self):
        try:
            self.step()
        except Exception:
            self.fail()

    def step(self):
        row = self.journal.read(self.plan)
        if row is None:
            return  # No intent, no Auth calls, no T0.
        if abs((self.guard.now()-row["db_now"]).total_seconds()) > 2:
            raise Closed()
        if row["stopped"]:
            self.recover()
            return
        if row["starts_at"] is None:
            if row["released_at"] is None:
                if (row["preflight_at"] is None or str(row["preflight_executor"]) != self.executor
                        or (row["db_now"]-row["preflight_at"]).total_seconds() >= 20):
                    self.admin.preflight()
                    self.journal.preflight(self.plan, self.executor)
                return
            self.journal.claim(self.plan, self.executor)
            return
        existing = self.journal.hydrate(self.plan)
        if existing:
            self.guard.lease = existing
        if str(row["executor"]) != self.executor:
            # Observer/restart never takes over a consumed create/unban slot.
            if existing is None and row["db_now"] >= row["starts_at"]+timedelta(seconds=60):
                self.journal.stop(self.plan, reconcile=True)
                self.recover()
            return
        creates = {a["label"]: a for a in row["attempts"] if a["operation"] == "create"}
        for label in LABELS:
            if label in creates:
                if not creates[label]["verified"]:
                    raise Closed()
                continue
            row, now = self.fresh(seconds=60)
            self.journal.reserve(self.plan, self.executor, label, "create")
            data = self.admin.create(self.plan, label)
            now = self.guard.now()
            user_id = self.admin.owned(data, self.plan, label, row["starts_at"], now)
            self.journal.record(self.plan, self.executor, label, "create", user_id)
            data = self.admin.read(user_id)
            self.admin.owned(data, self.plan, label, row["starts_at"], self.guard.now(), user_id=user_id)
            self.fresh(seconds=60)
            self.journal.record(self.plan, self.executor, label, "create", user_id, verified=True)
            return
        if existing is None:
            row, _ = self.fresh(seconds=60)
            lease = lease_for(self.plan, row["starts_at"], row["attempts"])
            self.journal.members(self.plan, lease)
            self.journal.enroll(self.plan, lease, stopped=False)
            self.guard.lease = lease
            return
        activations = {a["label"]: a for a in row["attempts"] if a["operation"] == "activate"}
        if any(not a["verified"] for a in activations.values()):
            raise Closed()
        if "canary" in activations:
            cutoff = row["starts_at"] + timedelta(seconds=180)
            first = activations["canary"].get("first_ban_readback_at")
            if row["db_now"] > cutoff and (first is None or first > cutoff):
                raise Closed()
        for label in LABELS:
            if label in activations:
                continue
            if label != "canary":
                if row["verdict"] is None:
                    if row["db_now"] >= row["starts_at"]+timedelta(minutes=10):
                        raise Closed()
                    return
                verdict = row["verdict"]
                if (verdict.get("decision") != "pass" or verdict.get("run_id") != self.plan.run_id
                        or verdict.get("candidate_sha") != self.plan.candidate_sha
                        or not row["lease_digest"] or verdict.get("lease_digest") != row["lease_digest"]
                        or any(verdict.get(k) is not True for k in ("positive_get", "denied_login", "denied_api"))):
                    raise Closed()
                canary = existing.principal(creates["canary"]["user_id"])
                snap = self.guard.ledger.snapshot(existing, canary.id)
                first_ban = activations["canary"].get("first_ban_readback_at")
                if (row["verdict_at"] is None or row["verdict_at"] < canary.expires_at
                        or row["verdict_at"] > self.guard.now() or not snap or not snap["receipts"].get(canary.id)
                        or first_ban is None or not row["starts_at"] <= first_ban <= canary.expires_at
                        or self.guard.now() < canary.expires_at):
                    raise Closed()
            row, now = self.fresh(seconds=60 if label == "canary" else 600)
            principal = existing.principal(creates[label]["user_id"])
            snapshot = self.guard.ledger.snapshot(existing, principal.id)
            if (self.guard.cleanup_error or (snapshot and (snapshot["healthy_at"] is None
                    or (now-snapshot["healthy_at"]).total_seconds() > g.HEALTH_SECONDS))):
                # The sole cleanup cadence must inspect a newly enrolled lease
                # first. Do not turn that normal startup wait into an unban or
                # a failed run, and never run a second sweep from bootstrap.
                return
            from .supabase_v1 import Actor
            self.guard.check(Actor(principal.id, self.plan.email(label), self.plan.run_id, True))
            self.admin.owned(self.admin.read(principal.id), self.plan, label, row["starts_at"], now,
                             user_id=principal.id)
            self.fresh(seconds=60 if label == "canary" else 600)
            nonce = self.journal.reserve(self.plan, self.executor, label, "activate")
            self.admin.activate(principal.id, self.plan, nonce)
            data = self.admin.read(principal.id)
            if data.get("app_metadata", {}).get("fill_f1_activation_nonce") != nonce:
                raise Closed()
            self.admin.owned(data, self.plan, label, row["starts_at"], self.guard.now(),
                             user_id=principal.id, banned=False)
            self.fresh(seconds=60 if label == "canary" else 600)
            self.journal.record(self.plan, self.executor, label, "activate", principal.id, verified=True)
            return
