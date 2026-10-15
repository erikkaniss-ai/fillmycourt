from datetime import datetime, timedelta, timezone
import os
import uuid

import pytest
from sqlalchemy import text

from fmc.supabase_v1 import V1Store


@pytest.fixture()
def store():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not configured")
    return V1Store(url)


def seed(store):
    owner = str(uuid.uuid4())
    outsider = str(uuid.uuid4())
    org = str(uuid.uuid4())
    venue = str(uuid.uuid4())
    court = str(uuid.uuid4())
    with store.trusted() as c:
        c.execute(text("insert into auth.users(id) values(cast(:id as uuid)),(cast(:other as uuid))"), {"id": owner, "other": outsider})
        c.execute(text("insert into public.organizations(id,slug,name) values(cast(:org as uuid),:slug,'CI Club')"),
                  {"org": org, "slug": "ci-"+org[:8]})
        c.execute(text("insert into public.organization_members(organization_id,user_id,role) values(cast(:org as uuid),cast(:uid as uuid),'owner')"),
                  {"org": org, "uid": owner})
        c.execute(text("insert into public.venues(id,organization_id,name) values(cast(:venue as uuid),cast(:org as uuid),'CI Venue')"),
                  {"venue": venue, "org": org})
        c.execute(text("""insert into public.courts(id,venue_id,name,sport,indoor,inventory_mode,native_write_enabled)
                         values(cast(:court as uuid),cast(:venue as uuid),'Court 1','padel',true,'native',true)"""),
                  {"court": court, "venue": venue})
        c.execute(text("""insert into public.court_rates(organization_id,court_id,price_minor,currency)
                         values(cast(:org as uuid),cast(:court as uuid),2000,'EUR')"""),
                  {"org": org, "court": court})
    return owner, outsider, org, venue, court


def test_rls_membership_and_rate_quote(store):
    owner, outsider, org, venue, court = seed(store)
    with store.user(owner) as c:
        got = c.execute(text("select id::text from public.organizations where id=cast(:org as uuid)"), {"org": org}).scalar()
        assert got == org
    with store.user(outsider) as c:
        got = c.execute(text("select id::text from public.organizations where id=cast(:org as uuid)"), {"org": org}).scalar()
        assert got is None

    start = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    with store.trusted() as c:
        court_data, quote = store.quote(c, court, start, 90)
        assert court_data["organization_id"] == org
        assert quote["amount_minor"] == 3000
        assert quote["currency"] == "EUR"


def test_hold_conflict_uses_single_booking_authority(store):
    owner, outsider, org, venue, court = seed(store)
    start = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(hours=1)
    end = start + timedelta(minutes=90)
    with store.trusted() as c:
        c.execute(text("""insert into public.booking_holds
                         (organization_id,court_id,starts_at,ends_at,expires_at,idempotency_key)
                         values(cast(:org as uuid),cast(:court as uuid),:a,:b,now()+interval '10 minutes','ci-hold-123')"""),
                  {"org": org, "court": court, "a": start, "b": end})
        assert store.active_conflict(c, court, start, end) is True


def test_provider_write_mode_constraint(store):
    owner, outsider, org, venue, court = seed(store)
    with store.trusted() as c:
        c.execute(text("""insert into public.provider_connections(organization_id,provider,status,capabilities)
                         values(cast(:org as uuid),'playtomic','configured','{"write_mode":"read_sync"}'::jsonb)"""),
                  {"org": org})
        with pytest.raises(Exception):
            c.execute(text("""insert into public.provider_connections(organization_id,provider,status,capabilities)
                             values(cast(:org as uuid),'bad-provider','configured','{"write_mode":"invented"}'::jsonb)"""),
                      {"org": org})


def test_player_profile_rls_is_owned_by_auth_user(store):
    owner, outsider, org, venue, court = seed(store)
    with store.user(owner) as c:
        c.execute(text("""
            insert into public.player_profiles(user_id,full_name,home_area,preferred_sports,locale)
            values(cast(:uid as uuid),'Player One','Cascais',array['padel','tennis'],'en')
        """), {"uid": owner})
        got = c.execute(text("""
            select full_name from public.player_profiles where user_id=cast(:uid as uuid)
        """), {"uid": owner}).scalar()
        assert got == "Player One"

    with store.user(outsider) as c:
        assert c.execute(text("select count(*) from public.player_profiles")).scalar() == 0
        result = c.execute(text("""
            update public.player_profiles
            set full_name='Hijacked'
            where user_id=cast(:uid as uuid)
        """), {"uid": owner})
        assert result.rowcount == 0

    with store.user(owner) as c:
        got = c.execute(text("""
            select full_name from public.player_profiles where user_id=cast(:uid as uuid)
        """), {"uid": owner}).scalar()
        assert got == "Player One"


def test_player_profile_rejects_unsupported_sport(store):
    owner, outsider, org, venue, court = seed(store)
    with store.user(owner) as c:
        with pytest.raises(Exception):
            c.execute(text("""
                insert into public.player_profiles(user_id,full_name,preferred_sports)
                values(cast(:uid as uuid),'Player One',array['football'])
            """), {"uid": owner})


def test_set_based_availability_returns_priced_slots(store):
    owner, outsider, org, venue, court = seed(store)
    day = datetime.now(timezone.utc).date().isoformat()
    slots = store.availability(day, "17:00", "20:00", "padel", 90, "", "all", 50)
    assert slots
    assert any(s["id"] == court for s in slots)
    match = next(s for s in slots if s["id"] == court)
    assert match["amount_minor"] == 3000
    assert match["duration_minutes"] == 90


def test_radius_availability_filters_geocoded_venues(store):
    owner, outsider, org, venue, court = seed(store)
    with store.trusted() as c:
        c.execute(text("""
            update public.venues
            set address=cast(:address as jsonb)
            where id=cast(:venue as uuid)
        """), {"venue": venue, "address": '{"city":"Cascais","lat":38.6979,"lon":-9.4215}'})
    day = datetime.now(timezone.utc).date().isoformat()
    nearby = store.availability(day, "17:00", "20:00", "padel", 90, "", "all", 50,
                                lat=38.6979, lon=-9.4215, radius_km=5)
    assert any(s["id"] == court for s in nearby)
    slot = next(s for s in nearby if s["id"] == court)
    assert slot["distance_km"] is not None
    assert float(slot["distance_km"]) < 0.1

    far = store.availability(day, "17:00", "20:00", "padel", 90, "", "all", 50,
                             lat=38.7223, lon=-9.1393, radius_km=5)
    assert not any(s["id"] == court for s in far)
