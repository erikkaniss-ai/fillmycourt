"""Managed Supabase-v1 API surface for FillMyCourt + GetACourt."""
from __future__ import annotations

import csv
from datetime import datetime, timedelta
import hashlib
import io
import json
import re
import uuid
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from .common import DomainError, SPORTS, require_key
from .supabase_v1 import Actor, SupabaseAuth, V1Store, one, rows


ROLE_ADMIN = {"owner", "admin"}
ROLE_MANAGER = {"owner", "admin", "manager"}
ROLE_DESK = {"owner", "admin", "manager", "front_desk"}
ROLE_FINANCE = {"owner", "admin", "manager", "analyst"}


def iso(value: str) -> datetime:
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if d.tzinfo is None:
            raise ValueError
        return d
    except (ValueError, TypeError, AttributeError):
        raise DomainError("TIMESTAMP", "Use ISO 8601 with a timezone.", 422) from None


def slugify(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not 3 <= len(s) <= 60:
        raise DomainError("SLUG", "Use a 3–60 character organization slug.", 422)
    return s


class OrganizationIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    slug: str = Field(min_length=3, max_length=60)
    timezone: str = "Europe/Lisbon"
    currency: str = Field(default="EUR", min_length=3, max_length=3)


class VenueIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    timezone: str = "Europe/Lisbon"
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    address: dict = {}


class CourtIn(BaseModel):
    venue_id: str
    name: str = Field(min_length=1, max_length=120)
    sport: str
    indoor: bool | None = None
    inventory_mode: str = "shadow"


class RateIn(BaseModel):
    court_id: str
    weekday: int | None = Field(default=None, ge=0, le=6)
    start_minute: int = Field(default=0, ge=0, le=1439)
    end_minute: int = Field(default=1440, ge=1, le=1440)
    price_minor: int = Field(ge=0, le=100_000_000)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    priority: int = 100


class BlockIn(BaseModel):
    court_id: str
    starts_at: str
    ends_at: str
    reason: str | None = Field(default=None, max_length=500)


class ImportIn(BaseModel):
    source: str = Field(min_length=1, max_length=40)
    csv: str = Field(min_length=1, max_length=2_500_000)


class ProviderIn(BaseModel):
    provider: str = Field(min_length=2, max_length=40)
    write_mode: str = "read_sync"
    config: dict = {}


class ReconRunIn(BaseModel):
    provider_connection_id: str | None = None
    scope: str = "bookings"
    window_start: str | None = None
    window_end: str | None = None


class ReconAction(BaseModel):
    action: str
    assignee: str | None = None
    note: str | None = Field(default=None, max_length=2000)


class HoldIn(BaseModel):
    court_id: str
    starts_at: str
    duration: int = Field(ge=30, le=240)


class ConfirmIn(BaseModel):
    participants: int = Field(default=1, ge=1, le=20)
    accept_policy: bool = False


def create_v1_app(settings, service: str = "all"):
    if service not in ("all", "core", "operations"):
        raise RuntimeError("Unknown service mode")
    db = V1Store(settings.database)
    auth = SupabaseAuth(settings.supabase_url, settings.supabase_publishable_key)
    app = FastAPI(title="FillMyCourt shared platform", version="0.5.0",
                  docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return JSONResponse({"error": exc.code, "message": exc.message}, status_code=exc.status)

    @app.middleware("http")
    async def security(request: Request, call_next):
        request.state.request_id = str(uuid.uuid4())
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            length = request.headers.get("content-length")
            if length and int(length) > 3_000_000:
                return JSONResponse({"error": "BODY_LIMIT"}, status_code=413)
            origin = request.headers.get("origin")
            if origin and settings.origin and origin.rstrip("/") != settings.origin:
                return JSONResponse({"error": "ORIGIN"}, status_code=403)
        response = await call_next(request)
        response.headers.update({
            "X-Request-ID": request.state.request_id,
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store" if request.url.path.startswith("/api/") else "no-cache",
        })
        if settings.environment != "production":
            response.headers["X-Robots-Tag"] = "noindex,nofollow"
        return response

    def who(request: Request) -> Actor:
        return auth.verify(request.headers.get("authorization"))

    def role(c, org: str, actor: Actor, allowed=None):
        return db.require_role(c, org, actor.id, set(allowed) if allowed else None)

    def audit(c, request, org, actor, event, entity, entity_id, before=None, after=None):
        db.emit(c, org, actor.id if actor else None, event, entity, entity_id,
                before, after, request.state.request_id)

    @app.get("/api/health")
    def health():
        return {"ok": True, "service": service, "version": "0.5.0", "data_contract": "supabase-v1"}

    @app.get("/health/ready")
    def ready():
        db.ping()
        return {"ok": True}

    @app.get("/api/config")
    def config():
        return {
            "version": "0.5.0",
            "data_contract": "supabase-v1",
            "booking_enabled": settings.booking_enabled,
            "auth": "supabase",
            "online_payments": False,
        }

    @app.get("/api/me")
    def me(request: Request):
        a = who(request)
        return {"user": {"id": a.id, "email": a.email}, "organizations": db.organizations_for(a.id)}

    if service in ("operations", "all"):
        @app.get("/api/fmc/organizations")
        def organizations(request: Request):
            return {"items": db.organizations_for(who(request).id)}

        @app.post("/api/fmc/organizations", status_code=201)
        def create_org(body: OrganizationIn, request: Request):
            a = who(request)
            slug = slugify(body.slug)
            try:
                ZoneInfo(body.timezone)
            except Exception:
                raise DomainError("TIMEZONE", "Unknown timezone.", 422)
            with db.trusted() as c:
                exists = one(c.execute(text("select id from public.organizations where slug=:slug"), {"slug": slug}))
                if exists:
                    raise DomainError("SLUG_TAKEN", "Organization slug already exists.", 409)
                r = one(c.execute(text("""
                    insert into public.organizations(slug,name,default_currency,timezone)
                    values(:slug,:name,:currency,:timezone)
                    returning id::text,slug,name,default_currency::text,timezone
                """), {"slug": slug, "name": body.name, "currency": body.currency.upper(), "timezone": body.timezone}))
                c.execute(text("""
                    insert into public.organization_members(organization_id,user_id,role)
                    values(cast(:org as uuid),cast(:uid as uuid),'owner')
                """), {"org": r["id"], "uid": a.id})
                audit(c, request, r["id"], a, "organization.created", "organization", r["id"], after=r)
                return r

        @app.get("/api/fmc/{org}/venues")
        def venues(org: str, request: Request):
            a = who(request)
            with db.user(a.id) as c:
                role(c, org, a)
                return {"items": rows(c.execute(text("""
                    select id::text,name,timezone,currency::text,address,active,created_at
                    from public.venues where organization_id=cast(:org as uuid)
                    order by name
                """), {"org": org}))}

        @app.post("/api/fmc/{org}/venues", status_code=201)
        def create_venue(org: str, body: VenueIn, request: Request):
            a = who(request)
            try:
                ZoneInfo(body.timezone)
            except Exception:
                raise DomainError("TIMEZONE", "Unknown timezone.", 422)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_MANAGER)
                r = one(c.execute(text("""
                    insert into public.venues(organization_id,name,timezone,currency,address)
                    values(cast(:org as uuid),:name,:timezone,:currency,cast(:address as jsonb))
                    returning id::text,name,timezone,currency::text,address,active
                """), {"org": org, "name": body.name, "timezone": body.timezone,
                       "currency": body.currency.upper(), "address": json.dumps(body.address)}))
                audit(c, request, org, a, "venue.created", "venue", r["id"], after=r)
                return r

        @app.get("/api/fmc/{org}/courts")
        def courts(org: str, request: Request):
            a = who(request)
            with db.user(a.id) as c:
                role(c, org, a)
                return {"items": rows(c.execute(text("""
                    select c.id::text,c.venue_id::text,c.name,c.sport,c.indoor,c.active,
                           c.inventory_mode::text,c.native_write_enabled,v.name venue_name
                    from public.courts c join public.venues v on v.id=c.venue_id
                    where v.organization_id=cast(:org as uuid)
                    order by v.name,c.name
                """), {"org": org}))}

        @app.post("/api/fmc/{org}/courts", status_code=201)
        def create_court(org: str, body: CourtIn, request: Request):
            a = who(request)
            if body.sport not in SPORTS:
                raise DomainError("SPORT", "Unsupported sport.", 422)
            if body.inventory_mode not in ("shadow", "native", "handoff"):
                raise DomainError("MODE", "Unsupported inventory mode.", 422)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_MANAGER)
                venue = one(c.execute(text("""
                    select id from public.venues where id=cast(:venue as uuid) and organization_id=cast(:org as uuid)
                """), {"venue": body.venue_id, "org": org}))
                if not venue:
                    raise DomainError("VENUE_NOT_FOUND", "Venue not found.", 404)
                r = one(c.execute(text("""
                    insert into public.courts(venue_id,name,sport,indoor,inventory_mode,native_write_enabled)
                    values(cast(:venue as uuid),:name,:sport,:indoor,cast(:mode as public.fmc_inventory_mode),false)
                    returning id::text,venue_id::text,name,sport,indoor,active,inventory_mode::text,native_write_enabled
                """), {"venue": body.venue_id, "name": body.name, "sport": body.sport,
                       "indoor": body.indoor, "mode": body.inventory_mode}))
                audit(c, request, org, a, "court.created", "court", r["id"], after=r)
                return r

        @app.post("/api/fmc/{org}/rates", status_code=201)
        def create_rate(org: str, body: RateIn, request: Request):
            a = who(request)
            if body.end_minute <= body.start_minute:
                raise DomainError("RATE_RANGE", "Rate end must be after start.", 422)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_MANAGER)
                court = one(c.execute(text("""
                    select c.id from public.courts c join public.venues v on v.id=c.venue_id
                    where c.id=cast(:court as uuid) and v.organization_id=cast(:org as uuid)
                """), {"court": body.court_id, "org": org}))
                if not court:
                    raise DomainError("COURT_NOT_FOUND", "Court not found.", 404)
                r = one(c.execute(text("""
                    insert into public.court_rates
                      (organization_id,court_id,weekday,start_minute,end_minute,price_minor,currency,priority)
                    values(cast(:org as uuid),cast(:court as uuid),:weekday,:start,:end,:price,:currency,:priority)
                    returning id::text,court_id::text,weekday,start_minute,end_minute,price_minor,currency::text,priority
                """), {"org": org, "court": body.court_id, "weekday": body.weekday,
                       "start": body.start_minute, "end": body.end_minute,
                       "price": body.price_minor, "currency": body.currency.upper(), "priority": body.priority}))
                audit(c, request, org, a, "rate.created", "court_rate", r["id"], after=r)
                return r

        @app.post("/api/fmc/{org}/blocks", status_code=201)
        def create_block(org: str, body: BlockIn, request: Request):
            a = who(request)
            start, end = iso(body.starts_at), iso(body.ends_at)
            if end <= start:
                raise DomainError("DATE_RANGE", "Block end must be after start.", 422)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_DESK)
                db.advisory_court_lock(c, body.court_id)
                court = one(c.execute(text("""
                    select c.id from public.courts c join public.venues v on v.id=c.venue_id
                    where c.id=cast(:court as uuid) and v.organization_id=cast(:org as uuid)
                """), {"court": body.court_id, "org": org}))
                if not court:
                    raise DomainError("COURT_NOT_FOUND", "Court not found.", 404)
                r = one(c.execute(text("""
                    insert into public.court_blocks(organization_id,court_id,starts_at,ends_at,reason,created_by)
                    values(cast(:org as uuid),cast(:court as uuid),:a,:b,:reason,cast(:uid as uuid))
                    returning id::text,court_id::text,starts_at,ends_at,reason
                """), {"org": org, "court": body.court_id, "a": start, "b": end,
                       "reason": body.reason, "uid": a.id}))
                audit(c, request, org, a, "court.blocked", "court_block", r["id"], after=r)
                return r

        @app.get("/api/fmc/{org}/people")
        def people(org: str, request: Request, q: str = "", after: str = "",
                   limit: int = Query(50, ge=1, le=100)):
            a = who(request)
            with db.user(a.id) as c:
                role(c, org, a)
                params = {"org": org, "q": f"%{q.strip().lower()}%", "after": after or None, "limit": limit}
                return {"items": rows(c.execute(text("""
                    select id::text,full_name,email,phone,marketing_consent,source,external_key,updated_at
                    from public.people
                    where organization_id=cast(:org as uuid)
                      and (:after is null or id::text>:after)
                      and (:q='%%' or lower(coalesce(full_name,'')) like :q
                           or lower(coalesce(email,'')) like :q
                           or coalesce(phone,'') like :q)
                    order by id limit :limit
                """), params))}

        @app.post("/api/fmc/{org}/imports", status_code=201)
        def stage_import(org: str, body: ImportIn, request: Request):
            a = who(request)
            raw = body.csv
            reader = csv.DictReader(io.StringIO(raw))
            allowed = {"external_id", "name", "email", "phone", "marketing_consent"}
            if not reader.fieldnames or not set(reader.fieldnames).issubset(allowed):
                raise DomainError("CSV_HEADERS", "Use external_id,name,email,phone,marketing_consent headers.", 422)
            staged, errors = [], []
            seen = set()
            for line, item in enumerate(reader, start=2):
                row = {k: (v or "").strip() for k, v in item.items()}
                if not any(row.values()):
                    continue
                key = row.get("external_id") or row.get("email").lower() or row.get("phone")
                if not key:
                    errors.append({"line": line, "error": "missing_identity"})
                    continue
                if key in seen:
                    errors.append({"line": line, "error": "duplicate_in_file"})
                    continue
                seen.add(key)
                consent = row.get("marketing_consent", "").lower()
                if consent not in ("", "true", "false", "unknown"):
                    errors.append({"line": line, "error": "invalid_marketing_consent"})
                    continue
                row["marketing_consent"] = None if consent in ("", "unknown") else consent == "true"
                staged.append(row)
            fingerprint = hashlib.sha256(raw.encode()).hexdigest()
            with db.user(a.id) as c:
                role(c, org, a, ROLE_MANAGER)
                existing = one(c.execute(text("""
                    select id::text,status,errors from public.import_batches
                    where organization_id=cast(:org as uuid) and source=:source and kind='people' and fingerprint=:fp
                """), {"org": org, "source": body.source, "fp": fingerprint}))
                if existing:
                    return {"id": existing["id"], "status": existing["status"], "errors": existing["errors"], "duplicate": True}
                r = one(c.execute(text("""
                    insert into public.import_batches
                      (organization_id,source,kind,fingerprint,payload,errors,actor_user_id)
                    values(cast(:org as uuid),:source,'people',:fp,cast(:payload as jsonb),cast(:errors as jsonb),cast(:uid as uuid))
                    returning id::text,status,created_at
                """), {"org": org, "source": body.source, "fp": fingerprint,
                       "payload": json.dumps(staged), "errors": json.dumps(errors), "uid": a.id}))
                audit(c, request, org, a, "import.staged", "import_batch", r["id"],
                      after={"rows": len(staged), "errors": len(errors), "source": body.source})
                return {**r, "rows": len(staged), "errors": errors}

        @app.post("/api/fmc/{org}/imports/{batch}/commit")
        def commit_import(org: str, batch: str, request: Request):
            a = who(request)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_MANAGER)
                b = one(c.execute(text("""
                    select * from public.import_batches
                    where id=cast(:id as uuid) and organization_id=cast(:org as uuid) for update
                """), {"id": batch, "org": org}))
                if not b:
                    raise DomainError("IMPORT_NOT_FOUND", "Import not found.", 404)
                if b["status"] == "committed":
                    return {"id": batch, "status": "committed", "result": b["result"]}
                if b["status"] != "staged":
                    raise DomainError("IMPORT_STATE", "Import is not staged.", 409)
                changes = []
                for item in b["payload"]:
                    existing = None
                    if item.get("external_id"):
                        existing = one(c.execute(text("""
                            select * from public.people where organization_id=cast(:org as uuid)
                              and source=:source and external_key=:external limit 1
                        """), {"org": org, "source": b["source"], "external": item["external_id"]}))
                    if not existing and item.get("email"):
                        existing = one(c.execute(text("""
                            select * from public.people where organization_id=cast(:org as uuid)
                              and lower(email)=lower(:email) limit 1
                        """), {"org": org, "email": item["email"]}))
                    before = dict(existing) if existing else None
                    if existing:
                        c.execute(text("""
                            update public.people set
                              external_key=coalesce(nullif(:external,''),external_key),
                              full_name=coalesce(nullif(:name,''),full_name),
                              email=coalesce(nullif(:email,''),email),
                              phone=coalesce(nullif(:phone,''),phone),
                              marketing_consent=coalesce(:consent,marketing_consent),
                              source=:source,source_updated_at=now(),updated_at=now()
                            where id=cast(:id as uuid)
                        """), {"external": item.get("external_id",""), "name": item.get("name",""),
                               "email": item.get("email",""), "phone": item.get("phone",""),
                               "consent": item.get("marketing_consent"), "source": b["source"], "id": str(existing["id"])})
                        pid = str(existing["id"])
                        changes.append({"id": pid, "created": False, "before": {k: str(v) if isinstance(v,(datetime,uuid.UUID)) else v for k,v in before.items()}})
                    else:
                        r = one(c.execute(text("""
                            insert into public.people
                              (organization_id,external_key,full_name,email,phone,marketing_consent,source,source_updated_at)
                            values(cast(:org as uuid),nullif(:external,''),nullif(:name,''),nullif(:email,''),
                                   nullif(:phone,''),:consent,:source,now())
                            returning id::text
                        """), {"org": org, "external": item.get("external_id",""), "name": item.get("name",""),
                               "email": item.get("email",""), "phone": item.get("phone",""),
                               "consent": item.get("marketing_consent"), "source": b["source"]}))
                        changes.append({"id": r["id"], "created": True})
                result = {"changes": changes, "count": len(changes)}
                c.execute(text("""
                    update public.import_batches
                    set status='committed',committed_at=now(),result=cast(:result as jsonb)
                    where id=cast(:id as uuid)
                """), {"id": batch, "result": json.dumps(result)})
                audit(c, request, org, a, "import.committed", "import_batch", batch,
                      after={"count": len(changes)})
                return {"id": batch, "status": "committed", "count": len(changes)}

        @app.post("/api/fmc/{org}/imports/{batch}/rollback")
        def rollback_import(org: str, batch: str, request: Request):
            a = who(request)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_ADMIN)
                b = one(c.execute(text("""
                    select * from public.import_batches
                    where id=cast(:id as uuid) and organization_id=cast(:org as uuid) for update
                """), {"id": batch, "org": org}))
                if not b or b["status"] != "committed":
                    raise DomainError("IMPORT_STATE", "Only a committed import can be rolled back.", 409)
                for ch in reversed(b["result"].get("changes", [])):
                    if ch.get("created"):
                        c.execute(text("""
                            delete from public.people where id=cast(:id as uuid) and organization_id=cast(:org as uuid)
                              and auth_user_id is null
                        """), {"id": ch["id"], "org": org})
                    else:
                        before = ch.get("before") or {}
                        c.execute(text("""
                            update public.people set external_key=:external,full_name=:name,email=:email,phone=:phone,
                              marketing_consent=:consent,source=:source,updated_at=now()
                            where id=cast(:id as uuid) and organization_id=cast(:org as uuid)
                        """), {"external": before.get("external_key"), "name": before.get("full_name"),
                               "email": before.get("email"), "phone": before.get("phone"),
                               "consent": before.get("marketing_consent"), "source": before.get("source","fmc"),
                               "id": ch["id"], "org": org})
                c.execute(text("""
                    update public.import_batches set status='rolled_back',rolled_back_at=now()
                    where id=cast(:id as uuid)
                """), {"id": batch})
                audit(c, request, org, a, "import.rolled_back", "import_batch", batch)
                return {"id": batch, "status": "rolled_back"}

        @app.get("/api/fmc/{org}/calendar")
        def calendar(org: str, request: Request, start: str, end: str):
            a = who(request)
            begin, finish = iso(start), iso(end)
            if not begin < finish or finish - begin > timedelta(days=31):
                raise DomainError("DATE_RANGE", "Calendar window must be 31 days or less.", 422)
            with db.user(a.id) as c:
                role(c, org, a)
                bookings = rows(c.execute(text("""
                    select b.id::text,b.court_id::text,b.player_id::text,b.status::text,b.starts_at,b.ends_at,
                           b.gross_amount_minor,b.currency::text,b.source,b.external_reference,b.metadata
                    from public.bookings b
                    where b.organization_id=cast(:org as uuid) and b.starts_at<:finish and b.ends_at>:begin
                    order by b.starts_at
                """), {"org": org, "begin": begin, "finish": finish}))
                blocks = rows(c.execute(text("""
                    select id::text,court_id::text,starts_at,ends_at,reason
                    from public.court_blocks
                    where organization_id=cast(:org as uuid) and starts_at<:finish and ends_at>:begin
                    order by starts_at
                """), {"org": org, "begin": begin, "finish": finish}))
                return {"bookings": bookings, "blocks": blocks}

        @app.get("/api/fmc/{org}/providers")
        def providers(org: str, request: Request):
            a = who(request)
            with db.user(a.id) as c:
                role(c, org, a)
                return {"items": rows(c.execute(text("""
                    select id::text,provider,status,capabilities,config,last_success_at,last_error_at,created_at
                    from public.provider_connections where organization_id=cast(:org as uuid) order by provider
                """), {"org": org}))}

        @app.put("/api/fmc/{org}/providers/{provider}")
        def configure_provider(org: str, provider: str, body: ProviderIn, request: Request):
            a = who(request)
            if provider != body.provider:
                raise DomainError("PROVIDER", "Provider path/body mismatch.", 422)
            if body.write_mode not in ("read_sync", "handoff", "authorized_native_write"):
                raise DomainError("WRITE_MODE", "Unsupported provider write mode.", 422)
            if provider == "playtomic" and body.write_mode == "authorized_native_write":
                raise DomainError("WRITE_NOT_AUTHORIZED", "Playtomic native write is not enabled without explicit authorization.", 409)
            capabilities = {"write_mode": body.write_mode}
            with db.user(a.id) as c:
                role(c, org, a, ROLE_ADMIN)
                r = one(c.execute(text("""
                    insert into public.provider_connections(organization_id,provider,status,capabilities,config)
                    values(cast(:org as uuid),:provider,'configured',cast(:cap as jsonb),cast(:config as jsonb))
                    on conflict(organization_id,provider) do update set
                      status='configured',capabilities=excluded.capabilities,config=excluded.config
                    returning id::text,provider,status,capabilities,config
                """), {"org": org, "provider": provider, "cap": json.dumps(capabilities), "config": json.dumps(body.config)}))
                audit(c, request, org, a, "provider.configured", "provider_connection", r["id"], after=r)
                return r

        @app.post("/api/fmc/{org}/providers/{provider}/sync", status_code=202)
        def sync_provider(org: str, provider: str, request: Request, stream: str = "bookings"):
            a = who(request)
            if stream not in ("bookings", "players", "payments"):
                raise DomainError("STREAM", "Unsupported sync stream.", 422)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_FINANCE)
                connection = one(c.execute(text("""
                    select id::text from public.provider_connections
                    where organization_id=cast(:org as uuid) and provider=:provider and status='configured'
                """), {"org": org, "provider": provider}))
                if not connection:
                    raise DomainError("PROVIDER_NOT_CONFIGURED", "Provider is not configured.", 409)
                key = request.headers.get("idempotency-key") or f"{connection['id']}:{stream}:{datetime.utcnow().date()}"
                r = one(c.execute(text("""
                    insert into public.jobs(organization_id,kind,dedupe_key,payload)
                    values(cast(:org as uuid),:kind,:key,cast(:payload as jsonb))
                    on conflict(organization_id,kind,dedupe_key) do update set updated_at=now()
                    returning id::text,status
                """), {"org": org, "kind": f"sync_{stream}", "key": key,
                       "payload": json.dumps({"provider_connection_id": connection["id"], "provider": provider, "stream": stream})}))
                audit(c, request, org, a, "provider.sync_queued", "job", r["id"], after={"provider": provider, "stream": stream})
                return r

        @app.post("/api/fmc/{org}/reconciliation/runs", status_code=202)
        def reconcile(org: str, body: ReconRunIn, request: Request):
            a = who(request)
            begin = iso(body.window_start) if body.window_start else None
            finish = iso(body.window_end) if body.window_end else None
            if begin and finish and (finish <= begin or finish - begin > timedelta(days=366)):
                raise DomainError("DATE_RANGE", "Invalid reconciliation window.", 422)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_FINANCE)
                run = one(c.execute(text("""
                    insert into public.reconciliation_runs
                      (organization_id,provider_connection_id,scope,window_start,window_end,status)
                    values(cast(:org as uuid),cast(:provider as uuid),:scope,:begin,:finish,'queued')
                    returning id::text,status,started_at
                """), {"org": org, "provider": body.provider_connection_id, "scope": body.scope,
                       "begin": begin, "finish": finish}))
                c.execute(text("""
                    insert into public.jobs(organization_id,kind,dedupe_key,payload)
                    values(cast(:org as uuid),'reconcile',:key,cast(:payload as jsonb))
                """), {"org": org, "key": run["id"], "payload": json.dumps({"run_id": run["id"]})})
                audit(c, request, org, a, "reconciliation.queued", "reconciliation_run", run["id"], after={"scope": body.scope})
                return run

        @app.get("/api/fmc/{org}/reconciliation/runs")
        def reconciliation_runs(org: str, request: Request):
            a = who(request)
            with db.user(a.id) as c:
                role(c, org, a)
                return {"items": rows(c.execute(text("""
                    select id::text,provider_connection_id::text,scope,window_start,window_end,status,summary,started_at,completed_at
                    from public.reconciliation_runs where organization_id=cast(:org as uuid)
                    order by started_at desc limit 100
                """), {"org": org}))}

        @app.get("/api/fmc/{org}/reconciliation/items")
        def reconciliation_items(org: str, request: Request, status: str = "", limit: int = Query(100, ge=1, le=200)):
            a = who(request)
            with db.user(a.id) as c:
                role(c, org, a)
                return {"items": rows(c.execute(text("""
                    select id::text,run_id::text,booking_id::text,external_reference,category,severity::text,status::text,
                           expected,observed,assigned_to::text,proposed_by::text,approved_by::text,resolution,created_at,resolved_at
                    from public.reconciliation_items
                    where organization_id=cast(:org as uuid) and (:status='' or status::text=:status)
                    order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end,created_at desc
                    limit :limit
                """), {"org": org, "status": status, "limit": limit}))}

        @app.post("/api/fmc/{org}/reconciliation/items/{item_id}")
        def reconciliation_action(org: str, item_id: str, body: ReconAction, request: Request):
            a = who(request)
            if body.action not in ("assign", "propose", "approve", "resolve", "ignore"):
                raise DomainError("ACTION", "Unsupported reconciliation action.", 422)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_FINANCE)
                current = one(c.execute(text("""
                    select id::text,status::text,proposed_by::text from public.reconciliation_items
                    where id=cast(:id as uuid) and organization_id=cast(:org as uuid) for update
                """), {"id": item_id, "org": org}))
                if not current:
                    raise DomainError("NOT_FOUND", "Reconciliation item not found.", 404)
                if body.action == "approve" and current.get("proposed_by") == a.id:
                    raise DomainError("FOUR_EYES", "A different user must approve this proposal.", 409)
                status_map = {"assign":"assigned","propose":"proposed","approve":"approved","resolve":"resolved","ignore":"ignored"}
                c.execute(text("""
                    update public.reconciliation_items set
                      status=cast(:status as public.fmc_recon_status),
                      assigned_to=case when :action='assign' then cast(:assignee as uuid) else assigned_to end,
                      proposed_by=case when :action='propose' then cast(:uid as uuid) else proposed_by end,
                      approved_by=case when :action='approve' then cast(:uid as uuid) else approved_by end,
                      resolution=case when :action in ('resolve','ignore') then jsonb_build_object('note',:note,'by',:uid) else resolution end,
                      resolved_at=case when :action in ('resolve','ignore') then now() else resolved_at end
                    where id=cast(:id as uuid) and organization_id=cast(:org as uuid)
                """), {"status": status_map[body.action], "action": body.action,
                       "assignee": body.assignee, "uid": a.id, "note": body.note, "id": item_id, "org": org})
                audit(c, request, org, a, f"reconciliation.{body.action}", "reconciliation_item", item_id,
                      before=current, after={"status": status_map[body.action], "note": body.note})
                return {"id": item_id, "status": status_map[body.action]}

        @app.get("/api/fmc/{org}/audit")
        def audit_log(org: str, request: Request, after: int = 0, limit: int = Query(100, ge=1, le=200)):
            a = who(request)
            with db.user(a.id) as c:
                role(c, org, a, ROLE_FINANCE)
                return {"items": rows(c.execute(text("""
                    select id,actor_user_id::text,event_type,entity_type,entity_id,before_state,after_state,request_id,occurred_at
                    from public.audit_events
                    where organization_id=cast(:org as uuid) and id>:after
                    order by id limit :limit
                """), {"org": org, "after": after, "limit": limit}))}

    if service in ("core", "all"):
        @app.get("/api/availability")
        def availability(date: str, time: str, sport: str = "padel", duration: int = 90,
                         end_time: str = "23:00", location: str = "", indoor: str = "all"):
            if sport not in SPORTS:
                raise DomainError("SPORT", "Unsupported sport.", 422)
            if duration not in (30, 60, 90, 120, 150, 180, 240):
                raise DomainError("DURATION", "Unsupported duration.", 422)
            try:
                day = datetime.fromisoformat(date).date()
                sh, sm = map(int, time.split(":"))
                eh, em = map(int, end_time.split(":"))
            except Exception:
                raise DomainError("DATE_TIME", "Use YYYY-MM-DD and HH:MM.", 422)
            candidates = []
            with db.trusted() as c:
                courts = rows(c.execute(text("""
                    select c.id::text,c.name,c.sport,c.indoor,c.venue_id::text,
                           v.name venue_name,v.timezone,v.currency::text,v.address,v.organization_id::text
                    from public.courts c join public.venues v on v.id=c.venue_id
                    where c.active and v.active and c.sport=:sport
                      and c.inventory_mode='native' and c.native_write_enabled
                      and (:location='' or lower(v.name) like :loc or lower(v.address::text) like :loc)
                      and (:indoor='all' or (:indoor='true' and c.indoor is true) or (:indoor='false' and c.indoor is false))
                    order by v.name,c.name
                """), {"sport": sport, "location": location.strip().lower(), "loc": f"%{location.strip().lower()}%",
                       "indoor": indoor.lower()}))
                for court in courts:
                    tz = ZoneInfo(court["timezone"])
                    cursor = datetime(day.year, day.month, day.day, sh, sm, tzinfo=tz)
                    stop = datetime(day.year, day.month, day.day, eh, em, tzinfo=tz)
                    while cursor + timedelta(minutes=duration) <= stop:
                        end = cursor + timedelta(minutes=duration)
                        try:
                            _, quote = db.quote(c, court["id"], cursor, duration)
                        except DomainError:
                            cursor += timedelta(minutes=30)
                            continue
                        if not db.active_conflict(c, court["id"], cursor, end):
                            candidates.append({**court, "starts_at": cursor.isoformat(), "ends_at": end.isoformat(), **quote})
                        cursor += timedelta(minutes=30)
            return {"slots": candidates[:200], "count": min(len(candidates), 200)}

        @app.post("/api/holds", status_code=201)
        def hold(body: HoldIn, request: Request, idempotency_key: str | None = Header(default=None)):
            if not settings.booking_enabled:
                raise DomainError("BOOKING_UNAVAILABLE", "Direct booking is not enabled.", 503)
            a = who(request)
            require_key(idempotency_key)
            start = iso(body.starts_at)
            end = start + timedelta(minutes=body.duration)
            with db.trusted() as c:
                db.cleanup_expired_holds(c)
                db.advisory_court_lock(c, body.court_id)
                existing = one(c.execute(text("""
                    select id::text,quote,expires_at from public.booking_holds
                    where idempotency_key=:key and organization_id in (
                      select v.organization_id from public.courts c join public.venues v on v.id=c.venue_id where c.id=cast(:court as uuid)
                    )
                """), {"key": idempotency_key, "court": body.court_id}))
                if existing:
                    return existing
                court, quote = db.quote(c, body.court_id, start, body.duration)
                if court["inventory_mode"] != "native" or not court["native_write_enabled"]:
                    raise DomainError("HANDOFF_REQUIRED", "This inventory cannot be booked natively.", 409)
                if db.active_conflict(c, body.court_id, start, end):
                    raise DomainError("SLOT_TAKEN", "This slot is no longer available.", 409)
                player = db.ensure_person(c, court["organization_id"], a)
                r = one(c.execute(text("""
                    insert into public.booking_holds
                      (organization_id,court_id,player_id,starts_at,ends_at,expires_at,idempotency_key,quote)
                    values(cast(:org as uuid),cast(:court as uuid),cast(:player as uuid),:a,:b,now()+interval '10 minutes',:key,cast(:quote as jsonb))
                    returning id::text,starts_at,ends_at,expires_at,quote
                """), {"org": court["organization_id"], "court": body.court_id, "player": player,
                       "a": start, "b": end, "key": idempotency_key, "quote": json.dumps(quote)}))
                db.emit(c, court["organization_id"], a.id, "hold.created", "booking_hold", r["id"],
                        after={"court_id": body.court_id, "starts_at": body.starts_at})
                return r

        @app.post("/api/holds/{hold_id}/confirm", status_code=201)
        def confirm(hold_id: str, body: ConfirmIn, request: Request,
                    idempotency_key: str | None = Header(default=None)):
            if not settings.booking_enabled:
                raise DomainError("BOOKING_UNAVAILABLE", "Direct booking is not enabled.", 503)
            a = who(request)
            require_key(idempotency_key)
            if not body.accept_policy:
                raise DomainError("POLICY_REQUIRED", "Cancellation policy must be accepted.", 422)
            with db.trusted() as c:
                h = one(c.execute(text("""
                    select h.*,v.id venue_id,v.organization_id,p.auth_user_id
                    from public.booking_holds h
                    join public.courts c on c.id=h.court_id
                    join public.venues v on v.id=c.venue_id
                    join public.people p on p.id=h.player_id
                    where h.id=cast(:id as uuid) for update
                """), {"id": hold_id}))
                if not h or str(h["auth_user_id"]) != a.id:
                    raise DomainError("HOLD_NOT_FOUND", "Hold not found.", 404)
                if h["expires_at"] <= datetime.now(h["expires_at"].tzinfo):
                    c.execute(text("delete from public.booking_holds where id=cast(:id as uuid)"), {"id": hold_id})
                    raise DomainError("HOLD_EXPIRED", "Hold has expired.", 409)
                db.advisory_court_lock(c, str(h["court_id"]))
                if db.active_conflict(c, str(h["court_id"]), h["starts_at"], h["ends_at"], ignore_hold=hold_id):
                    raise DomainError("SLOT_TAKEN", "This slot is no longer available.", 409)
                existing = one(c.execute(text("""
                    select id::text,status::text from public.bookings
                    where organization_id=cast(:org as uuid) and idempotency_key=:key
                """), {"org": str(h["organization_id"]), "key": idempotency_key}))
                if existing:
                    return existing
                quote = h["quote"]
                r = one(c.execute(text("""
                    insert into public.bookings
                      (organization_id,venue_id,court_id,player_id,status,starts_at,ends_at,currency,
                       gross_amount_minor,source,idempotency_key,cancellation_policy_version,metadata)
                    values(cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),cast(:player as uuid),'confirmed',:a,:b,:currency,
                           :amount,'getacourt',:key,:policy,cast(:metadata as jsonb))
                    returning id::text,status::text,starts_at,ends_at,currency::text,gross_amount_minor
                """), {"org": str(h["organization_id"]), "venue": str(h["venue_id"]), "court": str(h["court_id"]),
                       "player": str(h["player_id"]), "a": h["starts_at"], "b": h["ends_at"],
                       "currency": quote["currency"], "amount": quote["amount_minor"], "key": idempotency_key,
                       "policy": settings.terms_version or "unversioned",
                       "metadata": json.dumps({"participants": body.participants, "payment_status": "not_collected"})}))
                c.execute(text("delete from public.booking_holds where id=cast(:id as uuid)"), {"id": hold_id})
                db.emit(c, str(h["organization_id"]), a.id, "booking.confirmed", "booking", r["id"], after=r)
                return r

        @app.get("/api/bookings")
        def my_bookings(request: Request, limit: int = Query(50, ge=1, le=100)):
            a = who(request)
            with db.trusted() as c:
                return {"items": rows(c.execute(text("""
                    select b.id::text,b.status::text,b.starts_at,b.ends_at,b.currency::text,b.gross_amount_minor,
                           b.source,b.metadata,c.name court_name,v.name venue_name
                    from public.bookings b
                    join public.people p on p.id=b.player_id
                    join public.courts c on c.id=b.court_id
                    join public.venues v on v.id=b.venue_id
                    where p.auth_user_id=cast(:uid as uuid)
                    order by b.starts_at desc limit :limit
                """), {"uid": a.id, "limit": limit}))}

        @app.post("/api/bookings/{booking_id}/cancel")
        def cancel(booking_id: str, request: Request):
            a = who(request)
            with db.trusted() as c:
                b = one(c.execute(text("""
                    select b.id::text,b.organization_id::text,b.status::text,p.auth_user_id
                    from public.bookings b join public.people p on p.id=b.player_id
                    where b.id=cast(:id as uuid) for update
                """), {"id": booking_id}))
                if not b or str(b["auth_user_id"]) != a.id:
                    raise DomainError("BOOKING_NOT_FOUND", "Booking not found.", 404)
                if b["status"] not in ("confirmed", "pending_payment"):
                    raise DomainError("BOOKING_STATE", "Booking cannot be cancelled in this state.", 409)
                c.execute(text("""
                    update public.bookings set status='cancelled',updated_at=now()
                    where id=cast(:id as uuid)
                """), {"id": booking_id})
                db.emit(c, b["organization_id"], a.id, "booking.cancelled", "booking", booking_id,
                        before={"status": b["status"]}, after={"status": "cancelled"})
                return {"id": booking_id, "status": "cancelled"}

    return app


def create_from_env():
    from .config import Settings
    settings = Settings.from_env()
    settings.validate()
    import os
    return create_v1_app(settings, os.getenv("FMC_SERVICE","all"))
