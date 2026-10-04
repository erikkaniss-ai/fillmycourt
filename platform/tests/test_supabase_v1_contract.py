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
        c.execute(text("insert into auth.users(id) values(:id::uuid),(:other::uuid)"), {"id": owner, "other": outsider})
        c.execute(text("insert into public.organizations(id,slug,name) values(:org::uuid,:slug,'CI Club')"),
                  {"org": org, "slug": "ci-"+org[:8]})
        c.execute(text("insert into public.organization_members(organization_id,user_id,role) values(:org::uuid,:uid::uuid,'owner')"),
                  {"org": org, "uid": owner})
        c.execute(text("insert into public.venues(id,organization_id,name) values(:venue::uuid,:org::uuid,'CI Venue')"),
                  {"venue": venue, "org": org})
        c.execute(text("""insert into public.courts(id,venue_id,name,sport,indoor,inventory_mode,native_write_enabled)
                         values(:court::uuid,:venue::uuid,'Court 1','padel',true,'native',true)"""),
                  {"court": court, "venue": venue})
        c.execute(text("""insert into public.court_rates(organization_id,court_id,price_minor,currency)
                         values(:org::uuid,:court::uuid,2000,'EUR')"""),
                  {"org": org, "court": court})
    return owner, outsider, org, venue, court


def test_rls_membership_and_rate_quote(store):
    owner, outsider, org, venue, court = seed(store)
    with store.user(owner) as c:
        got = c.execute(text("select id::text from public.organizations where id=:org::uuid"), {"org": org}).scalar()
        assert got == org
    with store.user(outsider) as c:
        got = c.execute(text("select id::text from public.organizations where id=:org::uuid"), {"org": org}).scalar()
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
                         values(:org::uuid,:court::uuid,:a,:b,now()+interval '10 minutes','ci-hold-123')"""),
                  {"org": org, "court": court, "a": start, "b": end})
        assert store.active_conflict(c, court, start, end) is True


def test_provider_write_mode_constraint(store):
    owner, outsider, org, venue, court = seed(store)
    with store.trusted() as c:
        c.execute(text("""insert into public.provider_connections(organization_id,provider,status,capabilities)
                         values(:org::uuid,'playtomic','configured','{"write_mode":"read_sync"}'::jsonb)"""),
                  {"org": org})
        with pytest.raises(Exception):
            c.execute(text("""insert into public.provider_connections(organization_id,provider,status,capabilities)
                             values(:org::uuid,'bad-provider','configured','{"write_mode":"invented"}'::jsonb)"""),
                      {"org": org})
