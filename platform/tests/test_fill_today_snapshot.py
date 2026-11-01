"""Synthetic offline / disposable PostgreSQL only. Not hosted Auth provisioning."""
import ast
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import uuid
from zoneinfo import ZoneInfo

import pytest
from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from fmc.common import DomainError
from fmc.config import Settings
from fmc.supabase_v1 import Actor, V1Store, one, rows
from fmc import fill_today_read as reader

# Frozen accepted 380a70a Today body. Test-only oracle, never runtime dual reads.
BASELINE_SOURCE = r'''
def today(org: str, request: Request, date: str):
    a = who(request)
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
    except Exception:
        raise DomainError("DATE", "Use YYYY-MM-DD.", 422)
    with db.user(a.id) as c:
        role(c, org, a)
        orgrow = one(c.execute(text("""
            select timezone,default_currency::text currency
            from public.organizations where id=cast(:org as uuid)
        """), {"org": org}))
        if not orgrow:
            raise DomainError("ORG_NOT_FOUND", "Organization not found.", 404)
        tz = ZoneInfo(orgrow["timezone"])
        begin = datetime(day.year, day.month, day.day, tzinfo=tz)
        finish = begin + timedelta(days=1)
        weekday = day.weekday()
        court_rows = rows(c.execute(text("""
            with active_courts as (
              select c.id,c.name
              from public.courts c
              join public.venues v on v.id=c.venue_id
              where v.organization_id=cast(:org as uuid) and c.active and v.active
            ),
            buckets as (
              select ac.id court_id,ac.name court_name,gs starts_at,gs+interval '30 minutes' ends_at,
                     (extract(hour from (gs at time zone :tz))::int*60
                      + extract(minute from (gs at time zone :tz))::int) local_minute
              from active_courts ac
              cross join generate_series(:begin,:finish-interval '30 minutes',interval '30 minutes') gs
            ),
            open_buckets as (
              select b.*
              from buckets b
              where exists (
                select 1 from public.court_rates r
                where r.court_id=b.court_id and r.active
                  and (r.weekday is null or r.weekday=:weekday)
                  and r.start_minute<=b.local_minute and r.end_minute>b.local_minute
              )
            ),
            court_metrics as (
              select ob.court_id,
                   min(ob.local_minute)::int open_start_minute,
                   (max(ob.local_minute)+30)::int open_end_minute,
                   count(*)::int*30 capacity_minutes,
                   count(*) filter (where exists (
                     select 1 from public.bookings bk
                     where bk.court_id=ob.court_id
                       and bk.status in ('confirmed','pending_payment')
                       and bk.starts_at<ob.ends_at and bk.ends_at>ob.starts_at
                   ))::int*30 booked_minutes,
                   count(*) filter (where exists (
                     select 1 from public.booking_holds h
                     where h.court_id=ob.court_id and h.expires_at>now()
                       and h.starts_at<ob.ends_at and h.ends_at>ob.starts_at
                   ))::int*30 held_minutes,
                   count(*) filter (where exists (
                     select 1 from public.court_blocks bl
                     where bl.court_id=ob.court_id
                       and bl.starts_at<ob.ends_at and bl.ends_at>ob.starts_at
                   ))::int*30 blocked_minutes,
                   (
                     select count(*)::int
                     from public.bookings bk
                     where bk.court_id=ob.court_id
                       and bk.status in ('confirmed','pending_payment')
                       and bk.starts_at>=:begin and bk.starts_at<:finish
                   ) bookings,
                   (
                     select count(*)::int
                     from public.bookings bk
                     where bk.court_id=ob.court_id
                       and bk.status='cancelled'
                       and bk.starts_at>=:begin and bk.starts_at<:finish
                   ) cancellations,
                   (
                     select coalesce(sum(bk.gross_amount_minor),0)::int
                     from public.bookings bk
                   where bk.court_id=ob.court_id
                     and bk.status in ('confirmed','pending_payment')
                     and bk.starts_at>=:begin and bk.starts_at<:finish
                   ) revenue_minor
              from open_buckets ob
              group by ob.court_id
            )
            select ac.id::text court_id,ac.name court_name,
                   coalesce(cm.open_start_minute,0)::int open_start_minute,
                   coalesce(cm.open_end_minute,0)::int open_end_minute,
                   coalesce(cm.capacity_minutes,0)::int capacity_minutes,
                   coalesce(cm.booked_minutes,0)::int booked_minutes,
                   coalesce(cm.held_minutes,0)::int held_minutes,
                   coalesce(cm.blocked_minutes,0)::int blocked_minutes,
                   coalesce(cm.bookings,0)::int bookings,
                   coalesce(cm.cancellations,0)::int cancellations,
                   coalesce(cm.revenue_minor,0)::int revenue_minor,
                   cm.court_id is not null has_rate_coverage
            from active_courts ac
            left join court_metrics cm on cm.court_id=ac.id
            order by ac.name
        """), {"org": org, "tz": orgrow["timezone"], "begin": begin, "finish": finish, "weekday": weekday}))
        sellable_windows = rows(c.execute(text("""
            with active_courts as (
              select c.id,c.name
              from public.courts c
              join public.venues v on v.id=c.venue_id
              where v.organization_id=cast(:org as uuid) and c.active and v.active
            ),
            buckets as (
              select ac.id court_id,ac.name court_name,gs starts_at,gs+interval '30 minutes' ends_at,
                     (extract(hour from (gs at time zone :tz))::int*60
                      + extract(minute from (gs at time zone :tz))::int) local_minute
              from active_courts ac
              cross join generate_series(:begin,:finish-interval '30 minutes',interval '30 minutes') gs
            ),
            open_buckets as (
              select b.*
              from buckets b
              where exists (
                select 1 from public.court_rates r
                where r.court_id=b.court_id and r.active
                  and (r.weekday is null or r.weekday=:weekday)
                  and r.start_minute<=b.local_minute and r.end_minute>b.local_minute
              )
            ),
            numbered as (
              select ob.*,row_number() over(partition by ob.court_id order by ob.starts_at) rn
              from open_buckets ob
            ),
            islands as (
              select n.*,n.starts_at-(n.rn*interval '30 minutes') grp
              from numbered n
            )
            select court_id::text,court_name,
                   min(starts_at) starts_at,max(ends_at) ends_at,
                   min(local_minute)::int start_minute,
                   (max(local_minute)+30)::int end_minute
            from islands
            group by court_id,court_name,grp
            order by court_name,starts_at
        """), {"org": org, "tz": orgrow["timezone"], "begin": begin, "finish": finish, "weekday": weekday}))
        windows_by_court = {}
        for window in sellable_windows:
            windows_by_court.setdefault(window["court_id"], []).append(window)
        empty_windows = rows(c.execute(text("""
            with active_courts as (
              select c.id,c.name
              from public.courts c
              join public.venues v on v.id=c.venue_id
              where v.organization_id=cast(:org as uuid) and c.active and v.active
            ),
            buckets as (
              select ac.id court_id,ac.name court_name,gs starts_at,gs+interval '30 minutes' ends_at,
                     (extract(hour from (gs at time zone :tz))::int*60
                      + extract(minute from (gs at time zone :tz))::int) local_minute
              from active_courts ac
              cross join generate_series(:begin,:finish-interval '30 minutes',interval '30 minutes') gs
            ),
            open_buckets as (
              select b.*
              from buckets b
              where exists (
                select 1 from public.court_rates r
                where r.court_id=b.court_id and r.active
                  and (r.weekday is null or r.weekday=:weekday)
                  and r.start_minute<=b.local_minute and r.end_minute>b.local_minute
              )
            ),
            free_buckets as (
              select ob.*,
                     row_number() over(partition by ob.court_id order by ob.starts_at) rn
              from open_buckets ob
              where not exists (
                select 1 from public.bookings bk
                where bk.court_id=ob.court_id
                  and bk.status in ('confirmed','pending_payment')
                  and bk.starts_at<ob.ends_at and bk.ends_at>ob.starts_at
              )
              and not exists (
                select 1 from public.booking_holds h
                where h.court_id=ob.court_id and h.expires_at>now()
                  and h.starts_at<ob.ends_at and h.ends_at>ob.starts_at
              )
              and not exists (
                select 1 from public.court_blocks bl
                where bl.court_id=ob.court_id
                  and bl.starts_at<ob.ends_at and bl.ends_at>ob.starts_at
              )
            ),
            islands as (
              select fb.*,
                     fb.starts_at - (fb.rn * interval '30 minutes') grp
              from free_buckets fb
            ),
            windows as (
              select court_id,court_name,
                     min(starts_at) starts_at,max(ends_at) ends_at,
                     count(*)::int*30 duration_minutes
              from islands
              group by court_id,court_name,grp
              having count(*) >= 2
            ),
            opportunities as (
              select w.court_id,w.starts_at window_start,d.duration_minutes,gs starts_at,
                     ((rate.price_minor*d.duration_minutes+59)/60)::int amount_minor,
                     rate.currency::text currency
              from windows w
              cross join (values (60),(90)) d(duration_minutes)
              cross join lateral generate_series(
                w.starts_at,
                w.ends_at-make_interval(mins=>d.duration_minutes),
                interval '30 minutes'
              ) gs
              join lateral (
                select r.price_minor,r.currency
                from public.court_rates r
                where r.court_id=w.court_id and r.active
                  and (
                    r.weekday is null or
                    r.weekday=(extract(isodow from (gs at time zone :tz))::int-1)
                  )
                  and r.start_minute<=(
                    extract(hour from (gs at time zone :tz))::int*60
                    + extract(minute from (gs at time zone :tz))::int
                  )
                  and r.end_minute>(
                    extract(hour from (gs at time zone :tz))::int*60
                    + extract(minute from (gs at time zone :tz))::int
                  )
                order by r.priority asc,r.created_at desc
                limit 1
              ) rate on true
            )
            select w.court_id::text,w.court_name,w.starts_at,w.ends_at,w.duration_minutes,
                   count(*) filter (where o.duration_minutes=60)::int bookable_60_count,
                   min(o.amount_minor) filter (where o.duration_minutes=60)::int min_60_amount_minor,
                   max(o.amount_minor) filter (where o.duration_minutes=60)::int max_60_amount_minor,
                   count(*) filter (where o.duration_minutes=90)::int bookable_90_count,
                   min(o.amount_minor) filter (where o.duration_minutes=90)::int min_90_amount_minor,
                   max(o.amount_minor) filter (where o.duration_minutes=90)::int max_90_amount_minor,
                   (array_agg(o.amount_minor order by o.amount_minor desc,o.duration_minutes desc,o.starts_at)
                     filter (where o.amount_minor is not null))[1]::int best_amount_minor,
                   (array_agg(o.duration_minutes order by o.amount_minor desc,o.duration_minutes desc,o.starts_at)
                     filter (where o.amount_minor is not null))[1]::int best_duration_minutes,
                   (array_agg(o.starts_at order by o.amount_minor desc,o.duration_minutes desc,o.starts_at)
                     filter (where o.amount_minor is not null))[1] best_starts_at,
                   (array_agg(o.currency order by o.amount_minor desc,o.duration_minutes desc,o.starts_at)
                     filter (where o.amount_minor is not null))[1] currency
            from windows w
            left join opportunities o
              on o.court_id=w.court_id and o.window_start=w.starts_at
            group by w.court_id,w.court_name,w.starts_at,w.ends_at,w.duration_minutes
            order by w.duration_minutes desc,w.starts_at
            limit 30
        """), {"org": org, "tz": orgrow["timezone"], "begin": begin, "finish": finish, "weekday": weekday}))
        bookable_60_starts = sum(int(x.get("bookable_60_count") or 0) for x in empty_windows)
        bookable_90_starts = sum(int(x.get("bookable_90_count") or 0) for x in empty_windows)
        best_quote = max(
            (x for x in empty_windows if x.get("best_amount_minor") is not None),
            key=lambda x: int(x.get("best_amount_minor") or 0),
            default=None,
        )
        financial = one(c.execute(text("""
            select
              count(*) filter (where status in ('confirmed','pending_payment'))::int bookings,
              count(*) filter (where status='cancelled')::int cancellations,
              coalesce(sum(gross_amount_minor) filter (where status in ('confirmed','pending_payment')),0)::int revenue_minor
            from public.bookings
            where organization_id=cast(:org as uuid)
              and starts_at>=:begin and starts_at<:finish
        """), {"org": org, "begin": begin, "finish": finish})) or {}
        capacity = sum(int(x["capacity_minutes"] or 0) for x in court_rows)
        booked = sum(int(x["booked_minutes"] or 0) for x in court_rows)
        held = sum(int(x["held_minutes"] or 0) for x in court_rows)
        blocked = sum(int(x["blocked_minutes"] or 0) for x in court_rows)
        courts_with_rate_coverage = sum(1 for x in court_rows if x.get("has_rate_coverage"))
        courts_without_rate_coverage = len(court_rows) - courts_with_rate_coverage
        for x in court_rows:
            x["sellable_windows"] = windows_by_court.get(x["court_id"], [])
            cap = int(x["capacity_minutes"] or 0)
            used = int(x["booked_minutes"] or 0)
            x["utilization_pct"] = round((used / cap * 100) if cap else 0, 1)
            x["empty_minutes"] = max(0, cap - used - int(x["held_minutes"] or 0) - int(x["blocked_minutes"] or 0))
        return {
            "date": date,
            "day_start": begin.isoformat(),
            "day_end": finish.isoformat(),
            "timezone": orgrow["timezone"],
            "currency": orgrow["currency"],
            "summary": {
                "capacity_minutes": capacity,
                "booked_minutes": booked,
                "held_minutes": held,
                "blocked_minutes": blocked,
                "empty_minutes": max(0, capacity - booked - held - blocked),
                "utilization_pct": round((booked / capacity * 100) if capacity else 0, 1),
                "bookings": int(financial.get("bookings") or 0),
                "cancellations": int(financial.get("cancellations") or 0),
                "revenue_minor": int(financial.get("revenue_minor") or 0),
                "active_courts": len(court_rows),
                "courts_with_rate_coverage": courts_with_rate_coverage,
                "courts_without_rate_coverage": courts_without_rate_coverage,
                "bookable_60_starts": bookable_60_starts,
                "bookable_90_starts": bookable_90_starts,
                "highest_single_quote_minor": int((best_quote or {}).get("best_amount_minor") or 0),
                "highest_single_quote_duration_minutes": (
                    int((best_quote or {}).get("best_duration_minutes"))
                    if (best_quote or {}).get("best_duration_minutes") is not None else None
                ),
            },
            "courts": court_rows,
            "empty_windows": empty_windows,
        }
'''.strip('\n')
BASELINE_SHA256 = 'ee636d71da4994e03034f5d0bf6e48eb3ac428ef0757d0657defc14952873755'

DAY = "2030-01-15"
NOW = datetime(2030, 1, 15, tzinfo=timezone.utc)
ID = lambda n: str(uuid.UUID(int=n))


def baseline(db, actor, org, date=DAY):
    assert hashlib.sha256(BASELINE_SOURCE.encode()).hexdigest() == BASELINE_SHA256
    namespace = dict(globals(), db=db, who=lambda _: actor,
                     role=lambda c, org, a: db.require_role(c, org, a.id))
    exec(compile(BASELINE_SOURCE, "<accepted-380-Today-test-only>", "exec"), namespace)
    return namespace["today"](org, None, date)


def native_payload():
    court = {"court_id": ID(1), "court_name": "PUBLIC_COURT", "open_start_minute": 360,
             "open_end_minute": 1080, "capacity_minutes": 720, "booked_minutes": 90,
             "held_minutes": 30, "blocked_minutes": 60, "bookings": 2, "cancellations": 1,
             "revenue_minor": 4000, "has_rate_coverage": True}
    sell = {"court_id": ID(1), "court_name": "PUBLIC_COURT", "starts_at": NOW+timedelta(hours=6),
            "ends_at": NOW+timedelta(hours=18), "start_minute": 360, "end_minute": 1080}
    empty = {"court_id": ID(1), "court_name": "PUBLIC_COURT", "starts_at": NOW+timedelta(hours=14),
             "ends_at": NOW+timedelta(hours=18), "duration_minutes": 240,
             "bookable_60_count": 7, "min_60_amount_minor": 2400, "max_60_amount_minor": 2400,
             "bookable_90_count": 6, "min_90_amount_minor": 3600, "max_90_amount_minor": 3600,
             "best_amount_minor": 3600, "best_duration_minutes": 90,
             "best_starts_at": NOW+timedelta(hours=16), "currency": "EUR"}
    return {"court_rows": [court], "sellable_windows": [sell], "empty_windows": [empty],
            "financial": {"bookings": 3, "cancellations": 1, "revenue_minor": 5500}}


class Result:
    def __init__(self, values): self.values = values
    def mappings(self): return self
    def first(self): return self.values[0] if self.values else None
    def __iter__(self): return iter(self.values)


class FakeConnection:
    def __init__(self, payload=None):
        self.payload, self.calls = payload or native_payload(), []
        self.member, self.org, self.hook = "owner", {"timezone": "Europe/Lisbon", "currency": "EUR"}, None
        self.legacy_index = 0
    def execute(self, statement, params=None):
        self.calls.append((statement, params))
        if statement is reader.SCOPE:
            return Result([{"membership_role": self.member, "organization": self.org}])
        if statement is reader.SNAPSHOT:
            if self.hook: self.hook()
            if not self.member: return Result([])
            return Result([json.loads(json.dumps(self.payload, default=lambda x: x.isoformat()))])
        sql = str(statement).strip().lower()
        if "set_config(" in sql or sql.startswith("set "):
            return Result([])
        if sql.startswith("select role::text"):
            return Result([{"role": self.member}] if self.member else [])
        if sql.startswith("select timezone,"):
            return Result([self.org] if self.org else [])
        key = ("court_rows", "sellable_windows", "empty_windows", "financial")[self.legacy_index]
        self.legacy_index += 1
        value = deepcopy(self.payload[key])
        return Result([value] if key == "financial" else value)


def fake_store(connection):
    @contextmanager
    def begin(): yield connection
    db = object.__new__(V1Store)
    db.engine = SimpleNamespace(begin=begin)
    return db


def test_complete_native_payload_matches_accepted_reference_and_five_calls():
    old, new = FakeConnection(), FakeConnection()
    expected = baseline(fake_store(old), Actor(ID(11)), ID(12))
    actual = reader.read_today(fake_store(new), Actor(ID(11)), ID(12), DAY, NOW.date())
    assert actual == expected and jsonable_encoder(actual) == jsonable_encoder(expected)
    assert len(old.calls) == 9 and len(new.calls) == 5
    assert new.calls[-2][0] is reader.SCOPE and new.calls[-1][0] is reader.SNAPSHOT
    assert new.calls[-2][1] == {"org": ID(12), "uid": ID(11)}
    assert [str(x[0]) for x in new.calls[:3]] == [str(x[0]) for x in old.calls[:3]]
    assert new.calls[1][1] == {"uid": ID(11)}
    assert new.calls[-1][1]["begin"].tzinfo is not None
    assert isinstance(actual["courts"][0]["sellable_windows"][0]["starts_at"], datetime)
    # Organization finance is not a sum over active-court/window rows.
    assert actual["summary"]["revenue_minor"] == 5500


@pytest.mark.parametrize("member,org,status", [(None, None, 403), (None, {"timezone":"SECRET"}, 403), ("owner", None, 404)])
def test_scope_error_order_matches_baseline_and_never_reads_data(member, org, status):
    for optimized in (False, True):
        c = FakeConnection()
        c.member, c.org = member, org
        with pytest.raises(DomainError) as rejected:
            if optimized: reader.read_today(fake_store(c), Actor(ID(11)), ID(12), DAY, NOW.date())
            else: baseline(fake_store(c), Actor(ID(11)), ID(12))
        assert rejected.value.status == status and "SECRET" not in str(rejected.value)
        assert all(stmt is not reader.SNAPSHOT for stmt, _ in c.calls)


def test_nullable_quotes_and_empty_payload_preserve_complete_reference():
    for empty in (False,True):
        data=native_payload()
        if empty:
            data.update(court_rows=[],sellable_windows=[],empty_windows=[],financial={"bookings":0,"cancellations":0,"revenue_minor":0})
        else:
            window=data["empty_windows"][0]
            for key in ("min_60_amount_minor","max_60_amount_minor","min_90_amount_minor","max_90_amount_minor","best_amount_minor","best_duration_minutes","best_starts_at","currency"): window[key]=None
            window.update(bookable_60_count=0,bookable_90_count=0)
        expected=baseline(fake_store(FakeConnection(deepcopy(data))),Actor(ID(11)),ID(12))
        actual=reader.read_today(fake_store(FakeConnection(deepcopy(data))),Actor(ID(11)),ID(12),DAY,NOW.date())
        assert expected==actual and actual["summary"]["highest_single_quote_duration_minutes"] is None


@pytest.mark.parametrize("kind", ["bool-as-int", "naive-time", "unknown-field", "invalid-id", "wrong-finance", "missing-array"])
def test_malformed_aggregated_payload_is_unavailable_without_raw_values(kind):
    data = json.loads(json.dumps(native_payload(), default=lambda x: x.isoformat()))
    if kind == "bool-as-int": data["court_rows"][0]["capacity_minutes"] = True
    elif kind == "naive-time": data["sellable_windows"][0]["starts_at"] = "2030-01-15T06:00:00"
    elif kind == "unknown-field": data["court_rows"][0]["PRIVATE_SENTINEL"] = "NEVER_PRINT"
    elif kind == "invalid-id": data["court_rows"][0]["court_id"] = "NEVER_PRINT"
    elif kind == "wrong-finance": data["financial"]["revenue_minor"] = "NEVER_PRINT"
    else: data["empty_windows"] = None
    with pytest.raises(DomainError) as rejected: reader.decode(data)
    assert rejected.value.status == 503 and "NEVER_PRINT" not in str(rejected.value)


@pytest.mark.parametrize("day,hours", [("2030-03-31",23),("2030-10-27",25),(DAY,24)])
def test_zoneinfo_day_bounds_are_unchanged(day, hours):
    c = FakeConnection()
    value = reader.read_today(fake_store(c), Actor(ID(11)), ID(12), day, datetime.strptime(day,"%Y-%m-%d").date())
    begin, finish = (datetime.fromisoformat(value[k]) for k in ("day_start","day_end"))
    assert (finish.astimezone(timezone.utc)-begin.astimezone(timezone.utc)).total_seconds()/3600 == hours


@pytest.mark.parametrize("failure", ["none", "revoked", "expired", "stopped", "health", "isolation", "identity", "oversize"])
def test_actual_today_route_retains_fresh_auth_and_final_guard(failure, monkeypatch):
    import httpx
    from fmc import v1_app as v
    from fmc import fill_uat_guard as g
    from fmc.supabase_v1 import SupabaseAuth
    from test_fill_uat_guard import Ledger
    seconds = [0]
    clock = SimpleNamespace(wall=lambda: NOW+timedelta(seconds=seconds[0]),tick=lambda: seconds[0])
    spec = {"run_id": ID(20), "candidate_sha":"a"*40, "project_ref":g.PROJECT,
            "organization_ids":sorted(g.ORGANIZATIONS),"starts_at":NOW.isoformat(),
            "expires_at":(NOW+timedelta(seconds=1800)).isoformat(),"principals":[
                {"id":ID(11),"label":"a","ban_at":(NOW+timedelta(seconds=1200)).isoformat(),
                 "expires_at":(NOW+timedelta(seconds=1800)).isoformat()}]}
    lease = g.Lease.parse(spec)
    ledger = Ledger(clock, spec)
    guard = g.Guard(lease, ledger, SimpleNamespace(close=lambda:None), clock=clock.wall,monotonic=clock.tick)
    c = FakeConnection()
    def after_data():
        if failure == "expired": seconds[0] = 1801
        elif failure == "health": seconds[0] = 46
        elif failure == "stopped": ledger.row["stopped"] = True
        elif failure == "isolation": ledger.row["isolated"] = False
        elif failure == "oversize": c.payload["court_rows"][0]["court_name"] = "PRIVATE_TODAY"+"x"*g.MAX_RESPONSE
    c.hook = after_data
    calls = []
    def authority(request):
        calls.append(request)
        if len(calls)>1 and failure=="revoked": return httpx.Response(401)
        return httpx.Response(200,json={"id":ID(99) if len(calls)>1 and failure=="identity" else ID(11),
             "app_metadata":{"fill_f1_run":ID(20),"fictional":True}})
    monkeypatch.setattr(v,"V1Store",lambda _:fake_store(c))
    monkeypatch.setattr(v,"fill_guard_from_environment",lambda *_:guard)
    monkeypatch.setenv("FILL_UAT_SERVER_VALIDATOR","off")
    with httpx.Client(transport=httpx.MockTransport(authority)) as http:
        auth = SupabaseAuth("https://auth.example.invalid","PUBLIC_SENTINEL",http=http)
        client = TestClient(v.create_v1_app(Settings(database="postgresql://unused",environment="test"),"operations",auth))
        response = client.get(f"/api/fmc/{ID(12)}/today",params={"date":DAY},headers={"Authorization":"Bearer PUBLIC_TOKEN"})
    assert len(calls)==2 and response.headers["cache-control"]=="no-store"
    assert response.status_code == (200 if failure=="none" else 403)
    if failure!="none": assert "PUBLIC_COURT" not in response.text and "PRIVATE_TODAY" not in response.text


def fixture_engine(url, opt_in):
    from test_fill_provenance_uat import fixture_database
    return create_engine(fixture_database(url,opt_in))


@pytest.mark.parametrize("url,opt", [
    ("postgresql+psycopg://user:PRIVATE@remote.invalid/fmc_test","ci-local-only"),
    ("postgresql+psycopg://user@localhost/production","ci-local-only"),
    ("postgresql+psycopg://user@localhost/fmc_test?host=remote.invalid","ci-local-only"),
    ("postgresql+psycopg://user@localhost/fmc_test",""),
    ("sqlite:///fmc_test","ci-local-only"),("invalid","ci-local-only"),
])
def test_fixture_target_guard_runs_before_engine(url,opt,monkeypatch):
    monkeypatch.setattr(f"{__name__}.create_engine",lambda *a,**k:pytest.fail("engine forbidden"))
    with pytest.raises(ValueError) as rejected: fixture_engine(url,opt)
    assert "PRIVATE" not in str(rejected.value) and url not in str(rejected.value)


@pytest.mark.parametrize("authenticated,status", [(False,401),(True,422)])
def test_route_keeps_auth_before_date_and_date_before_database(authenticated,status,monkeypatch):
    from fmc import v1_app as v
    c, auth_calls = FakeConnection(), []
    def verify(_):
        auth_calls.append(1)
        if not authenticated: raise DomainError("AUTH_REQUIRED","Sign in is required.",401)
        return Actor(ID(11))
    monkeypatch.setattr(v,"V1Store",lambda _:fake_store(c))
    for key in ("FILL_UAT_GUARD","FILL_UAT_BOOTSTRAP","FILL_UAT_SERVER_VALIDATOR"): monkeypatch.setenv(key,"off")
    app=v.create_v1_app(Settings(database="postgresql://unused",environment="test"),"operations",SimpleNamespace(verify=verify))
    response=TestClient(app).get(f"/api/fmc/{ID(12)}/today?date=invalid")
    assert response.status_code==status and auth_calls==[1] and not c.calls
    core=v.create_v1_app(Settings(database="postgresql://unused",environment="test"),"core",SimpleNamespace(verify=verify))
    assert not any(route.path.endswith("/today") for route in core.routes)


@pytest.fixture
def pg():
    url=os.environ.get("TEST_DATABASE_URL")
    if not url: pytest.skip("Disposable local/CI PostgreSQL only, never staging")
    opt=os.environ.get("FILL_TODAY_SNAPSHOT_FIXTURES")
    if os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("GITHUB_JOB")=="contract": opt="ci-local-only"
    engine=fixture_engine(url,opt)
    with engine.connect() as c:
        tx=c.begin()
        calls=[]
        hooks={}
        class Recorder:
            def execute(self,statement,params=None):
                calls.append((statement,params))
                if statement is reader.SNAPSHOT and hooks.get("before_data"): hooks["before_data"]()
                return c.execute(statement,params or {})
        class ConnectionEngine:
            @contextmanager
            def begin(self): yield Recorder()
        db=object.__new__(V1Store)
        db.engine=ConnectionEngine()
        try: yield SimpleNamespace(c=c,db=db,calls=calls,hooks=hooks)
        finally: tx.rollback()
    engine.dispose()


def seed(pg,day,zone,mode="mixed"):
    """Isolated synthetic SQL contract fixtures; transaction always rolls back."""
    c=pg.c
    users=[str(uuid.uuid4()) for _ in range(4)]
    orgs=[str(uuid.uuid4()) for _ in range(2)]
    venues=[str(uuid.uuid4()) for _ in range(3)]
    for uid in users: c.execute(text("insert into auth.users(id) values(cast(:id as uuid))"),{"id":uid})
    for n,org in enumerate(orgs):
        c.execute(text("insert into public.organizations(id,slug,name,timezone,default_currency) values(cast(:id as uuid),:slug,'SYNTHETIC',:tz,'EUR')"),
                  {"id":org,"slug":"snapshot-"+org,"tz":zone if n==0 else "America/New_York"})
    for uid,org,role in ((users[0],orgs[0],"owner"),(users[1],orgs[0],"manager"),(users[2],orgs[1],"owner")):
        c.execute(text("insert into public.organization_members(organization_id,user_id,role) values(cast(:o as uuid),cast(:u as uuid),cast(:r as public.fmc_member_role))"),{"o":org,"u":uid,"r":role})
    for n,venue in enumerate(venues):
        c.execute(text("insert into public.venues(id,organization_id,name,active) values(cast(:id as uuid),cast(:o as uuid),'SYNTHETIC',:active)"),
                  {"id":venue,"o":orgs[1] if n==2 else orgs[0],"active":n!=1})
    count=34 if mode=="limit" else 6 if mode!="empty" else 0
    courts=[]
    for n in range(count):
        uid=str(uuid.uuid4()); courts.append(uid)
        venue=venues[2] if n==5 and mode!="limit" else venues[1] if n==4 and mode!="limit" else venues[0]
        c.execute(text("insert into public.courts(id,venue_id,name,sport,active,inventory_mode,native_write_enabled) values(cast(:id as uuid),cast(:v as uuid),:name,'padel',:active,'native',true)"),
                  {"id":uid,"v":venue,"name":f"Court {n:03}","active":n!=3 or mode=="limit"})
        if n==2 and mode!="limit": continue  # visible active court without rates
        org=orgs[1] if venue==venues[2] else orgs[0]
        ranges=[(0,1440)] if mode=="dst" else [(n*30,1440)] if mode=="limit" else [(360,720),(780,1410)]
        for start,end in ranges:
            c.execute(text("insert into public.court_rates(organization_id,court_id,start_minute,end_minute,price_minor,currency,priority) values(cast(:o as uuid),cast(:c as uuid),:s,:e,2400,'EUR',100)"),{"o":org,"c":uid,"s":start,"e":end})
        if mode=="mixed":
            c.execute(text("insert into public.court_rates(organization_id,court_id,start_minute,end_minute,price_minor,currency,priority) values(cast(:o as uuid),cast(:c as uuid),360,1410,1200,'EUR',10)"),{"o":org,"c":uid})
    base=datetime.strptime(day,"%Y-%m-%d").replace(tzinfo=ZoneInfo(zone))
    if courts and mode not in ("limit",):
        # Duplicate overlapping confirmed records remain one occupied bucket.
        for n,(court,status,start,end,amount) in enumerate([
            (0,"confirmed",10,11.5,3600),(0,"confirmed",10.5,11.5,1500),
            (0,"cancelled",13,14,2400),(1,"pending_payment",15,16,2400),
            (3,"confirmed",10,11,1700),(4,"confirmed",10,11,1900),
            (5,"confirmed",10,11,9000),(0,"confirmed",-.5,.5,700)]):
            org=orgs[1] if court==5 else orgs[0]
            venue=venues[2] if court==5 else venues[1] if court==4 else venues[0]
            c.execute(text("insert into public.bookings(organization_id,venue_id,court_id,status,starts_at,ends_at,currency,gross_amount_minor,source,idempotency_key) values(cast(:o as uuid),cast(:v as uuid),cast(:c as uuid),cast(:status as public.fmc_booking_status),:s,:e,'EUR',:amount,'fmc',:key)"),
                      {"o":org,"v":venue,"c":courts[court],"status":status,"s":base+timedelta(hours=start),"e":base+timedelta(hours=end),"amount":amount,"key":"fixture-"+str(n)})
        for n,(start,end,live) in enumerate([(11,12,True),(14,15,False)]):
            c.execute(text("insert into public.booking_holds(organization_id,court_id,starts_at,ends_at,expires_at,idempotency_key) values(cast(:o as uuid),cast(:c as uuid),:s,:e,now()+make_interval(secs=>:expiry),:key)"),
                      {"o":orgs[0],"c":courts[0],"s":base+timedelta(hours=start),"e":base+timedelta(hours=end),"expiry":86400 if live else -1,"key":"hold-"+str(n)})
        c.execute(text("insert into public.court_blocks(organization_id,court_id,starts_at,ends_at,reason) values(cast(:o as uuid),cast(:c as uuid),:s,:e,'SYNTHETIC')"),
                  {"o":orgs[0],"c":courts[0],"s":base+timedelta(hours=11.5),"e":base+timedelta(hours=12.5)})
    return SimpleNamespace(users=users,orgs=orgs,courts=courts,day=base.date())


@pytest.mark.parametrize("day,zone,mode", [
    (DAY,"Europe/Lisbon","mixed"), (DAY,"America/New_York","mixed"),
    (DAY,"Europe/Lisbon","split"),
    ("2030-03-31","Europe/Lisbon","dst"),("2030-10-27","Europe/Lisbon","dst"),
    (DAY,"Europe/Lisbon","empty"),(DAY,"Europe/Lisbon","limit"),
])
def test_postgres_complete_reference_parity_and_no_multiplied_finance(pg,day,zone,mode):
    e=seed(pg,day,zone,mode)
    a=Actor(e.users[0])
    expected=baseline(pg.db,a,e.orgs[0],day)
    assert len(pg.calls)==9
    pg.calls.clear()
    actual=reader.read_today(pg.db,a,e.orgs[0],day,e.day)
    assert len(pg.calls)==5 and pg.calls[-2][0] is reader.SCOPE and pg.calls[-1][0] is reader.SNAPSHOT
    assert pg.calls[-1][1]["uid"]==a.id and pg.calls[-1][1]["org"]==e.orgs[0]
    assert actual==expected and jsonable_encoder(actual)==jsonable_encoder(expected)
    if mode=="mixed":
        assert actual["summary"]["revenue_minor"]==11100
        assert sum(x["revenue_minor"] for x in actual["courts"])==7500
        assert actual["summary"]["courts_without_rate_coverage"]==1
    if mode=="limit": assert len(actual["empty_windows"])==30
    if mode=="split":
        assert [(w["start_minute"],w["end_minute"]) for w in actual["courts"][0]["sellable_windows"]]==[(360,720),(780,1410)]


@pytest.mark.parametrize("user,org,denied", [(0,0,False),(1,0,False),(2,1,False),(0,1,True),(2,0,True),(3,0,True)])
def test_postgres_two_org_rls_and_owner_manager_outsider_parity(pg,user,org,denied):
    e=seed(pg,DAY,"Europe/Lisbon")
    actor=Actor(e.users[user])
    if denied:
        for fn in (lambda:baseline(pg.db,actor,e.orgs[org]),lambda:reader.read_today(pg.db,actor,e.orgs[org],DAY,e.day)):
            with pytest.raises(DomainError) as rejected: fn()
            assert rejected.value.status==403
    else:
        assert reader.read_today(pg.db,actor,e.orgs[org],DAY,e.day)==baseline(pg.db,actor,e.orgs[org])


def test_postgres_membership_removed_between_scope_and_data_fails_closed(pg):
    e=seed(pg,DAY,"Europe/Lisbon")
    def remove():
        pg.c.execute(text("reset role"))
        pg.c.execute(text("delete from public.organization_members where organization_id=cast(:o as uuid) and user_id=cast(:u as uuid)"),{"o":e.orgs[0],"u":e.users[0]})
        pg.c.execute(text("set local role authenticated"))
    pg.hooks["before_data"]=remove
    with pytest.raises(DomainError) as rejected:
        reader.read_today(pg.db,Actor(e.users[0]),e.orgs[0],DAY,e.day)
    assert rejected.value.status==403 and len(pg.calls)==5
