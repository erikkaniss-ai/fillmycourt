"""Supabase-v1 production adapter.

The managed schema is the single source of truth. Client/operator requests are
authenticated against Supabase Auth. Trusted booking/worker transactions are
explicit and narrowly scoped; no schema mutation occurs at runtime.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import time
import uuid

import httpx
from sqlalchemy import create_engine, text

from .common import DomainError


def rows(result):
    return [dict(r) for r in result.mappings()]


def one(result):
    r = result.mappings().first()
    return dict(r) if r else None


@dataclass(frozen=True)
class Actor:
    id: str
    email: str | None = None


class SupabaseAuth:
    """Validate bearer tokens using Supabase Auth's canonical /user endpoint.

    This avoids embedding the project's signing secret in Railway and works
    before/after Supabase signing-key rotation. A short token-hash cache limits
    auth round-trips without storing raw access tokens.
    """

    def __init__(self, url: str, publishable_key: str, http=None, ttl: int = 30):
        self.url = url.rstrip("/")
        self.key = publishable_key
        self.http = http or httpx.Client(timeout=5, follow_redirects=False)
        self.ttl = ttl
        self.cache: dict[str, tuple[float, Actor]] = {}

    def verify(self, authorization: str | None) -> Actor:
        if not authorization or not authorization.startswith("Bearer "):
            raise DomainError("AUTH_REQUIRED", "Sign in is required.", 401)
        token = authorization[7:].strip()
        if not token:
            raise DomainError("AUTH_REQUIRED", "Sign in is required.", 401)
        if not self.url or not self.key:
            raise DomainError("AUTH_UNAVAILABLE", "Authentication is not configured.", 503)
        digest = hashlib.sha256(token.encode()).hexdigest()
        hit = self.cache.get(digest)
        now = time.time()
        if hit and hit[0] > now:
            return hit[1]
        try:
            r = self.http.get(
                f"{self.url}/auth/v1/user",
                headers={"apikey": self.key, "Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as exc:
            raise DomainError("AUTH_UNAVAILABLE", "Authentication service unavailable.", 503) from exc
        if r.status_code != 200:
            raise DomainError("AUTH_INVALID", "Session is invalid or expired.", 401)
        data = r.json()
        actor = Actor(id=str(data["id"]), email=data.get("email"))
        self.cache[digest] = (now + self.ttl, actor)
        if len(self.cache) > 5000:
            self.cache = {k: v for k, v in self.cache.items() if v[0] > now}
        return actor


class V1Store:
    def __init__(self, url: str):
        if not url.startswith("postgresql"):
            raise RuntimeError("supabase-v1 requires PostgreSQL")
        self.engine = create_engine(
            url,
            pool_pre_ping=True,
            pool_size=8,
            max_overflow=24,
            pool_timeout=10,
            pool_recycle=300,
        )

    @contextmanager
    def trusted(self):
        with self.engine.begin() as c:
            yield c

    @contextmanager
    def user(self, user_id: str):
        """Run a transaction as Supabase's authenticated role so RLS applies."""
        with self.engine.begin() as c:
            c.execute(text("set local role authenticated"))
            c.execute(text("select set_config('request.jwt.claim.sub', :uid, true)"), {"uid": user_id})
            c.execute(text("select set_config('request.jwt.claim.role', 'authenticated', true)"))
            yield c

    def ping(self):
        with self.engine.connect() as c:
            c.execute(text("select 1"))

    def organizations_for(self, user_id: str):
        with self.trusted() as c:
            return rows(c.execute(text("""
                select o.id::text, o.slug, o.name, o.default_currency, o.timezone,
                       m.role::text
                from public.organization_members m
                join public.organizations o on o.id=m.organization_id
                where m.user_id=:uid
                order by o.name
            """), {"uid": user_id}))

    def role(self, c, org_id: str, user_id: str) -> str | None:
        r = one(c.execute(text("""
            select role::text from public.organization_members
            where organization_id=:org::uuid and user_id=:uid::uuid
        """), {"org": org_id, "uid": user_id}))
        return r["role"] if r else None

    def require_role(self, c, org_id: str, user_id: str, allowed: set[str] | None = None):
        role = self.role(c, org_id, user_id)
        if not role:
            raise DomainError("FORBIDDEN", "You are not a member of this organization.", 403)
        if allowed and role not in allowed:
            raise DomainError("FORBIDDEN", "Your role cannot perform this action.", 403)
        return role

    def emit(self, c, org_id: str | None, actor_id: str | None, event_type: str,
             entity_type: str, entity_id: str | None, before=None, after=None, request_id=None):
        c.execute(text("""
            insert into public.audit_events
              (organization_id,actor_user_id,event_type,entity_type,entity_id,before_state,after_state,request_id)
            values
              (:org::uuid,:actor::uuid,:event_type,:entity_type,:entity_id,
               cast(:before as jsonb),cast(:after as jsonb),:request_id)
        """), {
            "org": org_id, "actor": actor_id, "event_type": event_type,
            "entity_type": entity_type, "entity_id": entity_id,
            "before": json.dumps(before) if before is not None else None,
            "after": json.dumps(after) if after is not None else None,
            "request_id": request_id,
        })
        if org_id:
            c.execute(text("""
                insert into public.domain_events
                  (organization_id,aggregate_type,aggregate_id,event_type,payload)
                values (:org::uuid,:kind,
                        case when :entity_id ~* '^[0-9a-f-]{36}$' then :entity_id::uuid else null end,
                        :event_type,cast(:payload as jsonb))
            """), {
                "org": org_id, "kind": entity_type, "entity_id": entity_id or "",
                "event_type": event_type,
                "payload": json.dumps({"entity_id": entity_id, "after": after}),
            })

    def advisory_court_lock(self, c, court_id: str):
        c.execute(text("select pg_advisory_xact_lock(hashtextextended(:court,0))"), {"court": court_id})

    def ensure_person(self, c, org_id: str, actor: Actor) -> str:
        existing = one(c.execute(text("""
            select id::text from public.people
            where organization_id=:org::uuid and auth_user_id=:uid::uuid
            order by created_at limit 1
        """), {"org": org_id, "uid": actor.id}))
        if existing:
            return existing["id"]
        r = one(c.execute(text("""
            insert into public.people(organization_id,auth_user_id,full_name,email,source)
            values(:org::uuid,:uid::uuid,null,:email,'getacourt')
            returning id::text
        """), {"org": org_id, "uid": actor.id, "email": actor.email}))
        return r["id"]

    def active_conflict(self, c, court_id: str, starts_at: datetime, ends_at: datetime,
                        ignore_hold: str | None = None) -> bool:
        p = {"court": court_id, "a": starts_at, "b": ends_at, "ignore": ignore_hold}
        q = one(c.execute(text("""
            select exists(
              select 1 from public.bookings
              where court_id=:court::uuid
                and status in ('held','pending_payment','confirmed')
                and starts_at < :b and ends_at > :a
              union all
              select 1 from public.booking_holds
              where court_id=:court::uuid and expires_at > now()
                and (:ignore is null or id<>:ignore::uuid)
                and starts_at < :b and ends_at > :a
              union all
              select 1 from public.court_blocks
              where court_id=:court::uuid and starts_at < :b and ends_at > :a
            ) as conflict
        """), p))
        return bool(q and q["conflict"])

    def quote(self, c, court_id: str, starts_at: datetime, duration_minutes: int):
        court = one(c.execute(text("""
            select c.id::text,c.venue_id::text,c.sport,c.indoor,c.inventory_mode::text,
                   c.native_write_enabled,v.organization_id::text,v.currency::text,v.timezone,v.name venue_name
            from public.courts c join public.venues v on v.id=c.venue_id
            where c.id=:court::uuid and c.active and v.active
        """), {"court": court_id}))
        if not court:
            raise DomainError("COURT_NOT_FOUND", "Court not found.", 404)
        local = starts_at.astimezone(timezone.utc)
        weekday = starts_at.weekday()
        minute = starts_at.hour * 60 + starts_at.minute
        rate = one(c.execute(text("""
            select price_minor,currency::text
            from public.court_rates
            where court_id=:court::uuid and active
              and (weekday is null or weekday=:weekday)
              and start_minute<=:minute and end_minute>:minute
            order by priority asc, created_at desc limit 1
        """), {"court": court_id, "weekday": weekday, "minute": minute}))
        if not rate:
            raise DomainError("NO_RATE", "No active rate covers this time.", 409)
        # Rates are stored per 60 minutes; calculate proportionally in integer cents.
        amount = (int(rate["price_minor"]) * int(duration_minutes) + 59) // 60
        return court, {"amount_minor": amount, "currency": rate["currency"], "duration_minutes": duration_minutes}

    def cleanup_expired_holds(self, c):
        c.execute(text("delete from public.booking_holds where expires_at<=now()"))

    def claim_job(self, kinds: tuple[str, ...], lease_seconds: int = 60):
        with self.trusted() as c:
            r = one(c.execute(text("""
                with candidate as (
                  select id from public.jobs
                  where kind = any(:kinds)
                    and status in ('queued','failed')
                    and due_at<=now()
                    and (lease_until is null or lease_until<now())
                    and attempts < 8
                  order by due_at,id
                  for update skip locked
                  limit 1
                )
                update public.jobs j
                set status='leased', attempts=attempts+1,
                    lease_until=now()+(:lease || ' seconds')::interval,
                    lease_token=gen_random_uuid(), updated_at=now()
                from candidate
                where j.id=candidate.id
                returning j.id::text,j.organization_id::text,j.kind,j.payload,
                          j.attempts,j.lease_token::text
            """), {"kinds": list(kinds), "lease": lease_seconds}))
            return r

    def finish_job(self, job_id: str, lease_token: str, result: dict):
        with self.trusted() as c:
            c.execute(text("""
                update public.jobs set status='done',result=cast(:result as jsonb),
                  lease_until=null,lease_token=null,error=null,updated_at=now()
                where id=:id::uuid and lease_token=:lease::uuid
            """), {"id": job_id, "lease": lease_token, "result": json.dumps(result)})

    def fail_job(self, job_id: str, lease_token: str, error: str):
        with self.trusted() as c:
            c.execute(text("""
                update public.jobs
                set status=case when attempts>=8 then 'dead' else 'failed' end,
                    error=:error, due_at=now()+least(attempts*attempts,60)*interval '1 minute',
                    lease_until=null,lease_token=null,updated_at=now()
                where id=:id::uuid and lease_token=:lease::uuid
            """), {"id": job_id, "lease": lease_token, "error": error[:1000]})
