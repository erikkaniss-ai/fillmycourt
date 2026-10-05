"""Supabase-v1 production adapter.

The managed schema is the single source of truth. Client/operator requests are
authenticated against Supabase Auth. Trusted booking/worker transactions are
explicit and narrowly scoped; no schema mutation occurs at runtime.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
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
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        elif url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
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
            where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)
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
            select private.append_event(
              cast(:org as uuid),cast(:actor as uuid),:event_type,:entity_type,:entity_id,
              cast(:before as jsonb),cast(:after as jsonb),:request_id
            )
        """), {
            "org": org_id, "actor": actor_id, "event_type": event_type,
            "entity_type": entity_type, "entity_id": entity_id,
            "before": json.dumps(before) if before is not None else None,
            "after": json.dumps(after) if after is not None else None,
            "request_id": request_id,
        })

    def advisory_court_lock(self, c, court_id: str):
        c.execute(text("select pg_advisory_xact_lock(hashtextextended(:court,0))"), {"court": court_id})

    def ensure_person(self, c, org_id: str, actor: Actor) -> str:
        existing = one(c.execute(text("""
            select id::text from public.people
            where organization_id=cast(:org as uuid) and auth_user_id=cast(:uid as uuid)
            order by created_at limit 1
        """), {"org": org_id, "uid": actor.id}))
        if existing:
            return existing["id"]
        profile = one(c.execute(text("""
            select full_name,marketing_consent
            from public.player_profiles
            where user_id=cast(:uid as uuid)
        """), {"uid": actor.id}))
        r = one(c.execute(text("""
            insert into public.people
              (organization_id,auth_user_id,full_name,email,marketing_consent,source)
            values
              (cast(:org as uuid),cast(:uid as uuid),:full_name,:email,:marketing_consent,'getacourt')
            returning id::text
        """), {
            "org": org_id,
            "uid": actor.id,
            "full_name": profile["full_name"] if profile else None,
            "email": actor.email,
            "marketing_consent": profile["marketing_consent"] if profile else None,
        }))
        return r["id"]

    def active_conflict(self, c, court_id: str, starts_at: datetime, ends_at: datetime,
                        ignore_hold: str | None = None) -> bool:
        p = {"court": court_id, "a": starts_at, "b": ends_at, "ignore": ignore_hold}
        q = one(c.execute(text("""
            select exists(
              select 1 from public.bookings
              where court_id=cast(:court as uuid)
                and status in ('held','pending_payment','confirmed')
                and starts_at < :b and ends_at > :a
              union all
              select 1 from public.booking_holds
              where court_id=cast(:court as uuid) and expires_at > now()
                and (cast(:ignore as uuid) is null or id<>cast(:ignore as uuid))
                and starts_at < :b and ends_at > :a
              union all
              select 1 from public.court_blocks
              where court_id=cast(:court as uuid) and starts_at < :b and ends_at > :a
            ) as conflict
        """), p))
        return bool(q and q["conflict"])

    def quote(self, c, court_id: str, starts_at: datetime, duration_minutes: int):
        court = one(c.execute(text("""
            select c.id::text,c.venue_id::text,c.sport,c.indoor,c.inventory_mode::text,
                   c.native_write_enabled,v.organization_id::text,v.currency::text,v.timezone,v.name venue_name
            from public.courts c join public.venues v on v.id=c.venue_id
            where c.id=cast(:court as uuid) and c.active and v.active
        """), {"court": court_id}))
        if not court:
            raise DomainError("COURT_NOT_FOUND", "Court not found.", 404)
        local = starts_at.astimezone(ZoneInfo(court["timezone"]))
        weekday = local.weekday()
        minute = local.hour * 60 + local.minute
        rate = one(c.execute(text("""
            select price_minor,currency::text
            from public.court_rates
            where court_id=cast(:court as uuid) and active
              and (weekday is null or weekday=:weekday)
              and start_minute<=:minute and end_minute>:minute
            order by priority asc, created_at desc limit 1
        """), {"court": court_id, "weekday": weekday, "minute": minute}))
        if not rate:
            raise DomainError("NO_RATE", "No active rate covers this time.", 409)
        # Rates are stored per 60 minutes; calculate proportionally in integer cents.
        amount = (int(rate["price_minor"]) * int(duration_minutes) + 59) // 60
        return court, {"amount_minor": amount, "currency": rate["currency"], "duration_minutes": duration_minutes}

    def availability(self, date: str, start_time: str, end_time: str, sport: str,
                     duration: int, location: str = "", indoor: str = "all", limit: int = 200,
                     lat: float | None = None, lon: float | None = None, radius_km: float = 25):
        params = {
            "date": date,
            "time": start_time,
            "end_time": end_time,
            "sport": sport,
            "duration": duration,
            "location": location.strip().lower(),
            "loc": f"%{location.strip().lower()}%",
            "indoor": indoor.lower(),
            "limit": limit,
            "lat": lat,
            "lon": lon,
            "radius_km": radius_km,
        }
        with self.trusted() as c:
            return rows(c.execute(text("""
                with court_raw as (
                  select c.id,c.name,c.sport,c.indoor,c.venue_id,
                         v.name venue_name,v.timezone,v.currency,v.address,v.organization_id,
                         case when coalesce(v.address->>'lat','') ~ '^-?[0-9]+([.][0-9]+)?$'
                              then (v.address->>'lat')::double precision end as venue_lat,
                         case when coalesce(v.address->>'lon','') ~ '^-?[0-9]+([.][0-9]+)?$'
                              then (v.address->>'lon')::double precision end as venue_lon
                  from public.courts c
                  join public.venues v on v.id=c.venue_id
                  where c.active and v.active and c.sport=:sport
                    and c.inventory_mode='native' and c.native_write_enabled
                    and (:indoor='all'
                         or (:indoor='true' and c.indoor is true)
                         or (:indoor='false' and c.indoor is false))
                ),
                court_base as (
                  select cr.*,
                         case when cast(:lat as double precision) is not null and cast(:lon as double precision) is not null
                                   and cr.venue_lat is not null and cr.venue_lon is not null
                              then 6371.0 * 2.0 * asin(sqrt(
                                power(sin(radians(cr.venue_lat - cast(:lat as double precision))/2.0),2)
                                + cos(radians(cast(:lat as double precision))) * cos(radians(cr.venue_lat))
                                * power(sin(radians(cr.venue_lon - cast(:lon as double precision))/2.0),2)
                              ))
                         end as distance_km
                  from court_raw cr
                ),
                filtered as (
                  select * from court_base
                  where (
                    (cast(:lat as double precision) is not null and cast(:lon as double precision) is not null
                     and distance_km is not null and distance_km <= :radius_km)
                    or
                    ((cast(:lat as double precision) is null or cast(:lon as double precision) is null)
                     and (:location='' or lower(venue_name) like :loc or lower(address::text) like :loc))
                  )
                ),
                candidates as (
                  select cb.*,
                         gs as starts_at,
                         gs + make_interval(mins => cast(:duration as int)) as ends_at,
                         (extract(isodow from (gs at time zone cb.timezone))::int - 1) as weekday,
                         (extract(hour from (gs at time zone cb.timezone))::int * 60
                          + extract(minute from (gs at time zone cb.timezone))::int) as local_minute
                  from filtered cb
                  cross join lateral generate_series(
                    (cast(:date as date) + cast(:time as time)) at time zone cb.timezone,
                    ((cast(:date as date) + cast(:end_time as time)) at time zone cb.timezone)
                      - make_interval(mins => cast(:duration as int)),
                    interval '30 minutes'
                  ) gs
                )
                select x.id::text,x.name,x.sport,x.indoor,x.venue_id::text,
                       x.venue_name,x.timezone,x.currency::text,x.address,x.organization_id::text,
                       x.distance_km,x.starts_at,x.ends_at,
                       ((rate.price_minor * cast(:duration as int) + 59) / 60)::int as amount_minor,
                       cast(:duration as int) as duration_minutes
                from candidates x
                join lateral (
                  select cr.price_minor,cr.currency
                  from public.court_rates cr
                  where cr.court_id=x.id and cr.active
                    and (cr.weekday is null or cr.weekday=x.weekday)
                    and cr.start_minute<=x.local_minute
                    and cr.end_minute>x.local_minute
                  order by cr.priority asc,cr.created_at desc
                  limit 1
                ) rate on true
                where not exists (
                  select 1 from public.bookings b
                  where b.court_id=x.id
                    and b.status in ('held','pending_payment','confirmed')
                    and b.starts_at<x.ends_at and b.ends_at>x.starts_at
                )
                and not exists (
                  select 1 from public.booking_holds h
                  where h.court_id=x.id and h.expires_at>now()
                    and h.starts_at<x.ends_at and h.ends_at>x.starts_at
                )
                and not exists (
                  select 1 from public.court_blocks bl
                  where bl.court_id=x.id
                    and bl.starts_at<x.ends_at and bl.ends_at>x.starts_at
                )
                order by x.distance_km nulls last,x.venue_name,x.name,x.starts_at
                limit :limit
            """), params))

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
                where id=cast(:id as uuid) and lease_token=cast(:lease as uuid)
            """), {"id": job_id, "lease": lease_token, "result": json.dumps(result)})

    def fail_job(self, job_id: str, lease_token: str, error: str):
        with self.trusted() as c:
            c.execute(text("""
                update public.jobs
                set status=case when attempts>=8 then 'dead' else 'failed' end,
                    error=:error, due_at=now()+least(attempts*attempts,60)*interval '1 minute',
                    lease_until=null,lease_token=null,updated_at=now()
                where id=cast(:id as uuid) and lease_token=cast(:lease as uuid)
            """), {"id": job_id, "lease": lease_token, "error": error[:1000]})
