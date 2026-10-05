import os
import uuid

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
