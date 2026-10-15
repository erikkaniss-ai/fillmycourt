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
