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
