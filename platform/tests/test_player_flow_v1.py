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
    def __init__(self, user_id: str, email: str):
        self.actor = Actor(id=user_id, email=email)

    def verify(self, authorization: str | None):
        if authorization != "Bearer ci-player-token":
            raise DomainError("AUTH_REQUIRED", "Sign in is required.", 401)
        return self.actor


@pytest.fixture()
def player_flow():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not configured")

    store = V1Store(url)
    user_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())
    venue_id = str(uuid.uuid4())
    court_id = str(uuid.uuid4())
    slug = "player-flow-" + org_id[:8]

    with store.trusted() as c:
        c.execute(text("insert into auth.users(id) values(cast(:uid as uuid))"), {"uid": user_id})
        c.execute(text("""
            insert into public.organizations(id,slug,name,timezone,default_currency)
            values(cast(:org as uuid),:slug,'Player Flow CI','Europe/Lisbon','EUR')
        """), {"org": org_id, "slug": slug})
        c.execute(text("""
            insert into public.venues(id,organization_id,name,timezone,currency,address)
            values(cast(:venue as uuid),cast(:org as uuid),'Cascais CI Venue',
                   'Europe/Lisbon','EUR','{"city":"Cascais","country":"Portugal"}'::jsonb)
        """), {"venue": venue_id, "org": org_id})
        c.execute(text("""
            insert into public.courts(id,venue_id,name,sport,indoor,inventory_mode,native_write_enabled)
            values(cast(:court as uuid),cast(:venue as uuid),'Padel CI','padel',true,'native',true)
        """), {"court": court_id, "venue": venue_id})
        c.execute(text("""
            insert into public.court_rates(organization_id,court_id,weekday,start_minute,end_minute,
                                           price_minor,currency,priority)
            values(cast(:org as uuid),cast(:court as uuid),null,360,1410,2400,'EUR',100)
        """), {"org": org_id, "court": court_id})

    yield {
        "url": url,
        "store": store,
        "user_id": user_id,
        "org_id": org_id,
        "venue_id": venue_id,
        "court_id": court_id,
        "auth": StaticAuth(user_id, "player@example.test"),
    }

    with store.trusted() as c:
        c.execute(text("delete from public.organizations where id=cast(:org as uuid)"), {"org": org_id})
        c.execute(text("delete from public.player_profiles where user_id=cast(:uid as uuid)"), {"uid": user_id})
        c.execute(text("delete from auth.users where id=cast(:uid as uuid)"), {"uid": user_id})


def settings(url: str, booking_enabled: bool):
    return Settings(
        origin="https://getacourt.test",
        environment="test",
        database=url,
        booking_enabled=booking_enabled,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )


def headers():
    return {"Authorization": "Bearer ci-player-token"}


def test_authenticated_player_profile_search_and_disabled_hold(player_flow):
    f = player_flow
    client = TestClient(create_v1_app(settings(f["url"], False), "core", auth_override=f["auth"]))

    assert client.get("/api/player-profile").status_code == 401

    me = client.get("/api/me", headers=headers())
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "player@example.test"

    empty = client.get("/api/player-profile", headers=headers())
    assert empty.status_code == 200
    assert empty.json()["profile"] is None

    saved = client.put("/api/player-profile", headers=headers(), json={
        "full_name": "CI Player",
        "home_area": "Cascais",
        "preferred_sports": ["padel", "tennis"],
        "locale": "en",
        "marketing_consent": True,
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["profile"]["full_name"] == "CI Player"
    assert saved.json()["profile"]["preferred_sports"] == ["padel", "tennis"]

    search = client.get("/api/availability", params={
        "sport": "padel",
        "location": "Cascais",
        "date": "2026-10-05",
        "time": "17:00",
        "end_time": "20:00",
        "duration": 90,
        "indoor": "all",
    })
    assert search.status_code == 200, search.text
    slots = search.json()["slots"]
    assert slots
    slot = next(s for s in slots if s["id"] == f["court_id"])

    blocked = client.post("/api/holds", headers={
        **headers(),
        "Idempotency-Key": "ci-disabled-hold-0001",
    }, json={
        "court_id": f["court_id"],
        "starts_at": slot["starts_at"],
        "duration": 90,
    })
    assert blocked.status_code == 503
    assert blocked.json()["error"] == "BOOKING_UNAVAILABLE"

    with f["store"].trusted() as c:
        assert c.execute(text("""
            select count(*) from public.booking_holds
            where organization_id=cast(:org as uuid)
        """), {"org": f["org_id"]}).scalar() == 0
        assert c.execute(text("""
            select count(*) from public.people
            where organization_id=cast(:org as uuid) and auth_user_id=cast(:uid as uuid)
        """), {"org": f["org_id"], "uid": f["user_id"]}).scalar() == 0


def test_enabled_hold_links_global_profile_into_club_person(player_flow):
    f = player_flow

    profile_client = TestClient(create_v1_app(settings(f["url"], False), "core", auth_override=f["auth"]))
    saved = profile_client.put("/api/player-profile", headers=headers(), json={
        "full_name": "CI Player",
        "home_area": "Cascais",
        "preferred_sports": ["padel"],
        "locale": "en",
        "marketing_consent": True,
    })
    assert saved.status_code == 200

    client = TestClient(create_v1_app(settings(f["url"], True), "core", auth_override=f["auth"]))
    search = client.get("/api/availability", params={
        "sport": "padel",
        "location": "Cascais",
        "date": "2026-10-05",
        "time": "17:00",
        "end_time": "20:00",
        "duration": 90,
        "indoor": "all",
    })
    slot = next(s for s in search.json()["slots"] if s["id"] == f["court_id"])

    held = client.post("/api/holds", headers={
        **headers(),
        "Idempotency-Key": "ci-enabled-hold-0001",
    }, json={
        "court_id": f["court_id"],
        "starts_at": slot["starts_at"],
        "duration": 90,
    })
    assert held.status_code == 201, held.text

    with f["store"].trusted() as c:
        person = c.execute(text("""
            select full_name,email,marketing_consent,source
            from public.people
            where organization_id=cast(:org as uuid) and auth_user_id=cast(:uid as uuid)
        """), {"org": f["org_id"], "uid": f["user_id"]}).mappings().one()
        assert person["full_name"] == "CI Player"
        assert person["email"] == "player@example.test"
        assert person["marketing_consent"] is True
        assert person["source"] == "getacourt"
