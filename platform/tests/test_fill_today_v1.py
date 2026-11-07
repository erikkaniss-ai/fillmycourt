import os
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from fmc.common import DomainError
from fmc.config import Settings
from fmc.supabase_v1 import Actor, V1Store
from fmc.v1_app import create_v1_app


class StaticAuth:
    def __init__(self, user_id: str):
        self.actor = Actor(id=user_id, email="owner@example.test")

    def verify(self, authorization: str | None):
        if authorization != "Bearer ci-owner-token":
            raise DomainError("AUTH_REQUIRED", "Sign in is required.", 401)
        return self.actor


@pytest.fixture()
def fill_today():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not configured")
    store = V1Store(url)
    user_id, org_id, venue_id, court_id = [str(uuid.uuid4()) for _ in range(4)]
    slug = "today-" + org_id[:8]
    with store.trusted() as c:
        c.execute(text("insert into auth.users(id) values(cast(:uid as uuid))"), {"uid": user_id})
        c.execute(text("""
            insert into public.organizations(id,slug,name,timezone,default_currency)
            values(cast(:org as uuid),:slug,'Today CI','Europe/Lisbon','EUR')
        """), {"org": org_id, "slug": slug})
        c.execute(text("""
            insert into public.organization_members(organization_id,user_id,role)
            values(cast(:org as uuid),cast(:uid as uuid),'owner')
        """), {"org": org_id, "uid": user_id})
        c.execute(text("""
            insert into public.venues(id,organization_id,name,timezone,currency,address)
            values(cast(:venue as uuid),cast(:org as uuid),'Today Venue','Europe/Lisbon','EUR',
                   cast(:address as jsonb))
        """), {"venue": venue_id, "org": org_id,
                "address": '{"city":"Cascais","lat":38.6979,"lon":-9.4215}'})
        c.execute(text("""
            insert into public.courts(id,venue_id,name,sport,indoor,inventory_mode,native_write_enabled)
            values(cast(:court as uuid),cast(:venue as uuid),'Today Court','padel',true,'native',true)
        """), {"court": court_id, "venue": venue_id})
        c.execute(text("""
            insert into public.court_rates(organization_id,court_id,weekday,start_minute,end_minute,
                                           price_minor,currency,priority)
            values(cast(:org as uuid),cast(:court as uuid),null,360,1410,2400,'EUR',100)
        """), {"org": org_id, "court": court_id})
        c.execute(text("""
            insert into public.bookings(organization_id,venue_id,court_id,status,starts_at,ends_at,
                                        currency,gross_amount_minor,source,idempotency_key)
            values
              (cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),'confirmed',
               '2026-10-05 10:00:00+01','2026-10-05 11:30:00+01','EUR',3600,'getacourt','today-confirmed'),
              (cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),'cancelled',
               '2026-10-05 13:00:00+01','2026-10-05 14:00:00+01','EUR',2400,'getacourt','today-cancelled')
        """), {"org": org_id, "venue": venue_id, "court": court_id})
        c.execute(text("""
            insert into public.court_blocks(organization_id,court_id,starts_at,ends_at,reason,created_by)
            values(cast(:org as uuid),cast(:court as uuid),
                   '2026-10-05 12:00:00+01','2026-10-05 13:00:00+01','maintenance',cast(:uid as uuid))
        """), {"org": org_id, "court": court_id, "uid": user_id})
    yield url, store, user_id, org_id, court_id
    with store.trusted() as c:
        c.execute(text("select set_config('fmc.allow_delivery_purge','on',true)"))
        c.execute(text("select set_config('fmc.allow_finance_purge','on',true)"))
        c.execute(text("delete from public.organizations where id=cast(:org as uuid)"), {"org": org_id})
        c.execute(text("delete from auth.users where id=cast(:uid as uuid)"), {"uid": user_id})


def test_fill_today_utilisation_summary(fill_today):
    url, store, user_id, org_id, court_id = fill_today
    settings = Settings(
        origin="https://fill.test",
        environment="test",
        database=url,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )
    client = TestClient(create_v1_app(settings, "operations", auth_override=StaticAuth(user_id)))
    r = client.get(
        f"/api/fmc/{org_id}/today",
        params={"date": "2026-10-05"},
        headers={"Authorization": "Bearer ci-owner-token"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["timezone"] == "Europe/Lisbon"
    assert body["day_start"].startswith("2026-10-05T00:00:00")
    assert body["day_end"].startswith("2026-10-06T00:00:00")
    assert body["summary"]["capacity_minutes"] == 1050
    assert body["summary"]["booked_minutes"] == 90
    assert body["summary"]["blocked_minutes"] == 60
    assert body["summary"]["bookings"] == 1
    assert body["summary"]["cancellations"] == 1
    assert body["summary"]["revenue_minor"] == 3600
    assert body["summary"]["empty_minutes"] == 900
    assert body["courts"][0]["court_id"] == court_id
    assert body["courts"][0]["open_start_minute"] == 360
    assert body["courts"][0]["open_end_minute"] == 1410
    assert body["courts"][0]["bookings"] == 1
    assert body["courts"][0]["cancellations"] == 1
    assert body["courts"][0]["revenue_minor"] == 3600
    assert [(w["start_minute"], w["end_minute"]) for w in body["courts"][0]["sellable_windows"]] == [(360, 1410)]
    assert body["courts"][0]["utilization_pct"] == pytest.approx(8.6, abs=0.1)
    assert body["empty_windows"]
    longest = body["empty_windows"][0]
    assert longest["court_id"] == court_id
    assert longest["duration_minutes"] >= 120
    assert longest["starts_at"] < longest["ends_at"]
    assert longest["bookable_60_count"] > 0
    assert longest["bookable_90_count"] > 0
    assert longest["min_60_amount_minor"] == 2400
    assert longest["max_60_amount_minor"] == 2400
    assert longest["min_90_amount_minor"] == 3600
    assert longest["max_90_amount_minor"] == 3600
    assert longest["best_amount_minor"] == 3600
    assert longest["best_duration_minutes"] == 90
    assert body["summary"]["bookable_60_starts"] >= longest["bookable_60_count"]
    assert body["summary"]["bookable_90_starts"] >= longest["bookable_90_count"]
    assert body["summary"]["highest_single_quote_minor"] == 3600
    assert body["summary"]["highest_single_quote_duration_minutes"] == 90



def test_fill_today_preserves_split_sellable_windows(fill_today):
    url, store, user_id, org_id, court_id = fill_today
    with store.trusted() as c:
        c.execute(text("""
            update public.court_rates
            set end_minute=720
            where court_id=cast(:court as uuid)
        """), {"court": court_id})
        c.execute(text("""
            insert into public.court_rates(organization_id,court_id,weekday,start_minute,end_minute,
                                           price_minor,currency,priority)
            values(cast(:org as uuid),cast(:court as uuid),null,780,1410,2400,'EUR',100)
        """), {"org": org_id, "court": court_id})

    settings = Settings(
        origin="https://fill.test",
        environment="test",
        database=url,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )
    client = TestClient(create_v1_app(settings, "operations", auth_override=StaticAuth(user_id)))
    r = client.get(
        f"/api/fmc/{org_id}/today",
        params={"date": "2026-10-05"},
        headers={"Authorization": "Bearer ci-owner-token"},
    )
    assert r.status_code == 200, r.text
    court = r.json()["courts"][0]
    assert [(w["start_minute"], w["end_minute"]) for w in court["sellable_windows"]] == [
        (360, 720),
        (780, 1410),
    ]


def test_fill_today_keeps_active_courts_without_rate_coverage_visible(fill_today):
    url, store, user_id, org_id, court_id = fill_today
    uncovered_court_id = str(uuid.uuid4())
    with store.trusted() as c:
        c.execute(text("""
            insert into public.courts(id,venue_id,name,sport,indoor,inventory_mode,native_write_enabled)
            select cast(:court as uuid),venue_id,'Unpriced Court','padel',false,'native',true
            from public.courts where id=cast(:existing_court as uuid)
        """), {"court": uncovered_court_id, "existing_court": court_id})

    settings = Settings(
        origin="https://fill.test",
        environment="test",
        database=url,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )
    client = TestClient(create_v1_app(settings, "operations", auth_override=StaticAuth(user_id)))
    r = client.get(
        f"/api/fmc/{org_id}/today",
        params={"date": "2026-10-05"},
        headers={"Authorization": "Bearer ci-owner-token"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    uncovered = next(court for court in body["courts"] if court["court_id"] == uncovered_court_id)
    assert uncovered["has_rate_coverage"] is False
    assert uncovered["capacity_minutes"] == 0
    assert uncovered["sellable_windows"] == []
    assert body["summary"]["active_courts"] == 2
    assert body["summary"]["courts_with_rate_coverage"] == 1
    assert body["summary"]["courts_without_rate_coverage"] == 1



def test_fill_calendar_returns_active_holds(fill_today):
    url, store, user_id, org_id, court_id = fill_today
    with store.trusted() as c:
        c.execute(text("""
            insert into public.booking_holds(organization_id,court_id,starts_at,ends_at,expires_at,idempotency_key)
            values(cast(:org as uuid),cast(:court as uuid),
                   '2026-10-05 15:00:00+01','2026-10-05 16:00:00+01',
                   '2099-01-01 00:00:00+00','calendar-active-hold')
        """), {"org": org_id, "court": court_id})
        c.execute(text("""
            insert into public.booking_holds(organization_id,court_id,starts_at,ends_at,expires_at,idempotency_key)
            values(cast(:org as uuid),cast(:court as uuid),
                   '2026-10-05 16:00:00+01','2026-10-05 17:00:00+01',
                   '2000-01-01 00:00:00+00','calendar-expired-hold')
        """), {"org": org_id, "court": court_id})

    settings = Settings(
        origin="https://fill.test",
        environment="test",
        database=url,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )
    client = TestClient(create_v1_app(settings, "operations", auth_override=StaticAuth(user_id)))
    r = client.get(
        f"/api/fmc/{org_id}/calendar",
        params={
            "start": "2026-10-05T00:00:00+01:00",
            "end": "2026-10-06T00:00:00+01:00",
        },
        headers={"Authorization": "Bearer ci-owner-token"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["holds"]) == 1
    assert body["holds"][0]["court_id"] == court_id
    assert body["holds"][0]["expires_at"]



def test_fill_today_opportunity_quotes_follow_rate_priority(fill_today):
    url, store, user_id, org_id, court_id = fill_today
    with store.trusted() as c:
        c.execute(text("""
            insert into public.court_rates(organization_id,court_id,weekday,start_minute,end_minute,
                                           price_minor,currency,priority)
            values(cast(:org as uuid),cast(:court as uuid),null,1080,1410,4000,'EUR',10)
        """), {"org": org_id, "court": court_id})

    settings = Settings(
        origin="https://fill.test",
        environment="test",
        database=url,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )
    client = TestClient(create_v1_app(settings, "operations", auth_override=StaticAuth(user_id)))
    r = client.get(
        f"/api/fmc/{org_id}/today",
        params={"date": "2026-10-05"},
        headers={"Authorization": "Bearer ci-owner-token"},
    )
    assert r.status_code == 200, r.text
    windows = r.json()["empty_windows"]
    evening = next(w for w in windows if w["best_amount_minor"] == 6000)
    assert evening["max_60_amount_minor"] == 4000
    assert evening["max_90_amount_minor"] == 6000
    assert evening["best_duration_minutes"] == 90
    assert r.json()["summary"]["highest_single_quote_minor"] == 6000


@pytest.mark.parametrize("date,day_hours,capacity,starts60,starts90", [
    ("2030-01-01", 24, 1410, 46, 45),
    ("2030-03-31", 23, 1350, 44, 43),
    ("2030-10-27", 25, 1470, 48, 47),
])
def test_fill_today_native_pg_day_boundaries(fill_today, date, day_hours, capacity, starts60, starts90):
    # Existing disposable CI fixture only; no fake SQL rows or app factory.
    # These dates qualify the installed timezone rules, not future legislation.
    from fmc.fill_today_read import read_today
    _, store, user_id, org_id, court_id = fill_today
    day = datetime.fromisoformat(date).date()
    with store.trusted() as c:
        updated = c.execute(text("""
            update public.court_rates
            set start_minute=0,end_minute=1410,weekday=:weekday
            where organization_id=cast(:org as uuid) and court_id=cast(:court as uuid)
        """), {"org": org_id, "court": court_id, "weekday": day.weekday()})
        assert updated.rowcount == 1

    body = read_today(store, Actor(id=user_id), org_id, date, day)
    local, utc = ZoneInfo("Europe/Lisbon"), ZoneInfo("UTC")
    begin = datetime(day.year, day.month, day.day, tzinfo=local)
    finish = begin + timedelta(days=1)
    assert body["date"] == date and body["timezone"] == "Europe/Lisbon" and body["currency"] == "EUR"
    day_start, day_end = (datetime.fromisoformat(body[key]).astimezone(utc) for key in ("day_start", "day_end"))
    assert day_start == begin.astimezone(utc) and day_end == finish.astimezone(utc)
    assert day_end - day_start == timedelta(hours=day_hours)
    assert body["summary"] == {
        "capacity_minutes": capacity, "booked_minutes": 0, "held_minutes": 0, "blocked_minutes": 0,
        "empty_minutes": capacity, "utilization_pct": 0.0, "bookings": 0, "cancellations": 0,
        "revenue_minor": 0, "active_courts": 1, "courts_with_rate_coverage": 1,
        "courts_without_rate_coverage": 0, "bookable_60_starts": starts60, "bookable_90_starts": starts90,
        "highest_single_quote_minor": 3600, "highest_single_quote_duration_minutes": 90,
    }
    court, = body["courts"]
    assert court["court_id"] == court_id and court["has_rate_coverage"] is True
    assert court["capacity_minutes"] == court["empty_minutes"] == capacity
    assert court["booked_minutes"] == court["held_minutes"] == court["blocked_minutes"] == 0
    sellable, = court["sellable_windows"]
    empty, = body["empty_windows"]
    assert (sellable["start_minute"], sellable["end_minute"]) == (0, 1410)
    for window in (sellable, empty):
        assert window["court_id"] == court_id
        assert isinstance(window["starts_at"], datetime) and isinstance(window["ends_at"], datetime)
        assert window["starts_at"].utcoffset() is not None and window["ends_at"].utcoffset() is not None
        start, end = window["starts_at"].astimezone(utc), window["ends_at"].astimezone(utc)
        assert start == begin.astimezone(utc) and end == (begin + timedelta(minutes=1410)).astimezone(utc)
        assert end - start == timedelta(minutes=capacity)
    assert empty["duration_minutes"] == capacity
    assert empty["bookable_60_count"] == starts60 and empty["bookable_90_count"] == starts90
    assert (empty["min_60_amount_minor"], empty["max_60_amount_minor"],
            empty["min_90_amount_minor"], empty["max_90_amount_minor"]) == (2400, 2400, 3600, 3600)
    assert empty["best_amount_minor"] == 3600 and empty["best_duration_minutes"] == 90 and empty["currency"] == "EUR"
    print("FILL_TODAY_NATIVE_PG_PASS kind=day date=" + date)


def test_fill_today_native_pg_hold_expiry_uses_database_now(fill_today):
    from fmc.fill_today_read import read_today
    _, store, user_id, org_id, court_id = fill_today
    # Only disposable fixture rows; expiry is computed by PostgreSQL, not the
    # Python clock or the requested day. No exact-now or blocked-expiry claim.
    with store.trusted() as c:
        inserted = c.execute(text("""
            insert into public.booking_holds(organization_id,court_id,starts_at,ends_at,expires_at,idempotency_key)
            values
              (cast(:org as uuid),cast(:court as uuid),
               '2026-10-05 15:00:00+01','2026-10-05 16:00:00+01',now()+interval '1 day','today-native-active-hold'),
              (cast(:org as uuid),cast(:court as uuid),
               '2026-10-05 16:00:00+01','2026-10-05 17:00:00+01',now()-interval '1 day','today-native-expired-hold')
        """), {"org": org_id, "court": court_id})
        assert inserted.rowcount == 2

    date = "2026-10-05"
    body = read_today(store, Actor(id=user_id), org_id, date, datetime.fromisoformat(date).date())
    summary = body["summary"]
    assert summary["capacity_minutes"] == 1050 and summary["booked_minutes"] == 90
    assert summary["blocked_minutes"] == 60 and summary["held_minutes"] == 60 and summary["empty_minutes"] == 840
    assert (summary["bookings"], summary["cancellations"], summary["revenue_minor"]) == (1, 1, 3600)
    court, = body["courts"]
    assert court["court_id"] == court_id and court["held_minutes"] == 60 and court["empty_minutes"] == 840
    sellable, = court["sellable_windows"]
    assert (sellable["start_minute"], sellable["end_minute"]) == (360, 1410)
    local, utc = ZoneInfo("Europe/Lisbon"), ZoneInfo("UTC")
    at = lambda hour, minute=0: datetime(2026, 10, 5, hour, minute, tzinfo=local).astimezone(utc)
    assert sellable["starts_at"].astimezone(utc) == at(6) and sellable["ends_at"].astimezone(utc) == at(23, 30)
    windows = body["empty_windows"]
    assert windows and all(window["court_id"] == court_id for window in windows)
    assert all(not (window["starts_at"].astimezone(utc) < at(16) and window["ends_at"].astimezone(utc) > at(15)) for window in windows)
    expired_window, = [window for window in windows if window["starts_at"].astimezone(utc) == at(16)]
    assert expired_window["ends_at"].astimezone(utc) == at(23, 30) and expired_window["duration_minutes"] == 450
    print("FILL_TODAY_NATIVE_PG_PASS kind=holds date=" + date)


def test_fill_today_user_transaction_mode_prerequisite(fill_today, capsys):
    from fmc.supabase_v1 import one
    _, store, user_id, _, _ = fill_today
    # Query-only added body; the unchanged disposable fixture still seeds and
    # cleans up SQL rows. Observe inherited mode without changing any setting.
    with store.user(user_id) as c:
        isolation_row = one(c.execute(text("SHOW transaction_isolation")))
        read_only_row = one(c.execute(text("SHOW transaction_read_only")))
    if type(isolation_row) is not dict or len(isolation_row) != 1:
        pytest.fail("Native transaction isolation result shape is unrecognized.", pytrace=False)
    if type(read_only_row) is not dict or len(read_only_row) != 1:
        pytest.fail("Native transaction read-only result shape is unrecognized.", pytrace=False)
    isolation, = isolation_row.values()
    read_only, = read_only_row.values()
    allowed_isolation = {
        "read uncommitted": "read_uncommitted",
        "read committed": "read_committed",
        "repeatable read": "repeatable_read",
        "serializable": "serializable",
    }
    # Fail closed without printing arbitrary database values or row metadata.
    if type(isolation) is not str or isolation not in allowed_isolation:
        pytest.fail("Native transaction isolation value is unrecognized.", pytrace=False)
    if type(read_only) is not str or read_only not in ("on", "off"):
        pytest.fail("Native transaction read-only value is unrecognized.", pytrace=False)
    with capsys.disabled():
        print("FILL_TODAY_USER_TX_MODE_OBSERVED isolation=" + allowed_isolation[isolation] + " read_only=" + read_only)


@pytest.mark.parametrize("mode", ["keep", "revoke"])
def test_fill_today_preacquired_membership_snapshot(fill_today, capsys, mode):
    from contextlib import ExitStack, contextmanager
    from fmc.fill_today_read import SCOPE, SNAPSHOT, read_today
    from fmc.supabase_v1 import one
    _, store, user_id, org_id, court_id = fill_today
    trace, state = [], {"trusted_closed": False, "user_closed": False, "deleted": 0, "user_contexts": 0}
    body = None

    # Pre-acquire the existing trusted context before user setup/SCOPE. The
    # dedicated stack holds only this context; there is no in-hook checkout.
    with ExitStack() as trusted_stack:
        trusted = trusted_stack.enter_context(store.trusted())
        trace.append("trusted_acquired")
        trusted.execute(text("SET LOCAL lock_timeout='500ms'"))
        trusted.execute(text("SET LOCAL statement_timeout='1000ms'"))

        class ConnectionObserver:
            def __init__(self, native):
                self.native = native

            def execute(self, statement, params):
                if statement is SCOPE:
                    assert not state["trusted_closed"]
                    result = self.native.execute(statement, params)
                    trace.append("scope_returned")
                    if mode == "revoke":
                        deleted = trusted.execute(text("""
                            delete from public.organization_members
                            where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)
                        """), {"org": org_id, "uid": user_id})
                        assert deleted.rowcount == 1
                        state["deleted"] = deleted.rowcount
                        trace.append("member_deleted")
                    # Record success only AFTER actual trusted-context close
                    # returns. Native SCOPE rows are never consumed/replaced.
                    trusted_stack.close()
                    state["trusted_closed"] = True
                    trace.append("trusted_closed")
                    return result
                assert statement is SNAPSHOT and state["trusted_closed"]
                trace.append("snapshot_entered")
                result = self.native.execute(statement, params)
                trace.append("snapshot_returned")
                return result

        class UserObserver:
            @contextmanager
            def user(self, uid):
                assert uid == user_id
                state["user_contexts"] += 1
                try:
                    with store.user(uid) as native:
                        assert native is not trusted
                        trace.append("user_acquired")
                        native.execute(text("SET LOCAL lock_timeout='500ms'"))
                        native.execute(text("SET LOCAL statement_timeout='1000ms'"))
                        for query, expected in (("SHOW transaction_isolation", "read committed"),
                                                ("SHOW transaction_read_only", "off")):
                            row = one(native.execute(text(query)))
                            if type(row) is not dict or len(row) != 1:
                                pytest.fail("Native membership transaction mode shape is unsupported.", pytrace=False)
                            value, = row.values()
                            if type(value) is not str or value != expected:
                                pytest.fail("Native membership transaction mode is unsupported.", pytrace=False)
                        trace.append("user_mode_confirmed")
                        yield ConnectionObserver(native)
                except DomainError:
                    # The original user context has unwound before this point;
                    # preserve the real helper exception, without suppression.
                    state["user_closed"] = True
                    trace.append("user_closed")
                    raise
                else:
                    state["user_closed"] = True
                    trace.append("user_closed")

        if mode == "revoke":
            with pytest.raises(DomainError) as denied:
                body = read_today(UserObserver(), Actor(id=user_id), org_id, "2026-10-05", datetime(2026, 10, 5).date())
            assert denied.value.code == "FORBIDDEN" and denied.value.status == 403 and body is None
        else:
            body = read_today(UserObserver(), Actor(id=user_id), org_id, "2026-10-05", datetime(2026, 10, 5).date())
            assert body["date"] == "2026-10-05" and body["timezone"] == "Europe/Lisbon" and body["currency"] == "EUR"
            summary = body["summary"]
            assert (summary["capacity_minutes"], summary["booked_minutes"], summary["held_minutes"],
                    summary["blocked_minutes"], summary["empty_minutes"]) == (1050, 90, 0, 60, 900)
            assert (summary["bookings"], summary["cancellations"], summary["revenue_minor"]) == (1, 1, 3600)
            court, = body["courts"]
            assert court["court_id"] == court_id and court["has_rate_coverage"] is True
            window, = court["sellable_windows"]
            assert (window["start_minute"], window["end_minute"]) == (360, 1410) and body["empty_windows"]

    assert state["trusted_closed"] and state["user_closed"] and state["user_contexts"] == 1
    assert state["deleted"] == (1 if mode == "revoke" else 0)
    assert trace == ["trusted_acquired", "user_acquired", "user_mode_confirmed", "scope_returned"] + (
        ["member_deleted"] if mode == "revoke" else []
    ) + ["trusted_closed", "snapshot_entered", "snapshot_returned", "user_closed"]
    # Two completed pre-acquired contexts only; no claim about a client deadline,
    # timeout cleanup, or undoing the separately committed member deletion.
    result = "forbidden403" if mode == "revoke" else "dto"
    with capsys.disabled():
        print("FILL_TODAY_PREACQUIRED_MEMBERSHIP_PG_PASS case=" + mode + " result=" + result)



def test_fill_demand_aware_opportunity_is_incremental_private_and_lifecycle_aware(fill_today):
    url, store, user_id, org_id, court_id = fill_today
    player_id = str(uuid.uuid4())
    target = datetime.now(ZoneInfo("Europe/Lisbon")).date() + timedelta(days=7)
    target_weekday = target.weekday()
    target_start = datetime(target.year, target.month, target.day, 17, 0, tzinfo=ZoneInfo("Europe/Lisbon"))
    expires_at = datetime(target.year, target.month, target.day, 23, 59, tzinfo=ZoneInfo("Europe/Lisbon"))

    with store.trusted() as c:
        venue_id = c.execute(text("""
            select venue_id::text from public.courts where id=cast(:court as uuid)
        """), {"court": court_id}).scalar_one()
        c.execute(text("insert into auth.users(id) values(cast(:uid as uuid))"), {"uid": player_id})
        routine_id = c.execute(text("""
            insert into public.play_routines
              (user_id,sport,days_of_week,window_start_minute,window_end_minute,duration_minutes,
               location_label,center_lat,center_lon,radius_km,max_price_minor,currency,
               indoor_preference,timezone,start_date,status,watch_enabled)
            values
              (cast(:uid as uuid),'padel',:days,1020,1200,90,
               'Cascais',38.6979,-9.4215,10,5000,'EUR',
               'indoor','Europe/Lisbon',cast(:target as date),'active',true)
            returning id::text
        """), {"uid": player_id, "days": [target_weekday], "target": target.isoformat()}).scalar_one()
        c.execute(text("""
            insert into public.demand_intents
              (routine_id,user_id,target_date,window_start_minute,window_end_minute,
               duration_minutes,status,freshness_score,expires_at)
            values
              (cast(:routine as uuid),cast(:uid as uuid),cast(:target as date),
               1020,1200,90,'watching',1.000,:expires)
        """), {
            "routine": routine_id,
            "uid": player_id,
            "target": target.isoformat(),
            "expires": expires_at,
        })

        before_bookings = c.execute(text("""
            select count(*) from public.bookings where organization_id=cast(:org as uuid)
        """), {"org": org_id}).scalar_one()
        before_holds = c.execute(text("""
            select count(*) from public.booking_holds where organization_id=cast(:org as uuid)
        """), {"org": org_id}).scalar_one()
        before_people = c.execute(text("""
            select count(*) from public.people where organization_id=cast(:org as uuid)
        """), {"org": org_id}).scalar_one()

    settings = Settings(
        origin="https://fill.test",
        environment="test",
        database=url,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )
    client = TestClient(create_v1_app(settings, "operations", auth_override=StaticAuth(user_id)))
    evaluated = client.post(
        f"/api/fmc/{org_id}/opportunities/evaluate",
        params={"date": target.isoformat()},
        headers={"Authorization": "Bearer ci-owner-token"},
    )
    assert evaluated.status_code == 200, evaluated.text
    payload = evaluated.json()
    assert payload["formula_version"] == "fill_demand_aware_v1"
    assert payload["summary"]["actionable"] >= 1
    assert payload["summary"]["expected_incremental_contribution_minor"] > 0
    assert payload["summary"]["club_crm_signal"] == "not_connected"

    opportunity = next(item for item in payload["items"] if item["status"] == "actionable")
    assert opportunity["court_id"] == court_id
    assert opportunity["active_demand_count"] >= 1
    assert float(opportunity["demand_fit_score"]) >= 50
    assert int(opportunity["expected_incremental_contribution_minor"]) > 0
    assert float(opportunity["priority_score"]) >= 50
    assert opportunity["source_breakdown"]["getacourt_network"]["active_intents"] >= 1
    assert opportunity["source_breakdown"]["club_owned"]["signal_status"] == "not_connected"
    assert opportunity["action_plan"][0]["action"] == "ACTIVATE_GET_NETWORK_CURRENT_PRICE"
    assert opportunity["action_plan"][0]["execution"] == "recommendation_only"
    assert "player_id" not in evaluated.text
    assert player_id not in evaluated.text

    listed = client.get(
        f"/api/fmc/{org_id}/opportunities",
        params={"date": target.isoformat()},
        headers={"Authorization": "Bearer ci-owner-token"},
    )
    assert listed.status_code == 200, listed.text
    assert any(item["id"] == opportunity["id"] for item in listed.json()["items"])

    with store.trusted() as c:
        assert c.execute(text("""
            select count(*) from public.bookings where organization_id=cast(:org as uuid)
        """), {"org": org_id}).scalar_one() == before_bookings
        assert c.execute(text("""
            select count(*) from public.booking_holds where organization_id=cast(:org as uuid)
        """), {"org": org_id}).scalar_one() == before_holds
        assert c.execute(text("""
            select count(*) from public.people where organization_id=cast(:org as uuid)
        """), {"org": org_id}).scalar_one() == before_people
        assert c.execute(text("""
            select count(*) from public.revenue_opportunities
            where organization_id=cast(:org as uuid) and target_date=cast(:target as date)
        """), {"org": org_id, "target": target.isoformat()}).scalar_one() >= 1

        recommended = datetime.fromisoformat(opportunity["recommended_starts_at"])
        ends_at = recommended + timedelta(minutes=int(opportunity["duration_minutes"]))
        c.execute(text("""
            insert into public.bookings
              (organization_id,venue_id,court_id,status,starts_at,ends_at,
               currency,gross_amount_minor,source,idempotency_key)
            values
              (cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),'confirmed',
               :starts_at,:ends_at,'EUR',:amount,'manual','demand-aware-won')
        """), {
            "org": org_id,
            "venue": venue_id,
            "court": court_id,
            "starts_at": recommended,
            "ends_at": ends_at,
            "amount": int(opportunity["quote_amount_minor"]),
        })

    reevaluated = client.post(
        f"/api/fmc/{org_id}/opportunities/evaluate",
        params={"date": target.isoformat()},
        headers={"Authorization": "Bearer ci-owner-token"},
    )
    assert reevaluated.status_code == 200, reevaluated.text

    lifecycle = client.get(
        f"/api/fmc/{org_id}/opportunities",
        params={"date": target.isoformat()},
        headers={"Authorization": "Bearer ci-owner-token"},
    )
    assert lifecycle.status_code == 200, lifecycle.text
    won = next(item for item in lifecycle.json()["items"] if item["id"] == opportunity["id"])
    assert won["status"] == "won"
    assert won["closed_at"] is not None

    with store.trusted() as c:
        c.execute(text("delete from auth.users where id=cast(:uid as uuid)"), {"uid": player_id})


def test_crm_shadow_requires_verified_channel_permission_and_never_executes_live(fill_today):
    url, store, user_id, org_id, court_id = fill_today
    person_id = str(uuid.uuid4())
    opportunity_id = str(uuid.uuid4())
    target_start = datetime.now(ZoneInfo("Europe/Lisbon")).replace(
        hour=19, minute=0, second=0, microsecond=0
    ) + timedelta(days=14)
    target_end = target_start + timedelta(hours=2)
    historical_start = target_start - timedelta(days=21)

    with store.trusted() as c:
        venue_id = c.execute(text("""
            select venue_id::text from public.courts where id=cast(:court as uuid)
        """), {"court": court_id}).scalar_one()
        c.execute(text("""
            insert into public.people
              (id,organization_id,external_key,full_name,email,phone,marketing_consent,source,source_updated_at)
            values
              (cast(:person as uuid),cast(:org as uuid),'crm-shadow-person','CRM Shadow Player',
               'crm-shadow@example.test','+351910000001',true,'club_crm',now())
        """), {"person": person_id, "org": org_id})
        c.execute(text("""
            insert into public.bookings
              (organization_id,venue_id,court_id,player_id,status,starts_at,ends_at,
               currency,gross_amount_minor,source,idempotency_key)
            values
              (cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),cast(:person as uuid),
               'confirmed',:starts_at,:ends_at,'EUR',3600,'manual','crm-shadow-history')
        """), {
            "org": org_id, "venue": venue_id, "court": court_id, "person": person_id,
            "starts_at": historical_start, "ends_at": historical_start + timedelta(minutes=90),
        })
        c.execute(text("""
            insert into public.revenue_opportunities
              (id,organization_id,venue_id,court_id,opportunity_key,target_date,
               window_starts_at,window_ends_at,recommended_starts_at,duration_minutes,
               quote_amount_minor,currency,status,active_demand_count,demand_fit_score,
               freshness_confidence,organic_baseline_probability,action_conversion_probability,
               expected_incremental_contribution_minor,priority_score,source_breakdown,
               action_plan,explanation,qualified_at,actionable_at)
            values
              (cast(:id as uuid),cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),
               'crm-shadow-opportunity',cast(:target_date as date),:window_start,:window_end,
               :recommended_start,90,4000,'EUR','actionable',4,85,0.9,0.1,0.7,1800,82,
               cast(:source_breakdown as jsonb),cast(:action_plan as jsonb),
               cast(:explanation as jsonb),now(),now())
        """), {
            "id": opportunity_id, "org": org_id, "venue": venue_id, "court": court_id,
            "target_date": target_start.date().isoformat(), "window_start": target_start,
            "window_end": target_end, "recommended_start": target_start,
            "source_breakdown": '{"getacourt_network":{"active_intents":4}}',
            "action_plan": "[]",
            "explanation": '{"formula_version":"test"}',
        })

    settings = Settings(
        origin="https://fill.test",
        environment="test",
        database=url,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )
    client = TestClient(create_v1_app(settings, "operations", auth_override=StaticAuth(user_id)))
    headers = {"Authorization": "Bearer ci-owner-token"}

    first = client.post(
        f"/api/fmc/{org_id}/opportunities/{opportunity_id}/crm-shadow",
        json={},
        headers=headers,
    )
    assert first.status_code == 201, first.text
    first_body = first.json()
    assert first_body["action"]["audience_eligible"] == 0
    assert first_body["action"]["execution_enabled"] is False
    assert first_body["shadow"]["exclusions"]["permission_unknown"] >= 1
    blocked_action_id = first_body["action"]["id"]

    no_approval = client.post(
        f"/api/fmc/{org_id}/crm-actions/{blocked_action_id}/request-approval",
        headers=headers,
    )
    assert no_approval.status_code == 409
    assert no_approval.json()["error"] == "NO_ELIGIBLE_AUDIENCE"

    permission = client.post(
        f"/api/fmc/{org_id}/people/{person_id}/communication-permissions",
        json={
            "channel": "whatsapp",
            "purpose": "promotional",
            "status": "granted",
            "consent_proof": "club CRM consent record #1",
            "consent_at": (datetime.now(ZoneInfo("Europe/Lisbon")) - timedelta(days=30)).isoformat(),
            "jurisdiction": "PT",
            "source": "club_crm",
            "frequency_cap_hours": 24,
        },
        headers=headers,
    )
    assert permission.status_code == 200, permission.text
    assert permission.json()["status"] == "granted"

    second = client.post(
        f"/api/fmc/{org_id}/opportunities/{opportunity_id}/crm-shadow",
        json={},
        headers=headers,
    )
    assert second.status_code == 201, second.text
    second_body = second.json()
    action_id = second_body["action"]["id"]
    assert second_body["action"]["audience_eligible"] >= 1
    assert second_body["action"]["audience_blocked"] == 0
    assert second_body["action"]["execution_enabled"] is False
    assert second_body["shadow"]["waves"][0]["wave"] == 1
    assert second_body["shadow"]["live_delivery_available"] is False

    detail = client.get(
        f"/api/fmc/{org_id}/crm-actions/{action_id}",
        headers=headers,
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["offers"][0]["status"] == "shadow"
    assert detail.json()["audience"][0]["eligibility"] == "eligible"

    approval_request = client.post(
        f"/api/fmc/{org_id}/crm-actions/{action_id}/request-approval",
        headers=headers,
    )
    assert approval_request.status_code == 200, approval_request.text
    assert approval_request.json()["status"] == "approval_pending"
    assert approval_request.json()["execution_enabled"] is False

    approval = client.post(
        f"/api/fmc/{org_id}/crm-actions/{action_id}/approve",
        json={"decision": "approve"},
        headers=headers,
    )
    assert approval.status_code == 200, approval.text
    assert approval.json()["status"] == "approved"
    assert approval.json()["execution_enabled"] is False
    assert approval.json()["live_delivery_available"] is False

    # Phase 1: a Null adapter stores only evidence of simulation, never delivery.
    prepared = client.post(
        f"/api/fmc/{org_id}/crm-actions/{action_id}/shadow-delivery", headers=headers,
    )
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()["prepared"] == 1
    assert prepared.json()["adapter"] == "null"
    assert prepared.json()["external_send"] is False
    assert prepared.json()["provider_message_ids"] == []

    replay = client.post(
        f"/api/fmc/{org_id}/crm-actions/{action_id}/shadow-delivery", headers=headers,
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["prepared"] == 0
    assert replay.json()["existing"] == 1

    delivery = client.get(
        f"/api/fmc/{org_id}/crm-actions/{action_id}/delivery", headers=headers,
    )
    assert delivery.status_code == 200, delivery.text
    assert len(delivery.json()["attempts"]) == 1
    assert [e["event_type"] for e in delivery.json()["events"]] == [
        "CREATED", "SHADOW_SIMULATED",
    ]
    assert delivery.json()["external_send"] is False

    for route in ("attributions", "attribution-adjustments", "disputes"):
        empty = client.get(f"/api/fmc/{org_id}/{route}", headers=headers)
        assert empty.status_code == 200, empty.text
        assert empty.json()["items"] == []
        assert empty.json()["mode"] == "shadow"

    with store.trusted() as c:
        assert c.execute(text("""
            select count(*) from public.crm_delivery_events
            where organization_id=cast(:org as uuid) and event_type='DELIVERED'
        """), {"org": org_id}).scalar_one() == 0

    with store.trusted() as c:
        offer = c.execute(text("""
            select target_starts_at,target_ends_at from public.crm_offers
            where action_id=cast(:action as uuid) and wave_number=1
        """), {"action": action_id}).mappings().one()
        booking_count_before = c.execute(text("""
            select count(*) from public.bookings
            where organization_id=cast(:org as uuid) and starts_at=:starts_at
        """), {"org": org_id, "starts_at": offer["target_starts_at"]}).scalar_one()
        hold_count_before = c.execute(text("""
            select count(*) from public.booking_holds
            where organization_id=cast(:org as uuid) and starts_at=:starts_at
        """), {"org": org_id, "starts_at": offer["target_starts_at"]}).scalar_one()
        assert booking_count_before == 0
        assert hold_count_before == 0

        c.execute(text("""
            insert into public.bookings
              (organization_id,venue_id,court_id,status,starts_at,ends_at,
               currency,gross_amount_minor,source,idempotency_key)
            values
              (cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),'confirmed',
               :starts_at,:ends_at,'EUR',4000,'manual','crm-shadow-stop-booking')
        """), {
            "org": org_id, "venue": venue_id, "court": court_id,
            "starts_at": offer["target_starts_at"], "ends_at": offer["target_ends_at"],
        })

    stopped = client.post(
        f"/api/fmc/{org_id}/crm-actions/{action_id}/evaluate",
        headers=headers,
    )
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["status"] == "stopped"
    assert stopped.json()["stop_reason"] == "target_inventory_booked"
    assert stopped.json()["execution_enabled"] is False


def test_authoritative_booking_shadow_and_four_eyes_dispute_review(fill_today):
    url, store, owner_id, org, court = fill_today
    with store.trusted() as c:
        booking_id = c.execute(text("""
            select id::text from public.bookings
            where organization_id=cast(:org as uuid) and source='getacourt'
              and status='confirmed' limit 1
        """), {"org":org}).scalar_one()

    settings = Settings(origin="https://fill.test",environment="test",database=url,
                        supabase_url="https://example.supabase.co",
                        supabase_publishable_key="sb_publishable_ci",data_contract="supabase-v1")
    client = TestClient(create_v1_app(settings, "operations", auth_override=StaticAuth(owner_id)))
    hdr={"Authorization":"Bearer ci-owner-token"}
    endpoint=f"/api/fmc/{org}/attributions/evaluate-shadow"
    first=client.post(endpoint,json={"booking_id":booking_id},headers=hdr)
    assert first.status_code==200,first.text
    assert first.json()["maturity"]=="provisional"
    assert first.json()["primary_winner"] is None
    assert first.json()["billable"] is False
    assert first.json()["new_evidence"] is True
    again=client.post(endpoint,json={"booking_id":booking_id},headers=hdr)
    assert again.status_code==200,again.text
    assert again.json()["new_evidence"] is False
    assert again.json()["record_id"]==first.json()["record_id"]
    evidence=client.get(f"/api/fmc/{org}/bookings/{booking_id}/evidence",headers=hdr)
    assert evidence.status_code==200 and len(evidence.json()["items"])==1
    assert evidence.json()["items"][0]["evidence"]["causal_evidence_verified"] is False
    finance=client.get(f"/api/fmc/{org}/attributions",headers=hdr).json()["items"]
    rec=next(x for x in finance if x["booking_id"]==booking_id)
    assert rec["fee_minor"]==0 and rec["billable"] is False
    assert rec["primary_offer_id"] is None
    dispute=client.post(f"/api/fmc/{org}/disputes/shadow",headers=hdr,
       json={"attribution_id":rec["id"],"risk":"high","reason":"No matching verified provider response"})
    assert dispute.status_code==201,dispute.text
    case_id=dispute.json()["case"]["id"]
    duplicate=client.post(f"/api/fmc/{org}/disputes/shadow",headers=hdr,
       json={"attribution_id":rec["id"],"risk":"high","reason":"Another report of same open issue"})
    assert duplicate.status_code==201,duplicate.text
    assert duplicate.json()["case"]["id"]==case_id
    assert duplicate.json()["reused"] is True
    with store.trusted() as c:
        c.execute(text("""
            update public.crm_dispute_cases set sla_due_at=now()-interval '1 minute'
            where id=cast(:id as uuid)
        """),{"id":case_id})
    sla=client.post(f"/api/fmc/{org}/disputes/evaluate-sla-shadow",headers=hdr)
    assert sla.status_code==200,sla.text
    assert sla.json()["new_escalations"]==1
    assert sla.json()["notifications_sent"]==0
    second_sla=client.post(f"/api/fmc/{org}/disputes/evaluate-sla-shadow",headers=hdr)
    assert second_sla.status_code==200 and second_sla.json()["new_escalations"]==0
    dispute_read=client.get(f"/api/fmc/{org}/disputes",headers=hdr)
    assert dispute_read.status_code==200
    assert any(item["id"]==case_id and item["sla_escalated"]
               for item in dispute_read.json()["items"])
    propose=client.post(f"/api/fmc/{org}/disputes/{case_id}/propose",headers=hdr,
       json={"code":"evidence_pending","note":"Needs external authoritative confirmation"})
    assert propose.status_code==200,propose.text
    self_approve=client.post(f"/api/fmc/{org}/disputes/{case_id}/approve",headers=hdr,
       json={"note":"Attempting to approve own case"})
    assert self_approve.status_code==409
    assert self_approve.json()["error"]=="FOUR_EYES"
    other_owner=str(uuid.uuid4())
    with store.trusted() as c:
        c.execute(text("insert into auth.users(id) values(cast(:id as uuid))"),{"id":other_owner})
        c.execute(text("""
            insert into public.organization_members(organization_id,user_id,role)
            values(cast(:org as uuid),cast(:uid as uuid),'admin')
        """),{"org":org,"uid":other_owner})
    second=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(other_owner)))
    approve=second.post(f"/api/fmc/{org}/disputes/{case_id}/approve",headers=hdr,
       json={"note":"Independent review approves non-financial resolution"})
    assert approve.status_code==200,approve.text
    resolve=client.post(f"/api/fmc/{org}/disputes/{case_id}/resolve",headers=hdr,
       json={"note":"Case closed without any fee or provider write"})
    assert resolve.status_code==200,resolve.text
    history=client.get(f"/api/fmc/{org}/disputes/{case_id}/decisions",headers=hdr)
    assert history.status_code==200
    assert [x["transition"] for x in history.json()["items"]]==["PROPOSED","APPROVED","RESOLVED"]
    with store.trusted() as c:
        c.execute(text("""
          update public.bookings set status='cancelled',updated_at=now()
          where id=cast(:booking as uuid)
        """),{"booking":booking_id})
    replay=client.post(endpoint,json={"booking_id":booking_id},headers=hdr)
    assert replay.status_code==200 and replay.json()["maturity"]=="unverified"
    assert replay.json()["new_evidence"] is True
    with store.trusted() as c:
        assert c.execute(text("""
            select count(*) from public.crm_booking_evidence
            where organization_id=cast(:org as uuid) and booking_id=cast(:booking as uuid)
        """),{"org":org,"booking":booking_id}).scalar_one()==2
        assert c.execute(text("""
            select count(*) from public.crm_attribution_records
            where organization_id=cast(:org as uuid) and booking_id=cast(:booking as uuid)
        """),{"org":org,"booking":booking_id}).scalar_one()==1
        assert c.execute(text("""
            select count(*) from public.crm_attribution_adjustments
            where organization_id=cast(:org as uuid)
        """),{"org":org}).scalar_one()==0
        c.execute(text("select set_config('fmc.allow_finance_purge','on',true)"))
        c.execute(text("delete from public.crm_dispute_cases where organization_id=cast(:org as uuid)"),{"org":org})
        c.execute(text("delete from public.crm_attribution_records where organization_id=cast(:org as uuid)"),{"org":org})
        c.execute(text("delete from auth.users where id=cast(:id as uuid)"),{"id":other_owner})


def test_offline_link_uses_core_booking_and_real_offer_without_causal_fees(fill_today):
    from fmc.offline_evidence import build_shadow_offer_link
    from fmc.revenue_evidence import core_snapshot_key
    url, store, uid, org, court = fill_today
    with store.trusted() as c:
        booking = c.execute(text("""
            select id::text,organization_id::text,court_id::text,starts_at,
                   ends_at,currency::text,source,status::text,updated_at
            from public.bookings where organization_id=cast(:org as uuid)
              and status='confirmed' limit 1
        """),{"org":org}).mappings().one()
        venue = c.execute(text("""
            select id::text from public.venues
            where organization_id=cast(:org as uuid) limit 1
        """),{"org":org}).scalar_one()
        opportunity = c.execute(text("""
            insert into public.revenue_opportunities
              (organization_id,venue_id,court_id,opportunity_key,target_date,
               window_starts_at,window_ends_at,currency)
            values(cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),
                   :key,:date,:starts,:ends,'EUR') returning id::text
        """),{"org":org,"venue":venue,"court":court,"key":"offline-"+uuid.uuid4().hex,
               "date":booking["starts_at"].date(),"starts":booking["starts_at"],
               "ends":booking["ends_at"]}).scalar_one()
        action = c.execute(text("""
            insert into public.crm_actions
              (organization_id,opportunity_id,quote_amount_minor,currency,opportunity_version_at_plan)
            values(cast(:org as uuid),cast(:opp as uuid),3600,'EUR',now())
            returning id::text
        """),{"org":org,"opp":opportunity}).scalar_one()
        offer_id = c.execute(text("""
            insert into public.crm_offers
              (organization_id,action_id,opportunity_id,tracking_token,
               target_court_id,target_starts_at,target_ends_at,
               authoritative_price_minor,offered_price_minor,currency,
               expires_at,attribution_window_ends_at)
            values(cast(:org as uuid),cast(:action as uuid),cast(:opp as uuid),
                   :token,cast(:court as uuid),:starts,:ends,3600,3600,'EUR',
                   now()+interval '1 day',now()+interval '2 days')
            returning id::text
        """),{"org":org,"action":action,"opp":opportunity,
               "token":"crm_"+uuid.uuid4().hex,"court":court,
               "starts":booking["starts_at"],"ends":booking["ends_at"]}).scalar_one()
        token=c.execute(text("select tracking_token from public.crm_offers where id=cast(:offer as uuid)"),
                        {"offer":offer_id}).scalar_one()
    settings = Settings(origin="https://fill.test",environment="test",database=url,
                        supabase_url="https://example.supabase.co",
                        supabase_publishable_key="sb_publishable_ci",data_contract="supabase-v1")
    client=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(uid)))
    hdr={"Authorization":"Bearer ci-owner-token"}
    path=f"/api/fmc/{org}/attributions/link-offer-shadow"
    payload={"booking_id":booking["id"],"offer_id":offer_id,"tracking_token":token}
    assert client.post(path,json=payload,headers=hdr).status_code==409
    snapshot=client.post(f"/api/fmc/{org}/attributions/evaluate-shadow",
                         json={"booking_id":booking["id"]},headers=hdr)
    assert snapshot.status_code==200,snapshot.text
    result=client.post(path,json=payload,headers=hdr)
    assert result.status_code==200,result.text
    assert result.json()["outcome"]=="observed_match"
    assert result.json()["new_evidence"] is True
    assert result.json()["primary_winner"] is None
    assert result.json()["fee_minor"]==0 and result.json()["billable"] is False
    replay=client.post(path,json=payload,headers=hdr)
    assert replay.status_code==200 and replay.json()["new_evidence"] is False
    wrong=client.post(path,json={**payload,"tracking_token":"wrong"},headers=hdr)
    assert wrong.status_code==422
    other=client.post(f"/api/fmc/{uuid.uuid4()}/attributions/link-offer-shadow",
                      json=payload,headers=hdr)
    assert other.status_code in (403,404)
    items=client.get(f"/api/fmc/{org}/bookings/{booking['id']}/offer-links",headers=hdr)
    assert items.status_code==200 and len(items.json()["items"])==1
    assert items.json()["items"][0]["causal_evidence_verified"] is False
    with store.trusted() as c:
        count=c.execute(text("""
            select count(*) from public.crm_booking_offer_links_shadow
            where booking_id=cast(:booking as uuid)
        """),{"booking":booking["id"]}).scalar_one()
        assert count==1
        assert c.execute(text("""
            select count(*) from public.crm_attribution_records
            where organization_id=cast(:org as uuid) and billable=true
        """),{"org":org}).scalar_one()==0
    # SQL constraints are independently enforced, not just API-side validation.
    import pytest
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
                insert into public.crm_booking_offer_links_shadow
                (organization_id,booking_id,offer_id,booking_snapshot_key,
                 event_key,tracking_digest,outcome,causal_evidence_verified)
                values(cast(:org as uuid),cast(:booking as uuid),cast(:offer as uuid),
                       :snapshot,:key,:digest,'observed_match',true)
            """),{"org":org,"booking":booking["id"],"offer":offer_id,
                   "snapshot":core_snapshot_key(dict(booking)),
                   "key":"f"*64,"digest":"a"*64})
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
                update public.crm_booking_offer_links_shadow set outcome='ambiguous'
                where booking_id=cast(:booking as uuid)
            """),{"booking":booking["id"]})


def test_offline_provider_ledger_rejects_cross_tenant_and_mutation(fill_today):
    import hashlib
    import pytest
    url,store,uid,org,court=fill_today
    with store.trusted() as c:
        conn=c.execute(text("""
            insert into public.provider_connections (organization_id,provider)
            values(cast(:org as uuid),'playtomic') returning id::text
        """),{"org":org}).scalar_one()
        params={"org":org,"conn":conn,"id":"evt-01","key":"a"*64,"sha":"b"*64}
        statement=text("""
          insert into public.crm_provider_events_offline
            (organization_id,provider_connection_id,provider,event_id,provider_sequence,
             booking_reference,event_state,event_key,payload_sha256,event_occurred_at,signed_at)
          values(cast(:org as uuid),cast(:conn as uuid),'playtomic',:id,5,
                 'external-booking-1','confirmed',:key,:sha,now(),now())
        """)
        c.execute(statement,params)
        assert c.execute(text("""
            select count(*) from public.crm_provider_events_offline
            where provider_connection_id=cast(:conn as uuid)
        """),{"conn":conn}).scalar_one()==1
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(statement,params)
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(statement,{**params,"org":str(uuid.uuid4()),"id":"evt-02","key":"c"*64})
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
                update public.crm_provider_events_offline set event_state='cancelled'
                where provider_connection_id=cast(:conn as uuid)
            """),{"conn":conn})


def test_f07_reconciliation_core_cancel_idempotency_and_rollback(fill_today):
    """Real PG16 DB-backed integration; all writes are fictional/shadow-only."""
    url,store,uid,org,court=fill_today
    settings=Settings(origin="https://fill.test",environment="test",database=url,
                      supabase_url="https://example.supabase.co",
                      supabase_publishable_key="sb_publishable_ci",data_contract="supabase-v1")
    client=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(uid)))
    hdr={"Authorization":"Bearer ci-owner-token"}
    with store.trusted() as c:
        booking=c.execute(text("""
            select id::text from public.bookings
            where organization_id=cast(:org as uuid) and status='confirmed' limit 1
        """),{"org":org}).scalar_one()
    api=f"/api/fmc/{org}/bookings/{booking}/reconcile-shadow"
    assert client.post(api,headers=hdr).status_code==409
    first=client.post(f"/api/fmc/{org}/attributions/evaluate-shadow",
                      headers=hdr,json={"booking_id":booking})
    assert first.status_code==200,first.text
    rec=client.post(api,headers=hdr)
    assert rec.status_code==200,rec.text
    assert rec.json()["proposed_maturity"]=="provisional"
    assert rec.json()["maturity_applied"] and rec.json()["new_evidence"]
    assert rec.json()["fee_minor"]==0 and not rec.json()["billable"]
    repeat=client.post(api,headers=hdr)
    assert repeat.status_code==200 and not repeat.json()["new_evidence"]
    assert not repeat.json()["maturity_applied"]
    # Cancel the fictional Core record only inside the test DB.
    with store.trusted() as c:
        c.execute(text("""
            update public.bookings set status='cancelled',updated_at=now()+interval '1 minute'
            where id=cast(:booking as uuid)
        """),{"booking":booking})
    assert client.post(api,headers=hdr).status_code==409
    after=client.post(f"/api/fmc/{org}/attributions/evaluate-shadow",
                      headers=hdr,json={"booking_id":booking})
    assert after.status_code==200 and after.json()["maturity"]=="unverified"
    cancelled=client.post(api,headers=hdr)
    assert cancelled.status_code==200,cancelled.text
    assert cancelled.json()["proposed_maturity"]=="unverified"
    hist=client.get(f"/api/fmc/{org}/bookings/{booking}/reconciliation-history",headers=hdr)
    assert hist.status_code==200 and len(hist.json()["items"])==2
    assert all(x["billable"] is False and x["fee_minor"]==0 for x in hist.json()["items"])
    with store.trusted() as c:
        assert c.execute(text("""
            select maturity from public.crm_attribution_records
            where booking_id=cast(:booking as uuid)
        """),{"booking":booking}).scalar_one()=="unverified"
    for sql in [
       "update public.crm_shadow_reconciliation_observations set fee_minor=1 where booking_id=cast(:booking as uuid)",
       "delete from public.crm_shadow_reconciliation_observations where booking_id=cast(:booking as uuid)",
    ]:
        with pytest.raises(Exception):
            with store.trusted() as c:
                c.execute(text(sql),{"booking":booking})
    # Aborted SQL statements roll back; pre-existing immutable evidence is preserved.
    with store.trusted() as c:
        count=c.execute(text("""
            select count(*) from public.crm_shadow_reconciliation_observations
            where booking_id=cast(:booking as uuid)
        """),{"booking":booking}).scalar_one()
        assert count==2
        assert c.execute(text("""
            select count(*) from public.crm_attribution_records where booking_id=cast(:booking as uuid)
              and (billable or fee_minor<>0)
        """),{"booking":booking}).scalar_one()==0
    assert client.post(f"/api/fmc/{uuid.uuid4()}/bookings/{booking}/reconcile-shadow",
                       headers=hdr).status_code in (403,404)


def test_f07_external_fixture_dispute_and_db_four_eyes(fill_today):
    url,store,uid,org,court=fill_today
    settings=Settings(origin="https://fill.test",environment="test",database=url,
                      supabase_url="https://example.supabase.co",
                      supabase_publishable_key="sb_publishable_ci",data_contract="supabase-v1")
    client=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(uid)))
    hdr={"Authorization":"Bearer ci-owner-token"}
    with store.trusted() as c:
        booking=c.execute(text("""
            select id::text from public.bookings
            where organization_id=cast(:org as uuid) and status='confirmed' limit 1
        """),{"org":org}).scalar_one()
        c.execute(text("""
          update public.bookings set source='playtomic',external_reference='ext-f07',
              updated_at=now()+interval '1 minute' where id=cast(:booking as uuid)
        """),{"booking":booking})
        conn=c.execute(text("""
          insert into public.provider_connections(organization_id,provider)
          values(cast(:org as uuid),'playtomic') returning id::text
        """),{"org":org}).scalar_one()
        import hashlib,hmac,json
        from fmc.signed_fixture_store import record_signed_provider_fixture
        from datetime import datetime,timezone
        now=datetime.now(timezone.utc).replace(microsecond=0)
        epoch=int(now.timestamp())
        fixture={"schema_version":1,"organization_id":org,"connection_id":conn,
                 "provider":"playtomic","event_id":"evt-refund-f07","sequence":1,
                 "booking_reference":"ext-f07","state":"refunded",
                 "occurred_at":now.isoformat()}
        payload=json.dumps(fixture).encode()
        secret="fixture-F07-regression-only"
        signature=hmac.new(secret.encode(),str(epoch).encode()+b"."+payload,
                           hashlib.sha256).hexdigest()
        event=record_signed_provider_fixture(c,organization_id=org,
                 connection_id=conn,payload=payload,signature_hex=signature,
                 signed_epoch=epoch,fixture_secret=secret,now=now)["event_id"]
    snap=client.post(f"/api/fmc/{org}/attributions/evaluate-shadow",
                     headers=hdr,json={"booking_id":booking})
    assert snap.status_code==200 and snap.json()["maturity"]=="pending_evidence"
    api=f"/api/fmc/{org}/bookings/{booking}/reconcile-shadow"
    observed=client.post(api,headers=hdr)
    assert observed.status_code==200,observed.text
    assert observed.json()["proposed_maturity"]=="disputed"
    assert observed.json()["source_resolution"]=="provider_conflict"
    assert observed.json()["provider_fixture_seen"] is True
    assert observed.json()["refunds_executed"]==0
    with store.trusted() as c:
        attr=c.execute(text("""
          select id::text,maturity from public.crm_attribution_records
          where booking_id=cast(:booking as uuid)
        """),{"booking":booking}).mappings().one()
        assert attr["maturity"]=="disputed"
    # SQL direct injection cannot alter immutable provider facts or maturity ledger.
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
              insert into public.crm_shadow_reconciliation_observations
              (organization_id,booking_id,core_snapshot_key,offline_event_id,
               event_key,booking_status,provider_claim,source_resolution,
               shadow_maturity,reason)
              values(cast(:org as uuid),cast(:booking as uuid),'falsified',
                     cast(:event as uuid),:key,'confirmed','refunded',
                     'provider_conflict','disputed','forged')
            """),{"org":org,"booking":booking,"event":event,"key":"d"*64})
    dispute=client.post(f"/api/fmc/{org}/disputes/shadow",headers=hdr,
        json={"attribution_id":attr["id"],"risk":"high","reason":"Refund fixture is unverified"})
    assert dispute.status_code==201,dispute.text
    case_id=dispute.json()["case"]["id"]
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
                update public.crm_dispute_cases set status='resolved',resolved_at=now()
                where id=cast(:id as uuid)
            """),{"id":case_id})
    proposed=client.post(f"/api/fmc/{org}/disputes/{case_id}/propose",headers=hdr,
                         json={"code":"provider_review_required","note":"External refund not verified"})
    assert proposed.status_code==200,proposed.text
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
                update public.crm_dispute_cases set status='approved',approved_by=cast(:uid as uuid)
                where id=cast(:id as uuid)
            """),{"uid":uid,"id":case_id})
    outsider=str(uuid.uuid4())
    with store.trusted() as c:
        c.execute(text("insert into auth.users(id) values(cast(:uid as uuid))"),{"uid":outsider})
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
                update public.crm_dispute_cases set status='approved',approved_by=cast(:uid as uuid)
                where id=cast(:id as uuid)
            """),{"uid":outsider,"id":case_id})
    approver=str(uuid.uuid4())
    with store.trusted() as c:
        c.execute(text("insert into auth.users(id) values(cast(:uid as uuid))"),{"uid":approver})
        c.execute(text("""
            insert into public.organization_members(organization_id,user_id,role)
            values(cast(:org as uuid),cast(:uid as uuid),'manager')
        """),{"org":org,"uid":approver})
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
                update public.crm_dispute_cases set status='approved',approved_by=cast(:uid as uuid)
                where id=cast(:id as uuid)
            """),{"uid":approver,"id":case_id})
    with store.trusted() as c:
        c.execute(text("""
            update public.organization_members set role='admin'
            where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)
        """),{"org":org,"uid":approver})
    second=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(approver)))
    approved=second.post(f"/api/fmc/{org}/disputes/{case_id}/approve",headers=hdr,
                         json={"note":"Independent admin review, no financial action"})
    assert approved.status_code==200,approved.text
    resolved=client.post(f"/api/fmc/{org}/disputes/{case_id}/resolve",headers=hdr,
                         json={"note":"Closed as no financial action permitted"})
    assert resolved.status_code==200,resolved.text
    for sql in [
        "update public.crm_dispute_cases set status='open' where id=cast(:id as uuid)",
        "update public.crm_dispute_cases set risk='low' where id=cast(:id as uuid)",
    ]:
        with pytest.raises(Exception):
            with store.trusted() as c:
                c.execute(text(sql),{"id":case_id})
    after=client.post(f"/api/fmc/{org}/disputes/evaluate-sla-shadow",headers=hdr)
    assert after.status_code==200 and after.json()["new_escalations"]==0
    history=client.get(f"/api/fmc/{org}/disputes/{case_id}/decisions",headers=hdr)
    assert [x["transition"] for x in history.json()["items"]]==["PROPOSED","APPROVED","RESOLVED"]
    # The fixture removes the tenant and its immutable decision history via cascade.
    # Do not delete an approver before it is removed: the FK ON DELETE SET NULL
    # would rewrite a resolved case and correctly violate the immutable guard.


def test_f08_signature_receipt_adapter_replay_collision_and_claim_filter(fill_today):
    import hashlib, hmac, json
    from datetime import timezone, datetime, timedelta
    from fmc.signed_fixture_store import record_signed_provider_fixture
    from fmc.offline_evidence import EvidenceRejected
    url,store,uid,org,court=fill_today
    settings=Settings(origin="https://fill.test",environment="test",database=url,
                      supabase_url="https://example.supabase.co",
                      supabase_publishable_key="sb_publishable_ci",data_contract="supabase-v1")
    client=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(uid)))
    hdr={"Authorization":"Bearer ci-owner-token"}
    with store.trusted() as c:
        booking=c.execute(text("""
          select id::text from public.bookings
          where organization_id=cast(:org as uuid) and status='confirmed' limit 1
        """),{"org":org}).scalar_one()
        c.execute(text("""
          update public.bookings set source='playtomic',external_reference='f08-ext',
            updated_at=now()+interval '1 minute' where id=cast(:id as uuid)
        """),{"id":booking})
        conn=c.execute(text("""
          insert into public.provider_connections(organization_id,provider)
          values(cast(:org as uuid),'playtomic') returning id::text
        """),{"org":org}).scalar_one()
        # An unsigned fixture is not eligible for source arbitration.
        c.execute(text("""
          insert into public.crm_provider_events_offline
            (organization_id,provider_connection_id,provider,event_id,provider_sequence,
             booking_reference,event_state,event_key,payload_sha256,event_occurred_at,signed_at)
          values(cast(:org as uuid),cast(:conn as uuid),'playtomic','fake-unverified',
                1,'f08-ext','refunded',:key,:digest,now(),now())
        """),{"org":org,"conn":conn,"key":"a"*64,"digest":"b"*64})
    snap=client.post(f"/api/fmc/{org}/attributions/evaluate-shadow",
                     headers=hdr,json={"booking_id":booking})
    assert snap.status_code==200,snap.text
    endpoint=f"/api/fmc/{org}/bookings/{booking}/reconcile-shadow"
    first=client.post(endpoint,headers=hdr)
    assert first.status_code==200 and first.json()["proposed_maturity"]=="pending_evidence"
    assert first.json()["provider_fixture_seen"] is False
    now=datetime.now(timezone.utc).replace(microsecond=0)
    epoch=int(now.timestamp())
    secret="fixture-hmac-key-for-F08-only"
    def envelope(eventid,seq,state="refunded",org_id=org):
        data={"schema_version":1,"organization_id":org_id,"connection_id":conn,
              "provider":"playtomic","event_id":eventid,"sequence":seq,
              "booking_reference":"f08-ext","state":state,
              "occurred_at":now.isoformat()}
        payload=json.dumps(data).encode()
        signature=hmac.new(secret.encode(),str(epoch).encode()+b"."+payload,
                           hashlib.sha256).hexdigest()
        return payload,signature
    p,s=envelope("real-fixture-2",2)
    with store.trusted() as c:
        result=record_signed_provider_fixture(c,organization_id=org,connection_id=conn,
            payload=p,signature_hex=s,signed_epoch=epoch,fixture_secret=secret,now=now)
    assert result["new_evidence"] and result["verified_mode"]=="offline_signed_fixture"
    with store.trusted() as c:
        duplicate=record_signed_provider_fixture(c,organization_id=org,connection_id=conn,
            payload=p,signature_hex=s,signed_epoch=epoch,fixture_secret=secret,now=now)
    assert not duplicate["new_evidence"] and duplicate["receipt_id"]==result["receipt_id"]
    with pytest.raises(EvidenceRejected,match="INVALID_SIGNATURE"):
        with store.trusted() as c:
            record_signed_provider_fixture(c,organization_id=org,connection_id=conn,
                payload=p+b" ",signature_hex=s,signed_epoch=epoch,
                fixture_secret=secret,now=now)
    low,low_sig=envelope("late-sequence",1)
    with pytest.raises(EvidenceRejected,match="STALE_OR_REORDERED_EVENT"):
        with store.trusted() as c:
            record_signed_provider_fixture(c,organization_id=org,connection_id=conn,
                payload=low,signature_hex=low_sig,signed_epoch=epoch,
                fixture_secret=secret,now=now)
    with pytest.raises(EvidenceRejected,match="SOURCE_NOT_FOUND"):
        with store.trusted() as c:
            record_signed_provider_fixture(c,organization_id=str(uuid.uuid4()),
                connection_id=conn,payload=p,signature_hex=s,signed_epoch=epoch,
                fixture_secret=secret,now=now)
    p3,s3=envelope("real-fixture-2",3,"cancelled")
    with pytest.raises(EvidenceRejected,match="EVENT_ID_CONFLICT"):
        with store.trusted() as c:
            record_signed_provider_fixture(c,organization_id=org,connection_id=conn,
                payload=p3,signature_hex=s3,signed_epoch=epoch,
                fixture_secret=secret,now=now)
    second=client.post(endpoint,headers=hdr)
    assert second.status_code==200,second.text
    assert second.json()["proposed_maturity"]=="disputed"
    assert second.json()["provider_fixture_seen"] is True
    assert second.json()["refunds_executed"]==0
    observed=client.get(f"/api/fmc/{org}/bookings/{booking}/reconciliation-history",headers=hdr)
    assert observed.status_code==200 and len(observed.json()["items"])==2
    with store.trusted() as c:
        cnt=c.execute(text("""
          select count(*) from public.crm_provider_signature_receipts_shadow
          where organization_id=cast(:org as uuid)
        """),{"org":org}).scalar_one()
        assert cnt==1
        assert c.execute(text("""
          select count(*) from public.crm_provider_events_offline
          where organization_id=cast(:org as uuid)
        """),{"org":org}).scalar_one()==2
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
              update public.crm_provider_signature_receipts_shadow
              set verification_scheme='forged'
              where id=cast(:id as uuid)
            """),{"id":result["receipt_id"]})


def test_f08_zero_delta_shadow_adjustments_and_multi_tenant_negative(fill_today):
    url,store,uid,org,court=fill_today
    settings=Settings(origin="https://fill.test",environment="test",database=url,
                      supabase_url="https://example.supabase.co",
                      supabase_publishable_key="sb_publishable_ci",data_contract="supabase-v1")
    client=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(uid)))
    hdr={"Authorization":"Bearer ci-owner-token"}
    with store.trusted() as c:
        booking=c.execute(text("""
          select id::text from public.bookings
          where organization_id=cast(:org as uuid) and status='confirmed' limit 1
        """),{"org":org}).scalar_one()
    evaluate=f"/api/fmc/{org}/attributions/evaluate-shadow"
    reconcile=f"/api/fmc/{org}/bookings/{booking}/reconcile-shadow"
    adjust=f"/api/fmc/{org}/bookings/{booking}/adjustment-observe-shadow"
    assert client.post(adjust,headers=hdr,
         json={"observation_id":str(uuid.uuid4()),"kind":"cancellation"}).status_code==404
    assert client.post(evaluate,headers=hdr,json={"booking_id":booking}).status_code==200
    rec=client.post(reconcile,headers=hdr)
    assert rec.status_code==200 and rec.json()["new_evidence"]
    assert client.post(adjust,headers=hdr,
         json={"observation_id":rec.json()["observation_id"],"kind":"cancellation"}).status_code==422
    with store.trusted() as c:
        c.execute(text("""
          update public.bookings set status='cancelled',updated_at=now()+interval '2 minutes'
          where id=cast(:id as uuid)
        """),{"id":booking})
    assert client.post(evaluate,headers=hdr,json={"booking_id":booking}).status_code==200
    assert client.post(adjust,headers=hdr,
         json={"observation_id":rec.json()["observation_id"],"kind":"cancellation"}).status_code==409
    newer=client.post(reconcile,headers=hdr)
    assert newer.status_code==200 and newer.json()["proposed_maturity"]=="unverified"
    payload={"observation_id":newer.json()["observation_id"],"kind":"cancellation"}
    accepted=client.post(adjust,headers=hdr,json=payload)
    assert accepted.status_code==200,accepted.text
    assert accepted.json()["delta_minor"]==0 and accepted.json()["refunds_executed"]==0
    assert accepted.json()["new_evidence"]
    repeat=client.post(adjust,headers=hdr,json=payload)
    assert repeat.status_code==200 and repeat.json()["new_evidence"] is False
    assert client.post(adjust,headers=hdr,
         json={**payload,"kind":"full_refund"}).status_code==422
    assert client.post(f"/api/fmc/{uuid.uuid4()}/bookings/{booking}/adjustment-observe-shadow",
         headers=hdr,json=payload).status_code in (403,404)
    items=client.get(f"/api/fmc/{org}/attribution-adjustments",headers=hdr)
    assert items.status_code==200,items.text
    assert len(items.json()["items"])==1
    assert items.json()["items"][0]["source_observation_id"]==payload["observation_id"]
    with store.trusted() as c:
        attr=c.execute(text("""
          select id::text from public.crm_attribution_records where booking_id=cast(:id as uuid)
        """),{"id":booking}).scalar_one()
    for source,delta in [(payload["observation_id"],10),(str(uuid.uuid4()),0)]:
        with pytest.raises(Exception):
            with store.trusted() as c:
                c.execute(text("""
                  insert into public.crm_attribution_adjustments
                   (organization_id,attribution_id,kind,delta_minor,evidence,
                    correction_reference,created_by,source_observation_id)
                  values(cast(:org as uuid),cast(:attr as uuid),'cancellation',:delta,
                    '{"shadow_only":true,"financial_execution":false,"causal_evidence_verified":false}'::jsonb,
                    'forged',cast(:uid as uuid),cast(:observation as uuid))
                """),{"org":org,"attr":attr,"delta":delta,"uid":uid,"observation":source})
    with store.trusted() as c:
        assert c.execute(text("""
          select count(*) from public.crm_attribution_adjustments where organization_id=cast(:org as uuid)
        """),{"org":org}).scalar_one()==1
        assert c.execute(text("""
          select count(*) from public.crm_attribution_records
          where organization_id=cast(:org as uuid) and (billable or fee_minor<>0)
        """),{"org":org}).scalar_one()==0


def test_f09_offer_proof_single_competing_stale_and_closed_booking(fill_today):
    """No provider, payment or customer transport: fictional DB-only evidence."""
    url,store,uid,org,court=fill_today
    settings=Settings(origin="https://fill.test",environment="test",database=url,
                      supabase_url="https://example.supabase.co",
                      supabase_publishable_key="sb_publishable_ci",data_contract="supabase-v1")
    client=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(uid)))
    hdr={"Authorization":"Bearer ci-owner-token"}
    with store.trusted() as c:
        b=c.execute(text("""
            select id::text,court_id::text,starts_at,ends_at from public.bookings
            where organization_id=cast(:org as uuid) and status='confirmed' limit 1
        """),{"org":org}).mappings().one()
        venue=c.execute(text("""
            select id::text from public.venues where organization_id=cast(:org as uuid) limit 1
        """),{"org":org}).scalar_one()
        opp=c.execute(text("""
            insert into public.revenue_opportunities
              (organization_id,venue_id,court_id,opportunity_key,target_date,
               window_starts_at,window_ends_at,currency)
            values(cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),
                   :key,:date,:start,:end,'EUR') returning id::text
        """),{"org":org,"venue":venue,"court":court,"key":uuid.uuid4().hex,
              "date":b["starts_at"].date(),"start":b["starts_at"],"end":b["ends_at"]}).scalar_one()
        action=c.execute(text("""
            insert into public.crm_actions
             (organization_id,opportunity_id,quote_amount_minor,currency,opportunity_version_at_plan)
            values(cast(:org as uuid),cast(:opp as uuid),3600,'EUR',now()) returning id::text
        """),{"org":org,"opp":opp}).scalar_one()
        offers=[]
        for wave in (1,2):
            token="crm_"+uuid.uuid4().hex
            offer=c.execute(text("""
                insert into public.crm_offers
                 (organization_id,action_id,opportunity_id,wave_number,tracking_token,
                  target_court_id,target_starts_at,target_ends_at,authoritative_price_minor,
                  offered_price_minor,currency,expires_at,attribution_window_ends_at)
                values(cast(:org as uuid),cast(:action as uuid),cast(:opp as uuid),:wave,
                       :token,cast(:court as uuid),:start,:end,3600,3600,'EUR',
                       now()+interval '1 day',now()+interval '2 days') returning id::text
            """),{"org":org,"action":action,"opp":opp,"wave":wave,"token":token,
                  "court":court,"start":b["starts_at"],"end":b["ends_at"]}).scalar_one()
            offers.append((offer,token))
    path=f"/api/fmc/{org}/bookings/{b['id']}/offer-proof-evaluate-shadow"
    assert client.post(path,headers=hdr).status_code==409
    assert client.post(f"/api/fmc/{org}/attributions/evaluate-shadow",headers=hdr,
                       json={"booking_id":b["id"]}).status_code==200
    empty=client.post(path,headers=hdr)
    assert empty.status_code==200 and empty.json()["outcome"]=="NO_ASSOCIATION"
    assert empty.json()["primary_offer_id"] is None
    link=f"/api/fmc/{org}/attributions/link-offer-shadow"
    first=client.post(link,headers=hdr,
                      json={"booking_id":b["id"],"offer_id":offers[0][0],
                            "tracking_token":offers[0][1]})
    assert first.status_code==200,first.text
    one=client.post(path,headers=hdr)
    assert one.status_code==200 and one.json()["outcome"]=="OBSERVED_ONLY"
    assert one.json()["candidate_offer_ids"]==[offers[0][0]]
    again=client.post(path,headers=hdr)
    assert again.status_code==200 and not again.json()["new_evidence"]
    second=client.post(link,headers=hdr,
                       json={"booking_id":b["id"],"offer_id":offers[1][0],
                             "tracking_token":offers[1][1]})
    assert second.status_code==200,second.text
    tied=client.post(path,headers=hdr)
    assert tied.status_code==200 and tied.json()["outcome"]=="COMPETING_OFFERS"
    assert tied.json()["candidate_count"]==2 and tied.json()["primary_offer_id"] is None
    assert tied.json()["fee_minor"]==0 and tied.json()["billable"] is False
    assert client.post(f"/api/fmc/{uuid.uuid4()}/bookings/{b['id']}/offer-proof-evaluate-shadow",
                       headers=hdr).status_code in (403,404)
    hist=client.get(f"/api/fmc/{org}/bookings/{b['id']}/offer-proof-history",headers=hdr)
    assert hist.status_code==200 and len(hist.json()["items"])==3
    with store.trusted() as c:
        assert c.execute(text("""
            select count(*) from public.crm_offer_proof_reviews_shadow
            where organization_id=cast(:org as uuid) and
             (billable or fee_minor<>0 or causal_evidence_verified or primary_offer_id is not null)
        """),{"org":org}).scalar_one()==0
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
              update public.crm_offer_proof_reviews_shadow set outcome='OBSERVED_ONLY'
              where organization_id=cast(:org as uuid)
            """),{"org":org})
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
              insert into public.crm_offer_proof_reviews_shadow
               (organization_id,booking_id,core_snapshot_key,event_key,outcome,
                candidate_offer_ids,candidate_count,created_by)
              values(cast(:org as uuid),cast(:booking as uuid),:snapshot,:event,
                     'OBSERVED_ONLY',cast(:offers as jsonb),1,cast(:uid as uuid))
            """),{"org":org,"booking":b["id"],"snapshot":"f"*64,
                  "event":"e"*64,"offers":__import__("json").dumps([str(uuid.uuid4())]),"uid":uid})
    with store.trusted() as c:
        c.execute(text("""
          update public.bookings set status='cancelled',updated_at=now()+interval '3 minutes'
          where id=cast(:booking as uuid)
        """),{"booking":b["id"]})
    assert client.post(path,headers=hdr).status_code==409
    observed=client.post(f"/api/fmc/{org}/attributions/evaluate-shadow",
                         headers=hdr,json={"booking_id":b["id"]})
    assert observed.status_code==200 and observed.json()["maturity"]=="unverified"
    stale=client.post(path,headers=hdr)
    assert stale.status_code==200 and stale.json()["outcome"]=="BOOKING_NOT_ACTIVE"
    assert stale.json()["candidate_count"]==0 and not stale.json()["causal_evidence_verified"]


def test_f10_signed_core_shaped_pathway_fixture_db_contract(fill_today):
    """A cryptographic fixture chain is NOT Core-origin proof or earned revenue."""
    import hashlib,hmac,json
    from datetime import datetime,timezone,timedelta
    from fmc.core_pathway_fixture import record_pathway_fixture
    from fmc.offline_evidence import EvidenceRejected
    from fmc.revenue_evidence import core_snapshot_key
    url,store,uid,org,court=fill_today
    settings=Settings(origin="https://fill.test",environment="test",database=url,
                      supabase_url="https://example.supabase.co",
                      supabase_publishable_key="sb_publishable_ci",data_contract="supabase-v1")
    client=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(uid)))
    hdr={"Authorization":"Bearer ci-owner-token"}
    with store.trusted() as c:
        booking=c.execute(text("""
            select id::text,source,status::text,court_id::text,starts_at,ends_at,updated_at
            from public.bookings where organization_id=cast(:org as uuid) and status='confirmed' limit 1
        """),{"org":org}).mappings().one()
        venue=c.execute(text("select id::text from public.venues where organization_id=cast(:org as uuid) limit 1"),{"org":org}).scalar_one()
        opp=c.execute(text("""
          insert into public.revenue_opportunities
            (organization_id,venue_id,court_id,opportunity_key,target_date,
             window_starts_at,window_ends_at,currency)
          values(cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),
                 :key,:date,:start,:end,'EUR') returning id::text
        """),{"org":org,"venue":venue,"court":court,"key":uuid.uuid4().hex,
               "date":booking["starts_at"].date(),"start":booking["starts_at"],"end":booking["ends_at"]}).scalar_one()
        act=c.execute(text("""
          insert into public.crm_actions
            (organization_id,opportunity_id,quote_amount_minor,currency,opportunity_version_at_plan)
          values(cast(:org as uuid),cast(:opp as uuid),3600,'EUR',now()) returning id::text
        """),{"org":org,"opp":opp}).scalar_one()
        token="crm_"+uuid.uuid4().hex
        offer=c.execute(text("""
          insert into public.crm_offers
            (organization_id,action_id,opportunity_id,tracking_token,target_court_id,
             target_starts_at,target_ends_at,authoritative_price_minor,
             offered_price_minor,currency,expires_at,attribution_window_ends_at)
          values(cast(:org as uuid),cast(:act as uuid),cast(:opp as uuid),
                 :token,cast(:court as uuid),:start,:end,3600,3600,'EUR',
                 now()+interval '1 day',now()+interval '2 days') returning id::text
        """),{"org":org,"act":act,"opp":opp,"token":token,"court":court,
               "start":booking["starts_at"],"end":booking["ends_at"]}).scalar_one()
    ready=f"/api/fmc/{org}/bookings/{booking['id']}/pathway-readiness"
    absent=client.get(ready,headers=hdr)
    assert absent.status_code==200 and absent.json()["readiness"]=="NO_PATH_FIXTURE"
    assert client.get(f"/api/fmc/{uuid.uuid4()}/bookings/{booking['id']}/pathway-readiness",
                      headers=hdr).status_code in (403,404)
    before=client.post(f"/api/fmc/{org}/attributions/evaluate-shadow",headers=hdr,
                       json={"booking_id":booking["id"]})
    assert before.status_code==200,before.text
    link=client.post(f"/api/fmc/{org}/attributions/link-offer-shadow",headers=hdr,
                     json={"booking_id":booking["id"],"offer_id":offer,"tracking_token":token})
    assert link.status_code==200,link.text
    with store.trusted() as c:
        snap=core_snapshot_key(dict(booking))
        linkrow=c.execute(text("""
           select event_key from public.crm_booking_offer_links_shadow
           where organization_id=cast(:org as uuid) and booking_id=cast(:booking as uuid)
             and offer_id=cast(:offer as uuid)
        """),{"org":org,"booking":booking["id"],"offer":offer}).scalar_one()
    pathid=str(uuid.uuid4())
    now=datetime.now(timezone.utc).replace(microsecond=0)
    epoch=int(now.timestamp())
    secret="f10-temporary-test-only-HMAC-key"
    def fixture(seq,prior=None,eventid=None,occurred=None,path_override=pathid):
        data=dict(schema_version=1,organization_id=org,booking_id=booking["id"],
           offer_id=offer,path_id=path_override,event_id=eventid or f"step-{seq}",
           sequence=seq,state="BOOKING_STARTED" if seq==1 else "BOOKING_CONFIRMED",
           snapshot_key=snap,offer_link_key=linkrow,
           prior_event_key=prior,occurred_at=(occurred or now).isoformat())
        payload=json.dumps(data).encode()
        sig=hmac.new(secret.encode(),b"fmc-core-path-fixture-v1."+
             str(epoch).encode()+b"."+payload,hashlib.sha256).hexdigest()
        return payload,sig
    def write(p,s,organization=org):
        with store.trusted() as c:
            return record_pathway_fixture(c,organization_id=organization,
                       booking_id=booking["id"],offer_id=offer,payload=p,
                       signature_hex=s,signed_epoch=epoch,fixture_secret=secret,now=now)
    secondp,seconds=fixture(2,"a"*64)
    with pytest.raises(EvidenceRejected,match="PATH_START_REQUIRED"):
        write(secondp,seconds)
    startp,starts=fixture(1)
    first=write(startp,starts)
    assert first["new_evidence"] is True and not first["causal_evidence_verified"]
    assert write(startp,starts)["new_evidence"] is False
    with pytest.raises(EvidenceRejected,match="INVALID_SIGNATURE"):
        write(startp+b" ",starts)
    badp,bads=fixture(2,"b"*64)
    with pytest.raises(EvidenceRejected,match="INVALID_CHAIN_OR_ORDER"):
        write(badp,bads)
    confirmedp,confirmeds=fixture(2,first["event_key"])
    success=write(confirmedp,confirmeds)
    assert success["new_evidence"] is True
    got=client.get(ready,headers=hdr)
    assert got.status_code==200,got.text
    assert got.json()["readiness"]=="FIXTURE_CHAIN_COMPLETE_NONCAUSAL"
    assert got.json()["fixture_event_count"]==2
    assert got.json()["core_origin_verified"] is False
    assert got.json()["causal_evidence_verified"] is False
    assert got.json()["fee_minor"]==0 and got.json()["billable"] is False
    # The tenant-scoped Core lookup fails before fixture identity parsing.
    with pytest.raises(EvidenceRejected,match="CORE_AUTHORITY_NOT_CONFIRMED"):
        write(startp,starts,organization=str(uuid.uuid4()))
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
              update public.crm_core_pathway_fixtures_shadow
              set causal_evidence_verified=true where event_key=:key
            """),{"key":first["event_key"]})
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
              insert into public.crm_core_pathway_fixtures_shadow
               (organization_id,booking_id,offer_id,core_snapshot_key,offer_link_event_key,
                path_id,event_id,sequence,state,event_key,payload_sha256,signature_digest,
                occurred_at,signed_epoch)
              values(cast(:org as uuid),cast(:booking as uuid),cast(:offer as uuid),
                     :snapshot,:link,cast(:path as uuid),'forged',1,'BOOKING_STARTED',
                     :event,:payload,:signature,now(),extract(epoch from now())::bigint)
            """),{"org":org,"booking":booking["id"],"offer":str(uuid.uuid4()),
                  "snapshot":snap,"link":linkrow,"path":str(uuid.uuid4()),
                  "event":"f"*64,"payload":"a"*64,"signature":"b"*64})
    with store.trusted() as c:
        c.execute(text("""
           update public.bookings set status='cancelled',updated_at=now()+interval '1 minute'
           where id=cast(:booking as uuid)
        """),{"booking":booking["id"]})
    no=client.get(ready,headers=hdr)
    assert no.status_code==200 and no.json()["readiness"]=="BOOKING_NOT_ACTIVE"
    assert no.json()["fixture_event_count"]==0


def test_f11_offline_ed25519_core_attestation_registry_and_security(fill_today):
    """Fictional DB authority + fixture keys. No real Core signing integration."""
    import hashlib,json
    from datetime import datetime,timedelta,timezone
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    from fmc.core_attestation_contract import DOMAIN,record_core_attestation_fixture
    from fmc.offline_evidence import EvidenceRejected
    from fmc.revenue_evidence import core_snapshot_key

    url,store,owner,org,court=fill_today
    settings=Settings(origin="https://fill.test",environment="test",database=url,
                      supabase_url="https://example.supabase.co",
                      supabase_publishable_key="sb_publishable_ci",data_contract="supabase-v1")
    client=TestClient(create_v1_app(settings,"operations",auth_override=StaticAuth(owner)))
    hdr={"Authorization":"Bearer ci-owner-token"}
    with store.trusted() as c:
        b=c.execute(text("""
          select id::text,organization_id::text,status::text,source,updated_at
          from public.bookings where organization_id=cast(:org as uuid)
            and status='confirmed' limit 1
        """),{"org":org}).mappings().one()
    endpoint=f"/api/fmc/{org}/bookings/{b['id']}/core-attestation-readiness"
    assert client.get(endpoint,headers=hdr).json()["readiness"]=="NO_ATTESTATION_EVIDENCE"
    assert client.get(f"/api/fmc/{uuid.uuid4()}/bookings/{b['id']}/core-attestation-readiness",
                      headers=hdr).status_code in (403,404)
    key=Ed25519PrivateKey.generate()
    pub=key.public_key().public_bytes(encoding=serialization.Encoding.Raw,
                                      format=serialization.PublicFormat.Raw)
    key_id=hashlib.sha256(pub).hexdigest()
    issuer=str(uuid.uuid4())
    now=datetime.now(timezone.utc).replace(microsecond=0)
    with store.trusted() as c:
        c.execute(text("""
           insert into public.crm_core_attestation_fixture_keys
             (organization_id,issuer_instance_id,key_id,public_key_hex,
              registered_by,valid_from,valid_until)
           values(cast(:org as uuid),cast(:issuer as uuid),:key_id,:pub,
                  cast(:actor as uuid),:start,:end)
        """),{"org":org,"issuer":issuer,"key_id":key_id,"pub":pub.hex(),
              "actor":owner,"start":now-timedelta(minutes=5),
              "end":now+timedelta(minutes=5)})
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
                insert into public.crm_core_attestation_fixture_keys
                (organization_id,issuer_instance_id,key_id,public_key_hex,
                 registered_by,valid_from,valid_until)
                values(cast(:org as uuid),cast(:issuer as uuid),:key_id,:pub,
                       cast(:actor as uuid),:start,:end)
            """),{"org":org,"issuer":str(uuid.uuid4()),"key_id":"f"*64,
                  "pub":pub.hex(),"actor":owner,"start":now,
                  "end":now+timedelta(minutes=5)})
    def envelope(event_id=None,status="confirmed",source="getacourt"):
        record=dict(schema_version=1,issuer="fmc-core-fixture",
               issuer_instance_id=issuer,key_id=key_id,organization_id=org,
               booking_id=b["id"],event_id=event_id or str(uuid.uuid4()),
               booking_source=source,booking_status=status,
               booking_updated_at=b["updated_at"].isoformat(),
               core_snapshot_key=core_snapshot_key(b),
               occurred_at=now.isoformat(),
               expires_at=(now+timedelta(minutes=2)).isoformat())
        raw=json.dumps(record).encode()
        return raw,key.sign(DOMAIN+raw)
    payload,signature=envelope()
    def write(raw,sig,organization=org):
        with store.trusted() as c:
            return record_core_attestation_fixture(c,
                organization_id=organization,booking_id=b["id"],
                issuer_instance_id=issuer,key_id=key_id,
                payload=raw,signature=sig,now=now)
    with pytest.raises(EvidenceRejected,match="UNREGISTERED_FIXTURE_KEY"):
        with store.trusted() as c:
            record_core_attestation_fixture(c,organization_id=org,
                booking_id=b["id"],issuer_instance_id=issuer,key_id="0"*64,
                payload=payload,signature=signature,now=now)
    assert client.post(f"/api/fmc/{org}/attributions/evaluate-shadow",
        json={"booking_id":b["id"]},headers=hdr).status_code==200
    first=write(payload,signature)
    assert first["new_evidence"] and first["cryptographic_fixture_valid"]
    assert not first["core_origin_verified"] and first["fee_minor"]==0
    replay=write(payload,signature)
    assert replay["new_evidence"] is False and replay["attestation_id"]==first["attestation_id"]
    with pytest.raises(EvidenceRejected,match="INVALID_SIGNATURE"):
        write(payload+b" ",signature)
    with pytest.raises(EvidenceRejected,match="CORE_AUTHORITY_NOT_CONFIRMED"):
        write(payload,signature,organization=str(uuid.uuid4()))
    read=client.get(endpoint,headers=hdr)
    assert read.status_code==200,read.text
    assert read.json()["readiness"]=="CRYPTOGRAPHIC_FIXTURE_VALID_CORE_ORIGIN_UNTRUSTED"
    assert read.json()["fixture_count"]==1
    assert read.json()["core_origin_verified"] is False
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
               update public.crm_core_attestation_checks_shadow
               set core_origin_verified=true where id=cast(:id as uuid)
            """),{"id":first["attestation_id"]})
    with pytest.raises(Exception):
        with store.trusted() as c:
            c.execute(text("""
               insert into public.crm_core_attestation_checks_shadow
                 (organization_id,booking_id,fixture_key_id,issuer_instance_id,event_id,
                  event_key,core_snapshot_key,booking_status,booking_source,
                  booking_updated_at,occurred_at,expires_at,payload_sha256,signature_sha256)
               select cast(:org as uuid),b.id,k.id,k.issuer_instance_id,
                      cast(:event as uuid),:event_key,:snapshot,'confirmed',b.source,
                      b.updated_at,:now,:expires,:payload,:signature
               from public.bookings b
               cross join public.crm_core_attestation_fixture_keys k
               where b.id=cast(:booking as uuid)
                 and k.organization_id=cast(:org as uuid) limit 1
            """),{"org":org,"booking":b["id"],"event":str(uuid.uuid4()),
                  "event_key":"b"*64,"snapshot":"f"*64,"now":now,
                  "expires":now+timedelta(minutes=2),
                  "payload":"a"*64,"signature":"a"*64})
    with store.trusted() as c:
        c.execute(text("""
           update public.bookings set status='cancelled',updated_at=now()+interval '2 minutes'
           where id=cast(:booking as uuid)
        """),{"booking":b["id"]})
    cancelled=client.get(endpoint,headers=hdr)
    assert cancelled.status_code==200 and cancelled.json()["readiness"]=="BOOKING_NOT_ACTIVE"
    assert cancelled.json()["fixture_count"]==0
    assert cancelled.json()["billable"] is False
@pytest.mark.parametrize("mode", ["keep", "revoke"])
def test_fill_calendar_final_membership_contract(fill_today, capsys, monkeypatch, mode):
    from contextlib import ExitStack, contextmanager
    from threading import get_ident

    from fmc import v1_app
    from fmc.supabase_v1 import one

    url, store, user_id, org_id, _ = fill_today

    def require(condition, message):
        if not condition:
            pytest.fail(message, pytrace=False)

    # Only these nonsecret mode keys are checked, only in disposable CI.
    # Never enable, rewrite or unset a mode to make this observation run.
    for key in ("FILL_UAT_GUARD", "FILL_UAT_BOOTSTRAP", "FILL_UAT_SERVER_VALIDATOR"):
        require(os.environ.get(key, "off") == "off", "Calendar observation requires disabled UAT modes.")

    trace = []
    state = {
        "constructor_calls": 0, "user_contexts": 0, "role_attempts": 0,
        "role_successes": 0, "role_denials": 0, "denial_code": None, "denial_status": None,
        "trusted_closed": False, "user_closed": False, "deleted": 0,
        "lifecycle_closed": False, "thread": None, "user_exit": None,
    }

    class ConnectionObserver:
        def __init__(self, native):
            self.native = native

        def execute(self, statement, params=None):
            require(get_ident() == state["thread"], "Calendar native observer changed execution chain.")
            query = " ".join(str(statement).lower().split())
            if query.startswith("select role::text from public.organization_members "):
                phase = "role"
            elif " from public.bookings b " in query:
                phase = "bookings"
            elif " from public.booking_holds " in query:
                phase = "holds"
            elif " from public.court_blocks " in query:
                phase = "blocks"
            else:
                pytest.fail("Calendar observation encountered unsupported native SQL.", pytrace=False)
            require(type(params) is dict and params.get("org") == org_id,
                    "Calendar native organization scope changed.")
            if phase == "role":
                require(params.get("uid") == user_id, "Calendar native membership scope changed.")
            else:
                require(state["role_successes"] >= 1 and state["trusted_closed"],
                        "Calendar payload preceded accepted role or committed hook.")
            trace.append(phase + "_entered")
            result = self.native.execute(statement, params)
            trace.append(phase + "_returned")
            # The original CursorResult goes to original one()/rows(). The next
            # query/response demonstrates materialization; no result is wrapped.
            return result

    class StoreObserver:
        engine = store.engine

        @contextmanager
        def user(self, uid):
            require(uid == user_id, "Calendar user scope changed.")
            state["user_contexts"] += 1
            require(state["user_contexts"] == 1, "Calendar acquired an additional user context.")
            state["thread"] = get_ident()
            # Both original connections are acquired/used in this same handler
            # chain. No connection crosses from the main test thread.
            with ExitStack() as trusted_stack:
                trusted = trusted_stack.enter_context(store.trusted())
                trace.append("trusted_acquired")
                trusted.execute(text("SET LOCAL lock_timeout='500ms'"))
                trusted.execute(text("SET LOCAL statement_timeout='1000ms'"))
                self.trusted, self.trusted_stack = trusted, trusted_stack
                try:
                    with store.user(uid) as native:
                        require(native is not trusted, "Calendar native contexts were not distinct.")
                        trace.append("user_acquired")
                        native.execute(text("SET LOCAL lock_timeout='500ms'"))
                        native.execute(text("SET LOCAL statement_timeout='1000ms'"))
                        for query, expected in (("SHOW transaction_isolation", "read committed"),
                                                ("SHOW transaction_read_only", "off")):
                            row = one(native.execute(text(query)))
                            require(type(row) is dict and len(row) == 1,
                                    "Calendar native transaction mode shape is unsupported.")
                            value, = row.values()
                            require(type(value) is str and value == expected,
                                    "Calendar native transaction mode is unsupported.")
                        trace.append("user_mode_confirmed")
                        yield ConnectionObserver(native)
                except DomainError:
                    # Preserve an actual handler denial after original context
                    # unwinding, never substitute a role or an exception.
                    state["user_closed"] = True
                    state["user_exit"] = "denial_unwound"
                    trace.append("user_closed")
                    raise
                else:
                    state["user_closed"] = True
                    state["user_exit"] = "normal"
                    trace.append("user_closed")

        def require_role(self, connection, org, uid, allowed=None):
            require(get_ident() == state["thread"], "Calendar role changed execution chain.")
            require(org == org_id and uid == user_id and allowed is None,
                    "Calendar role arguments changed.")
            state["role_attempts"] += 1
            attempt = state["role_attempts"]
            trace.append("role_attempted")
            try:
                actual_role = store.require_role(connection, org, uid, allowed)
            except DomainError as denied:
                state["role_denials"] += 1
                state["denial_code"], state["denial_status"] = denied.code, denied.status
                trace.append("role_denied")
                raise  # Preserve the actual original denial, never synthesize it.
            # Every success consumed the actual native membership row. Genuine
            # later calls are delegated and return their own uncached scalar.
            state["role_successes"] += 1
            require(actual_role == "owner", "Calendar native role observation is unsupported.")
            trace.append("role_accepted" if attempt == 1 else "role_rechecked")
            if attempt == 1:
                if mode == "revoke":
                    deleted = self.trusted.execute(text("""
                        delete from public.organization_members
                        where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)
                    """), {"org": org_id, "uid": user_id})
                    require(deleted.rowcount == 1, "Calendar membership mutation was inconclusive.")
                    state["deleted"] = deleted.rowcount
                    trace.append("member_deleted")
                # One normal close, only after the initial actual role success.
                # No second mutation, cached role or in-recheck checkout.
                self.trusted_stack.close()
                state["trusted_closed"] = True
                trace.append("trusted_closed")
            return actual_role

        def __getattr__(self, name):
            return getattr(store, name)

    observer = StoreObserver()

    def bind_existing(database):
        state["constructor_calls"] += 1
        require(state["constructor_calls"] == 1 and database == url,
                "Calendar factory did not bind the existing fixture store.")
        require(observer.engine is store.engine, "Calendar factory engine identity changed.")
        return observer

    monkeypatch.setattr(v1_app, "V1Store", bind_existing)
    settings = Settings(
        origin="https://fill.test", environment="test", database=url,
        supabase_url="https://example.supabase.co", supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )
    try:
        app = create_v1_app(settings, "operations", auth_override=StaticAuth(user_id))
        require(state["constructor_calls"] == 1, "Calendar factory binding was not exercised.")
        guard = app.state.fill_uat_guard
        require(guard.lease is None and guard.ledger is None and guard.admin is None
                and guard.bootstrap is None and guard.cleanup_error is False,
                "Calendar observation requires the real disabled guard.")
        with TestClient(app) as client:
            trace.append("lifecycle_entered")
            response = client.get(
                f"/api/fmc/{org_id}/calendar",
                params={"start": "2026-10-05T00:00:00+01:00", "end": "2026-10-06T00:00:00+01:00"},
                headers={"Authorization": "Bearer ci-owner-token"},
            )
            trace.append("response_returned")
        state["lifecycle_closed"] = True
        trace.append("lifecycle_closed")
    except Exception:
        # Keep the native exception path intact through the real handler/client;
        # fail at the test boundary without dumping SQL parameters or credentials.
        with capsys.disabled():
            print("FILL_CALENDAR_POSTROLE_MEMBERSHIP_PG_INCONCLUSIVE case=" + mode
                  + " outcome=native_or_lifecycle_error")
        pytest.fail("Calendar native observation was inconclusive.", pytrace=False)

    require(state["trusted_closed"] and state["user_closed"] and state["lifecycle_closed"]
            and state["user_contexts"] == 1 and state["role_attempts"] in (1, 2)
            and state["role_successes"] + state["role_denials"] == state["role_attempts"],
            "Calendar native contexts or lifecycle did not complete.")
    require(state["deleted"] == (1 if mode == "revoke" else 0),
            "Calendar committed membership observation is incomplete.")
    expected = ["lifecycle_entered", "trusted_acquired", "user_acquired", "user_mode_confirmed",
                "role_attempted", "role_entered", "role_returned", "role_accepted"]
    if mode == "revoke":
        expected.append("member_deleted")
    expected += ["trusted_closed"]
    for phase in ("bookings", "holds", "blocks"):
        expected += [phase + "_entered", phase + "_returned"]
    if state["role_attempts"] == 2:
        expected += ["role_attempted", "role_entered", "role_returned",
                     "role_denied" if state["role_denials"] else "role_rechecked"]
    expected += ["user_closed", "response_returned", "lifecycle_closed"]
    require(trace == expected, "Calendar post-role native payload trace was inconclusive.")

    if response.status_code == 200:
        try:
            body = response.json()
        except Exception:
            pytest.fail("Calendar native response was not a supported JSON payload.", pytrace=False)
        require(type(body) is dict and all(type(body.get(k)) is list for k in ("bookings", "holds", "blocks")),
                "Calendar native response collection shape is unsupported.")
        counts = tuple(len(body[k]) for k in ("bookings", "holds", "blocks"))
        require(0 <= counts[0] <= 2 and counts[1] == 0 and 0 <= counts[2] <= 1,
                "Calendar native observation exceeded its unchanged fixture scope.")
        outcome = "complete" if counts == (2, 0, 1) else "empty" if counts == (0, 0, 0) else "mixed"
    else:
        require(mode == "revoke" and response.status_code == 403,
                "Calendar native observation returned an unexpected HTTP result.")
        outcome, counts = "denied", None
    require(mode != "keep" or (response.status_code == 200 and counts == (2, 0, 1)),
            "Calendar unchanged-membership control failed.")
    # Emit the actual baseline before the contract expectation: a genuine RED
    # must be measured HTTP200/empty, not a fixture or missing-recheck assertion.
    cardinality = (" bookings=" + str(counts[0]) + " holds=" + str(counts[1]) + " blocks=" + str(counts[2])
                   if counts is not None else " collections=unreturned")
    with capsys.disabled():
        print("FILL_CALENDAR_POSTROLE_MEMBERSHIP_PG_OBSERVED case=" + mode + " outcome=" + outcome
              + " status=" + str(response.status_code) + cardinality
              + " role_attempts=" + str(state["role_attempts"])
              + " role_denials=" + str(state["role_denials"])
              + " isolation=read_committed read_only=off trace=complete lifecycle=exited")
    if mode == "revoke":
        require(response.status_code == 403,
                "Calendar revoked membership must return HTTP403 instead of a successful Calendar DTO.")
        try:
            denied_body = response.json()
        except Exception:
            pytest.fail("Calendar denial response was not supported JSON.", pytrace=False)
        require(type(denied_body) is dict
                and not any(key in denied_body for key in ("bookings", "holds", "blocks")),
                "Calendar denial must not return a Calendar collections DTO.")
        require(state["role_attempts"] == 2 and state["role_denials"] == 1
                and state["denial_code"] == "FORBIDDEN" and state["denial_status"] == 403
                and state["user_exit"] == "denial_unwound",
                "Calendar denial did not originate from the final native membership check.")
    else:
        require(state["role_denials"] == 0 and state["user_exit"] == "normal",
                "Calendar unchanged-membership control did not exit normally.")
        require(state["role_attempts"] == 2 and state["role_successes"] == 2,
                "Calendar positive control did not exercise the final native role recheck.")
    # This final-check contract is not statement-atomic or a late-wire guarantee;
    # zero holds still does not qualify active-hold removal or hosted F1.
    with capsys.disabled():
        print("FILL_CALENDAR_FINAL_MEMBERSHIP_PG_CONTRACT_PASS case=" + mode
              + " status=" + str(response.status_code) + cardinality
              + " role_attempts=" + str(state["role_attempts"])
              + " role_denials=" + str(state["role_denials"])
              + " user_exit=" + state["user_exit"]
              + " isolation=read_committed read_only=off trace=complete lifecycle=exited")


@pytest.mark.parametrize("status", ["confirmed", "pending_payment"])
@pytest.mark.parametrize("population", ["sole_foreign", "mixed", "same", "empty", "cancelled_foreign", "other_org_foreign", "before_day_foreign", "at_finish_foreign"])
def test_fill_today_native_pg_revenue_denomination(fill_today, capsys, status, population):
    """Exercise the existing disposable migrated-PG fixture, never booking routes.

    The inherited SQL principal/Auth stub is local fixture setup, not supported
    Supabase provisioning or full API admission evidence. All rows are fictional.
    """
    from fmc.fill_today_read import read_today

    _, store, user_id, org_id, court_id = fill_today
    day = datetime(2026, 10, 5, tzinfo=ZoneInfo("Europe/Lisbon"))
    finish = day + timedelta(days=1)
    extra_org, extra_venue, extra_court = (uuid.uuid4() for _ in range(3))
    try:
        with store.trusted() as c:
            if c.dialect.name != "postgresql":
                pytest.fail("DENOMINATION_REQUIRES_NATIVE_PG", pytrace=False)
            c.execute(text("DELETE FROM public.bookings WHERE organization_id=:org"), {"org": org_id})
            if population == "other_org_foreign":
                c.execute(text("INSERT INTO public.organizations (id,slug,name,timezone,default_currency) VALUES (:org,:slug,'Fictional currency control','Europe/Lisbon','USD')"), {"org": extra_org, "slug": str(extra_org)})
                c.execute(text("INSERT INTO public.venues (id,organization_id,name,timezone,currency,address) VALUES (:venue,:org,'Fictional control venue','Europe/Lisbon','USD','{}')"), {"venue": extra_venue, "org": extra_org})
                c.execute(text("INSERT INTO public.courts (id,venue_id,name,sport,indoor,inventory_mode,native_write_enabled) VALUES (:court,:venue,'Fictional control court','padel',false,'native',true)"), {"court": extra_court, "venue": extra_venue})
            rows = []
            if population not in ("sole_foreign", "empty"):
                rows.append((org_id, court_id, day + timedelta(hours=10), "EUR", 1500, status))
            if population not in ("same", "empty"):
                starts_at = day + timedelta(hours=13)
                row_org, row_court, row_status = org_id, court_id, status
                if population == "before_day_foreign":
                    starts_at = day - timedelta(hours=1)
                elif population == "at_finish_foreign":
                    starts_at = finish
                elif population == "cancelled_foreign":
                    row_status = "cancelled"
                elif population == "other_org_foreign":
                    row_org, row_court = extra_org, extra_court
                rows.append((row_org, row_court, starts_at, "USD", 4200, row_status))
            for index, (row_org, row_court, starts_at, currency, amount, row_status) in enumerate(rows):
                c.execute(text("""INSERT INTO public.bookings
                    (organization_id,venue_id,court_id,status,starts_at,ends_at,currency,gross_amount_minor,source,idempotency_key)
                    SELECT :org,venue_id,id,:status,:starts,:ends,:currency,:amount,'getacourt',:key
                    FROM public.courts WHERE id=:court"""),
                    {"org": row_org, "court": row_court, "status": row_status,
                     "starts": starts_at, "ends": starts_at + timedelta(minutes=30),
                     "currency": currency, "amount": amount,
                     "key": "denomination-" + str(uuid.uuid4()) + "-" + str(index)})
        must_deny = population in ("sole_foreign", "mixed")
        try:
            result = read_today(store, Actor(id=user_id), org_id, "2026-10-05", day)
        except DomainError as error:
            if not must_deny or error.status != 503:
                pytest.fail("DENOMINATION_UNEXPECTED_FAILURE", pytrace=False)
            with capsys.disabled():
                print("FILL_REVENUE_DENOMINATION_GREEN case=" + population + " status=" + status + " unavailable=1 native_pg=1")
        else:
            if must_deny:
                wrong_pair = result["currency"] == "EUR" and result["summary"]["revenue_minor"] == (4200 if population == "sole_foreign" else 5700)
                with capsys.disabled():
                    print("FILL_REVENUE_DENOMINATION_RED case=" + population + " status=" + status + " original_success=1 wrong_unit=" + str(int(wrong_pair)) + " native_pg=1")
                pytest.fail("DENOMINATION_EXPECTED_UNAVAILABLE", pytrace=False)
            expected = 0 if population == "empty" else 1500
            if result["currency"] != "EUR" or result["summary"]["revenue_minor"] != expected:
                pytest.fail("DENOMINATION_CONTROL_CHANGED", pytrace=False)
            with capsys.disabled():
                print("FILL_REVENUE_DENOMINATION_CONTROL_PASS case=" + population + " status=" + status + " native_pg=1")
    finally:
        with store.trusted() as c:
            c.execute(text("DELETE FROM public.organizations WHERE id=:org"), {"org": extra_org})



@pytest.mark.parametrize("case", [
    "sole_foreign", "mixed_foreign_max", "mixed_foreign_not_max",
    "foreign_beyond_window_limit", "foreign_zero", "uniform_eur", "uniform_usd",
    "zero_eur", "no_opportunities", "inactive_foreign_rate", "unselected_foreign_rate",
    "outside_weekday_foreign_rate", "other_tenant_foreign_rate", "inactive_foreign_court"])
def test_fill_today_native_pg_recovery_quote_denomination(fill_today, capsys, case):
    """Real read-only ASGI GET over disposable migrated PG, with fictional rows.

    Inherited fixture SQL principal/Auth stub does not claim supported Supabase
    provisioning or full booking/provider admission. No writer route is invoked.
    """
    url, store, user_id, org_id, court_id = fill_today
    extra_org, extra_venue, extra_court = (uuid.uuid4() for _ in range(3))
    client = None
    hidden_court = None
    deny = case in {"sole_foreign", "mixed_foreign_max", "mixed_foreign_not_max",
                    "foreign_beyond_window_limit", "foreign_zero"}
    report_currency = "USD" if case == "uniform_usd" else "EUR"
    try:
        with store.trusted() as c:
            if c.dialect.name != "postgresql":
                pytest.fail("RECOVERY_DENOMINATION_REQUIRES_NATIVE_PG", pytrace=False)
            c.execute(text("DELETE FROM public.bookings WHERE organization_id=:org"), {"org": org_id})
            c.execute(text("DELETE FROM public.court_blocks WHERE organization_id=:org"), {"org": org_id})
            c.execute(text("DELETE FROM public.court_rates WHERE organization_id=:org"), {"org": org_id})
            venue_id = c.execute(text("SELECT venue_id FROM public.courts WHERE id=:court"), {"court": court_id}).scalar_one()

            def add_court(active=True, tenant=org_id, venue=venue_id, identity=None):
                identity = identity or uuid.uuid4()
                c.execute(text("""INSERT INTO public.courts
                    (id,venue_id,name,sport,indoor,inventory_mode,native_write_enabled,active)
                    VALUES (:court,:venue,'Fictional quote court','padel',false,'native',true,:active)"""),
                    {"court": identity, "venue": venue, "active": active})
                return identity

            def add_rate(court, currency, price, start=600, end=840, priority=100, active=True, weekday=0, tenant=org_id):
                c.execute(text("""INSERT INTO public.court_rates
                    (organization_id,court_id,weekday,start_minute,end_minute,price_minor,currency,priority,active)
                    VALUES (:org,:court,:weekday,:start,:end,:price,:currency,:priority,:active)"""),
                    {"org": tenant, "court": court, "weekday": weekday, "start": start,
                     "end": end, "price": price, "currency": currency, "priority": priority, "active": active})

            if case == "uniform_usd":
                c.execute(text("UPDATE public.organizations SET default_currency='USD' WHERE id=:org"), {"org": org_id})
                c.execute(text("UPDATE public.venues SET currency='USD' WHERE id=:venue"), {"venue": venue_id})
            if case in {"sole_foreign", "foreign_zero"}:
                add_rate(court_id, "USD", 0 if case == "foreign_zero" else 1000)
            elif case == "mixed_foreign_max":
                add_rate(court_id, "EUR", 1000, end=720)
                add_rate(court_id, "USD", 2000, start=720)
            elif case == "mixed_foreign_not_max":
                add_rate(court_id, "USD", 100, end=660)
                add_rate(court_id, "EUR", 2000, start=660)
            elif case != "no_opportunities":
                add_rate(court_id, report_currency, 0 if case == "zero_eur" else 1000)
            if case == "foreign_beyond_window_limit":
                for _ in range(29):
                    add_rate(add_court(), "EUR", 1000)
                hidden_court = add_court()
                add_rate(hidden_court, "USD", 100, end=660)
            elif case == "inactive_foreign_rate":
                add_rate(court_id, "USD", 100, priority=0, active=False)
            elif case == "unselected_foreign_rate":
                add_rate(court_id, "USD", 100, priority=200)
            elif case == "outside_weekday_foreign_rate":
                add_rate(court_id, "USD", 100, weekday=1)
            elif case == "inactive_foreign_court":
                add_rate(add_court(active=False), "USD", 100)
            elif case == "other_tenant_foreign_rate":
                c.execute(text("INSERT INTO public.organizations (id,slug,name,timezone,default_currency) VALUES (:org,:slug,'Fictional quote control','Europe/Lisbon','USD')"), {"org": extra_org, "slug": str(extra_org)})
                c.execute(text("INSERT INTO public.venues (id,organization_id,name,timezone,currency,address) VALUES (:venue,:org,'Fictional control venue','Europe/Lisbon','USD','{}')"), {"org": extra_org, "venue": extra_venue})
                add_court(tenant=extra_org, venue=extra_venue, identity=extra_court)
                add_rate(extra_court, "USD", 100, tenant=extra_org)
        settings = Settings(
            origin="https://fill.test",
            environment="test",
            database=url,
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="sb_publishable_ci",
            data_contract="supabase-v1",
        )
        client = TestClient(create_v1_app(settings, "operations", auth_override=StaticAuth(user_id)))
        r = client.get(
            f"/api/fmc/{org_id}/today",
            params={"date": "2026-10-05"},
            headers={"Authorization": "Bearer ci-owner-token"},
        )
        if deny:
            if r.status_code == 200:
                body = r.json()
                windows = body["empty_windows"]
                no_revenue = body["summary"]["bookings"] == 0 and body["summary"]["revenue_minor"] == 0
                if case in {"sole_foreign", "foreign_zero"}:
                    witness = any(w["currency"] == "USD" for w in windows) and body["currency"] == "EUR"
                elif case == "mixed_foreign_max":
                    witness = body["summary"]["highest_single_quote_minor"] == 3000 and any(w["currency"] == "USD" for w in windows)
                elif case == "mixed_foreign_not_max":
                    witness = (body["summary"]["highest_single_quote_minor"] == 3000
                               and any(w["currency"] == "EUR" and w["min_60_amount_minor"] == 100
                                       and w["max_60_amount_minor"] == 2000 for w in windows))
                else:
                    witness = (len(windows) == 30 and all(w["currency"] == "EUR" for w in windows)
                               and any(str(v["court_id"]) == str(hidden_court) and v["empty_minutes"] == 60
                                       and v["has_rate_coverage"] for v in body["courts"]))
                if not witness or not no_revenue:
                    pytest.fail("RECOVERY_DENOMINATION_RED_PRECONDITION_MISSING", pytrace=False)
                with capsys.disabled():
                    print("FILL_RECOVERY_QUOTE_RED case=" + case + " actual_status=200 no_revenue=1 selected_foreign=1"
                          + " foreign_not_numeric_max=" + str(int(case == "mixed_foreign_not_max"))
                          + " before_display_limit=" + str(int(case == "foreign_beyond_window_limit")) + " native_pg=1")
                pytest.fail("RECOVERY_DENOMINATION_EXPECTED_SANITIZED_503", pytrace=False)
            if r.status_code != 503 or any(k in r.json() for k in ("summary", "empty_windows")) or "USD" in r.text:
                pytest.fail("RECOVERY_DENOMINATION_UNSAFE_FAILURE", pytrace=False)
            with capsys.disabled():
                print("FILL_RECOVERY_QUOTE_GREEN case=" + case + " actual_status=503 sanitized=1 native_pg=1")
        else:
            if r.status_code != 200:
                pytest.fail("RECOVERY_DENOMINATION_CONTROL_UNAVAILABLE", pytrace=False)
            body = r.json()
            expected = None if case == "no_opportunities" else 0 if case == "zero_eur" else 1500
            if (set(body) != {"date", "day_start", "day_end", "timezone", "currency", "summary", "courts", "empty_windows"}
                    or body["currency"] != report_currency or body["summary"]["bookings"] != 0
                    or body["summary"]["revenue_minor"] != 0 or body["summary"]["highest_single_quote_minor"] != expected):
                pytest.fail("RECOVERY_DENOMINATION_CONTROL_DTO_CHANGED", pytrace=False)
            if case == "no_opportunities":
                if body["empty_windows"]:
                    pytest.fail("RECOVERY_DENOMINATION_EMPTY_CONTROL_CHANGED", pytrace=False)
            else:
                quote = body["empty_windows"][0]
                base_amount = 0 if case == "zero_eur" else 1000
                if (quote["currency"] != report_currency or quote["min_60_amount_minor"] != base_amount
                        or quote["max_60_amount_minor"] != base_amount
                        or quote["min_90_amount_minor"] != expected or quote["max_90_amount_minor"] != expected
                        or quote["best_amount_minor"] != expected or quote["best_duration_minutes"] != 90):
                    pytest.fail("RECOVERY_DENOMINATION_CONTROL_AMOUNT_CHANGED", pytrace=False)
            with capsys.disabled():
                print("FILL_RECOVERY_QUOTE_CONTROL_PASS case=" + case + " actual_status=200 native_pg=1")
    finally:
        if client is not None:
            client.close()
        with store.trusted() as c:
            c.execute(text("DELETE FROM public.organizations WHERE id=:org"), {"org": extra_org})
