"""Supabase-v1 background workers.

Provider sync is read-only toward external systems. It may project authorized
external data into FmC shadow records, never mutate the external provider.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import threading
import time

from sqlalchemy import text

from .common import DomainError
from .playtomic import Deferred, Playtomic
from .supabase_v1 import V1Store, one, rows


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _health_server(db: V1Store):
    class Health(BaseHTTPRequestHandler):
        def log_message(self, *_):
            return
        def do_GET(self):
            if self.path == "/health/live":
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
                return
            if self.path == "/health/ready":
                try:
                    db.ping()
                    self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
                except Exception:
                    self.send_response(503); self.end_headers(); self.wfile.write(b'{"ok":false}')
                return
            self.send_response(404); self.end_headers()
    server = ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT","8000"))), Health)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _credential(connection):
    cfg = connection.get("config") or {}
    ref = str(cfg.get("credential_ref") or "").strip().upper()
    if not ref or not ref.replace("_","").isalnum():
        raise DomainError("PROVIDER_CONFIG", "Provider credential_ref is not configured.", 503)
    tenant = str(cfg.get("tenant_id") or "").strip()
    client_id = os.getenv(f"{ref}_CLIENT_ID","")
    secret = os.getenv(f"{ref}_CLIENT_SECRET","")
    bound_org = os.getenv(f"{ref}_FMC_ORG_ID","")
    bound_tenant = os.getenv(f"{ref}_TENANT_ID","")
    if bound_org != connection["organization_id"] or bound_tenant != tenant:
        raise DomainError("PROVIDER_BINDING", "Provider credential binding is invalid.", 503)
    return client_id, secret, tenant


def _connection(db: V1Store, connection_id: str):
    with db.trusted() as c:
        r = one(c.execute(text("""
            select id::text,organization_id::text,provider,status,capabilities,config
            from public.provider_connections where id=cast(:id as uuid)
        """), {"id": connection_id}))
        if not r or r["status"] != "configured":
            raise DomainError("PROVIDER_NOT_CONFIGURED", "Provider connection is not configured.", 409)
        return r


def _mapping(db: V1Store, c, connection_id: str, external_court: str):
    return one(c.execute(text("""
        select pm.local_id::text as court_id,v.id::text as venue_id,v.organization_id::text
        from public.provider_mappings pm
        join public.courts ct on ct.id=pm.local_id
        join public.venues v on v.id=ct.venue_id
        where pm.provider_connection_id=cast(:pc as uuid)
          and pm.entity_type='court' and pm.external_id=:external
    """), {"pc": connection_id, "external": external_court}))


def _observe(c, org: str, pc: str, stream: str, record: dict, complete=True):
    external = str(record.get("external_id") or record.get("payment_id") or "")
    payload = _json(record)
    fp = hashlib.sha256(payload.encode()).hexdigest()
    c.execute(text("""
        insert into public.provider_observations
          (organization_id,provider_connection_id,stream,external_id,fingerprint,complete,payload)
        values(cast(:org as uuid),cast(:pc as uuid),:stream,nullif(:external,''),:fp,:complete,cast(:payload as jsonb))
        on conflict(provider_connection_id,stream,fingerprint) do nothing
    """), {"org": org, "pc": pc, "stream": stream, "external": external,
           "fp": fp, "complete": complete, "payload": payload})


def _sync_playtomic(db: V1Store, job: dict):
    payload = job["payload"] or {}
    pc_id = payload.get("provider_connection_id")
    stream = payload.get("stream")
    connection = _connection(db, pc_id)
    if connection["provider"] != "playtomic":
        raise DomainError("PROVIDER", "Unsupported provider.", 422)
    client_id, secret, tenant = _credential(connection)
    api = Playtomic(client_id, secret, tenant)
    now = datetime.now(timezone.utc)
    start = payload.get("window_start") or (now - timedelta(days=30)).isoformat()
    end = payload.get("window_end") or (now + (timedelta(days=90) if stream=="bookings" else timedelta())).isoformat()
    cursor = None
    page = 0
    total = 0
    max_pages = 200
    while True:
        if page >= max_pages:
            raise DomainError("PROVIDER_PAGINATION", "Provider pagination exceeded safety limit.", 502)
        response = api.page(stream, start, end, cursor=cursor, page=page)
        records = response["records"]
        with db.trusted() as c:
            for rec in records:
                _observe(c, connection["organization_id"], pc_id, stream, rec, complete=True)
                if stream == "players":
                    consent = rec.get("consent")
                    marketing = True if consent == "granted" else None
                    c.execute(text("""
                        insert into public.people
                          (organization_id,external_key,full_name,email,phone,marketing_consent,source,source_updated_at)
                        values(cast(:org as uuid),:external,:name,nullif(:email,''),nullif(:phone,''),:consent,'playtomic',now())
                        on conflict(organization_id,source,external_key) do update set
                          full_name=excluded.full_name,email=excluded.email,phone=excluded.phone,
                          marketing_consent=excluded.marketing_consent,source_updated_at=now(),updated_at=now()
                    """), {"org": connection["organization_id"], "external": rec["external_id"],
                           "name": rec.get("name"), "email": rec.get("email",""),
                           "phone": rec.get("phone",""), "consent": marketing})
                elif stream == "payments":
                    amount = int(rec.get("gross_minor") or rec.get("net_minor") or 0)
                    kind = "refund" if rec.get("status") == "REFUNDED" else "capture"
                    c.execute(text("""
                        insert into public.payments
                          (organization_id,provider,external_reference,kind,status,currency,amount_minor,
                           fee_minor,payout_reference,occurred_at,metadata)
                        values(cast(:org as uuid),'playtomic',:external,:kind,:status,:currency,:amount,:fee,:payout,now(),cast(:metadata as jsonb))
                        on conflict(organization_id,provider,external_reference,kind) do update set
                          status=excluded.status,amount_minor=excluded.amount_minor,fee_minor=excluded.fee_minor,
                          payout_reference=excluded.payout_reference,metadata=excluded.metadata
                    """), {"org": connection["organization_id"], "external": rec.get("external_id"),
                           "kind": kind, "status": rec.get("status") or "UNKNOWN",
                           "currency": rec.get("currency") or "EUR", "amount": amount,
                           "fee": rec.get("fee_minor"), "payout": rec.get("payout_id"),
                           "metadata": _json(rec)})
                elif stream == "bookings":
                    mapping = _mapping(db, c, pc_id, rec["court_external_id"])
                    if mapping:
                        status = rec.get("status")
                        if status not in ("confirmed","cancelled","completed","no_show"):
                            status = "confirmed"
                        c.execute(text("""
                            insert into public.bookings
                              (organization_id,venue_id,court_id,status,starts_at,ends_at,currency,
                               gross_amount_minor,source,external_reference,metadata)
                            values(cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),cast(:status as public.fmc_booking_status),
                                   :starts,:ends,:currency,:amount,'playtomic',:external,cast(:metadata as jsonb))
                            on conflict(organization_id,source,external_reference) where external_reference is not null
                            do update set court_id=excluded.court_id,venue_id=excluded.venue_id,status=excluded.status,
                              starts_at=excluded.starts_at,ends_at=excluded.ends_at,currency=excluded.currency,
                              gross_amount_minor=excluded.gross_amount_minor,metadata=excluded.metadata,updated_at=now()
                        """), {"org": connection["organization_id"], "venue": mapping["venue_id"],
                               "court": mapping["court_id"], "status": status,
                               "starts": rec["starts_at"], "ends": rec["ends_at"],
                               "currency": rec["currency"], "amount": rec["total_minor"],
                               "external": rec["external_id"], "metadata": _json({"provider":"playtomic","shadow":True})})
            c.execute(text("""
                insert into public.sync_cursors(provider_connection_id,stream,cursor,last_started_at,last_completed_at,last_error)
                values(cast(:pc as uuid),:stream,cast(:cursor as jsonb),now(),
                       case when :done then now() else null end,null)
                on conflict(provider_connection_id,stream) do update set
                  cursor=excluded.cursor,last_started_at=coalesce(public.sync_cursors.last_started_at,now()),
                  last_completed_at=case when :done then now() else public.sync_cursors.last_completed_at end,
                  last_error=null
            """), {"pc": pc_id, "stream": stream,
                   "cursor": _json({"cursor": response.get("next_cursor"), "page": page}),
                   "done": not response["has_more"]})
        total += len(records)
        if not response["has_more"]:
            break
        cursor = response.get("next_cursor")
        page += 1
    with db.trusted() as c:
        c.execute(text("""
            update public.provider_connections set last_success_at=now(),last_error_at=null
            where id=cast(:id as uuid)
        """), {"id": pc_id})
    return {"provider": "playtomic", "stream": stream, "records": total}


def _normalize_external(rec: dict):
    return {
        "external_reference": str(rec.get("external_id") or ""),
        "status": rec.get("status"),
        "starts_at": rec.get("starts_at"),
        "ends_at": rec.get("ends_at"),
        "amount_minor": rec.get("total_minor"),
        "currency": rec.get("currency"),
    }


def _reconcile(db: V1Store, job: dict):
    run_id = (job["payload"] or {}).get("run_id")
    with db.trusted() as c:
        run = one(c.execute(text("""
            select r.id::text,r.organization_id::text,r.provider_connection_id::text,r.scope,
                   r.window_start,r.window_end,pc.provider
            from public.reconciliation_runs r
            left join public.provider_connections pc on pc.id=r.provider_connection_id
            where r.id=cast(:id as uuid) for update
        """), {"id": run_id}))
        if not run:
            raise DomainError("RECON_NOT_FOUND", "Reconciliation run not found.", 404)
        c.execute(text("update public.reconciliation_runs set status='running' where id=cast(:id as uuid)"), {"id": run_id})
        c.execute(text("delete from public.reconciliation_items where run_id=cast(:id as uuid)"), {"id": run_id})
        if not run["provider_connection_id"]:
            raise DomainError("RECON_PROVIDER", "Reconciliation run has no provider connection.", 409)
        observations = rows(c.execute(text("""
            select distinct on (external_id) external_id,payload,observed_at
            from public.provider_observations
            where provider_connection_id=cast(:pc as uuid) and stream='bookings' and external_id is not null
              and (:a is null or observed_at>=:a) and (:b is null or observed_at<=:b)
            order by external_id,observed_at desc
        """), {"pc": run["provider_connection_id"], "a": run["window_start"], "b": run["window_end"]}))
        internal = rows(c.execute(text("""
            select id::text,external_reference,status::text,starts_at,ends_at,gross_amount_minor,currency::text,source
            from public.bookings
            where organization_id=cast(:org as uuid)
              and source=:provider and external_reference is not null
              and (:a is null or starts_at>=:a) and (:b is null or starts_at<=:b)
        """), {"org": run["organization_id"], "provider": run["provider"],
               "a": run["window_start"], "b": run["window_end"]}))
        by_ext = {o["external_id"]: _normalize_external(o["payload"]) for o in observations}
        by_int = {b["external_reference"]: b for b in internal}
        issues = []
        for ext, observed in by_ext.items():
            expected = by_int.get(ext)
            if not expected:
                issues.append((ext, "external_only", "warning", {}, observed))
                continue
            mismatch = {}
            for field, key in (("status","status"),("gross_amount_minor","amount_minor"),("currency","currency")):
                if observed.get(key) is not None and str(expected.get(field)) != str(observed.get(key)):
                    mismatch[field] = {"expected": expected.get(field), "observed": observed.get(key)}
            if observed.get("starts_at") and expected["starts_at"].isoformat() != str(observed["starts_at"]):
                mismatch["starts_at"] = {"expected": expected["starts_at"].isoformat(), "observed": observed["starts_at"]}
            if observed.get("ends_at") and expected["ends_at"].isoformat() != str(observed["ends_at"]):
                mismatch["ends_at"] = {"expected": expected["ends_at"].isoformat(), "observed": observed["ends_at"]}
            if mismatch:
                issues.append((ext, "booking_mismatch", "critical" if "status" in mismatch else "warning", expected, observed))
        for ext, expected in by_int.items():
            if ext not in by_ext:
                issues.append((ext, "internal_only", "warning", expected, {}))
        for ext, category, severity, expected, observed in issues:
            c.execute(text("""
                insert into public.reconciliation_items
                  (organization_id,run_id,external_reference,category,severity,expected,observed)
                values(cast(:org as uuid),cast(:run as uuid),:external,:category,cast(:severity as public.fmc_recon_severity),
                       cast(:expected as jsonb),cast(:observed as jsonb))
            """), {"org": run["organization_id"], "run": run_id, "external": ext,
                   "category": category, "severity": severity,
                   "expected": _json(expected), "observed": _json(observed)})
        summary = {"observed": len(by_ext), "internal": len(by_int), "issues": len(issues)}
        c.execute(text("""
            update public.reconciliation_runs
            set status='completed',summary=cast(:summary as jsonb),completed_at=now()
            where id=cast(:id as uuid)
        """), {"id": run_id, "summary": _json(summary)})
        return summary


def run(settings, service: str):
    db = V1Store(settings.database)
    server = _health_server(db)
    kinds = ("reconcile",) if service == "reconciliation-worker" else ("sync_bookings","sync_players","sync_payments")
    try:
        while True:
            job = db.claim_job(kinds)
            if not job:
                time.sleep(1)
                continue
            try:
                result = _reconcile(db, job) if service == "reconciliation-worker" else _sync_playtomic(db, job)
                db.finish_job(job["id"], job["lease_token"], result)
            except Deferred as exc:
                db.fail_job(job["id"], job["lease_token"], exc.code)
                time.sleep(min(exc.seconds, 5))
            except DomainError as exc:
                db.fail_job(job["id"], job["lease_token"], f"{exc.code}:{exc.message}")
            except Exception as exc:
                db.fail_job(job["id"], job["lease_token"], f"UNEXPECTED:{type(exc).__name__}")
    finally:
        server.shutdown()
