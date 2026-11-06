"""Read-only Today snapshot. Existing authenticated-role/RLS context is mandatory.

Two result statements; no clients, engine, caches, writers or import-time I/O.
No hosted performance/SLA or timeout-cause claim follows from this structure.
"""
from datetime import datetime, timedelta
import uuid
from zoneinfo import ZoneInfo

from sqlalchemy import text

from .common import DomainError
from .supabase_v1 import one


SCOPE = text("""
    select
      (select role::text from public.organization_members
       where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)) as membership_role,
      (select jsonb_build_object('timezone',timezone,'currency',default_currency::text)
       from public.organizations where id=cast(:org as uuid)) as organization
""")

# Common buckets are evaluated once. Each result is independently aggregated:
# financial totals cannot multiply with court/window rows.
SNAPSHOT = text("""
with active_courts as materialized (
  select c.id,c.name
  from public.courts c
  join public.venues v on v.id=c.venue_id
  where v.organization_id=cast(:org as uuid) and c.active and v.active
),
buckets as materialized (
  select ac.id court_id,ac.name court_name,gs starts_at,gs+interval '30 minutes' ends_at,
         (extract(hour from (gs at time zone :tz))::int*60
          + extract(minute from (gs at time zone :tz))::int) local_minute
  from active_courts ac
  cross join generate_series(:begin,:finish-interval '30 minutes',interval '30 minutes') gs
),
open_buckets as materialized (
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
),
courts as (
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
),
sell_numbered as (
  select ob.*,row_number() over(partition by ob.court_id order by ob.starts_at) rn
  from open_buckets ob
),
sell_islands as (
  select n.*,n.starts_at-(n.rn*interval '30 minutes') grp
  from sell_numbered n
),
sellable as (
select court_id::text,court_name,
       min(starts_at) starts_at,max(ends_at) ends_at,
       min(local_minute)::int start_minute,
       (max(local_minute)+30)::int end_minute
from sell_islands
group by court_id,court_name,grp
order by court_name,starts_at
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
free_islands as (
  select fb.*,
         fb.starts_at - (fb.rn * interval '30 minutes') grp
  from free_buckets fb
),
free_windows as (
  select court_id,court_name,
         min(starts_at) starts_at,max(ends_at) ends_at,
         count(*)::int*30 duration_minutes
  from free_islands
  group by court_id,court_name,grp
  having count(*) >= 2
),
opportunities as (
  select w.court_id,w.starts_at window_start,d.duration_minutes,gs starts_at,
         ((rate.price_minor*d.duration_minutes+59)/60)::int amount_minor,
         rate.currency::text currency
  from free_windows w
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
),
empty_windows as (
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
from free_windows w
left join opportunities o
  on o.court_id=w.court_id and o.window_start=w.starts_at
group by w.court_id,w.court_name,w.starts_at,w.ends_at,w.duration_minutes
order by w.duration_minutes desc,w.starts_at
limit 30
),
financial as (
select
  count(*) filter (where status in ('confirmed','pending_payment'))::int bookings,
  count(*) filter (where status='cancelled')::int cancellations,
  (case when coalesce(bool_and(currency = :report_currency) filter (where status in ('confirmed','pending_payment')), true)
      then coalesce(sum(gross_amount_minor) filter (where status in ('confirmed','pending_payment')),0)
      else null end)::int revenue_minor
from public.bookings
where organization_id=cast(:org as uuid)
  and starts_at>=:begin and starts_at<:finish
)
select
  coalesce((select jsonb_agg(to_jsonb(x) order by court_name) from courts x),'[]'::jsonb) as court_rows,
  coalesce((select jsonb_agg(to_jsonb(x) order by court_name,starts_at) from sellable x),'[]'::jsonb) as sellable_windows,
  coalesce((select jsonb_agg(to_jsonb(x) order by duration_minutes desc,starts_at) from empty_windows x),'[]'::jsonb) as empty_windows,
  (select to_jsonb(x) from financial x) as financial
from public.organization_members current_member
where current_member.organization_id=cast(:org as uuid)
  and current_member.user_id=cast(:uid as uuid)
""")


def decode(value):
    """Restore native timestamp values; do not coerce malformed JSON silently."""
    try:
        if not isinstance(value, dict) or set(value) != {"court_rows", "sellable_windows", "empty_windows", "financial"}:
            raise ValueError()
        result = {}
        definitions = {
            "court_rows": ("open_start_minute open_end_minute capacity_minutes booked_minutes held_minutes blocked_minutes bookings cancellations revenue_minor", "", "", "has_rate_coverage"),
            "sellable_windows": ("start_minute end_minute", "", "starts_at ends_at", ""),
            "empty_windows": ("duration_minutes bookable_60_count bookable_90_count", "min_60_amount_minor max_60_amount_minor min_90_amount_minor max_90_amount_minor best_amount_minor best_duration_minutes", "starts_at ends_at best_starts_at", "currency"),
        }
        for name, (ints, nullable, dates, other) in definitions.items():
            items = value[name]
            if not isinstance(items, list):
                raise ValueError()
            expected = {"court_id", "court_name", *ints.split(), *nullable.split(), *dates.split(), *other.split()}
            result[name] = []
            for item in items:
                if not isinstance(item, dict) or set(item) != expected:
                    raise ValueError()
                row = dict(item)
                if str(uuid.UUID(row["court_id"])) != row["court_id"] or not isinstance(row["court_name"], str):
                    raise ValueError()
                for key in ints.split()+nullable.split():
                    if not (row[key] is None and key in nullable.split()) and type(row[key]) is not int:
                        raise ValueError()
                for key in dates.split():
                    if row[key] is None and key == "best_starts_at":
                        continue
                    if not isinstance(row[key], str):
                        raise ValueError()
                    row[key] = datetime.fromisoformat(row[key].replace("Z", "+00:00"))
                    if row[key].tzinfo is None:
                        raise ValueError()
                if other == "has_rate_coverage" and type(row[other]) is not bool:
                    raise ValueError()
                if other == "currency" and row[other] is not None and not isinstance(row[other], str):
                    raise ValueError()
                result[name].append(row)
        financial = value["financial"]
        if (not isinstance(financial, dict) or set(financial) != {"bookings", "cancellations", "revenue_minor"}
                or any(type(x) is not int for x in financial.values())):
            raise ValueError()
        result["financial"] = dict(financial)
        return result
    except (ValueError, KeyError, TypeError, AttributeError):
        raise DomainError("TODAY_UNAVAILABLE", "Today data could not be verified.", 503) from None


def read_today(db, actor, org, date, day):
    with db.user(actor.id) as c:
        scope = one(c.execute(SCOPE, {"org": org, "uid": actor.id}))
        if not scope or not scope["membership_role"]:
            raise DomainError("FORBIDDEN", "You are not a member of this organization.", 403)
        orgrow = scope["organization"]
        if orgrow is None:
            raise DomainError("ORG_NOT_FOUND", "Organization not found.", 404)
        tz = ZoneInfo(orgrow["timezone"])
        begin = datetime(day.year, day.month, day.day, tzinfo=tz)
        finish = begin + timedelta(days=1)
        snapshot = one(c.execute(SNAPSHOT, {"org": org, "uid": actor.id, "tz": orgrow["timezone"], "begin": begin, "finish": finish, "weekday": day.weekday(), "report_currency": orgrow["currency"]}))
        if snapshot is None:
            # Membership is fresh in the same data statement, not a cached role
            # from metadata lookup. RLS remains active throughout both reads.
            raise DomainError("FORBIDDEN", "You are not a member of this organization.", 403)
        data = decode(snapshot)
        court_rows, sellable_windows, empty_windows, financial = (data[k] for k in ("court_rows", "sellable_windows", "empty_windows", "financial"))
        windows_by_court = {}
        for window in sellable_windows:
            windows_by_court.setdefault(window["court_id"], []).append(window)
        bookable_60_starts = sum(int(x.get("bookable_60_count") or 0) for x in empty_windows)
        bookable_90_starts = sum(int(x.get("bookable_90_count") or 0) for x in empty_windows)
        best_quote = max(
            (x for x in empty_windows if x.get("best_amount_minor") is not None),
            key=lambda x: int(x.get("best_amount_minor") or 0),
            default=None,
        )
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
