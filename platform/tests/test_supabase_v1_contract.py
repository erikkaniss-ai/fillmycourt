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


@pytest.fixture
def transaction_claims_pg():
    """Only the existing disposable GitHub CI PG16 service; never hosted Auth."""
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    if os.environ.get("GITHUB_ACTIONS") != "true":
        pytest.skip("Transaction claims PostgreSQL proof runs only in disposable CI")
    raw = os.environ.get("TEST_DATABASE_URL", "")
    url = make_url(raw)
    assert url.drivername == "postgresql+psycopg"
    assert url.host in {"localhost", "127.0.0.1"} and url.port == 5432
    assert url.database == "fmc_test" and url.username == "postgres"
    db = V1Store.__new__(V1Store)
    db.engine = create_engine(url, pool_size=1, max_overflow=0, pool_timeout=2,
        pool_pre_ping=True, connect_args={"options": "-c statement_timeout=5000 -c lock_timeout=1000"})
    users, orgs = [str(uuid.uuid4()) for _ in range(2)], [str(uuid.uuid4()) for _ in range(2)]
    try:
        with db.trusted() as c:
            assert 160000 <= int(c.execute(text("show server_version_num")).scalar_one()) < 170000
            assert c.execute(text("select current_database()")).scalar_one() == "fmc_test"
            # These IDs exist ONLY inside this disposable DB's synthetic Auth
            # contract table. They are not hosted Supabase Auth identities.
            c.execute(text("insert into auth.users(id) values(cast(:a as uuid)),(cast(:b as uuid))"),
                      {"a": users[0], "b": users[1]})
            for user, org in zip(users, orgs):
                c.execute(text("insert into public.organizations(id,slug,name) values(cast(:org as uuid),:slug,'CI Claims Club')"),
                          {"org": org, "slug": "ci-claims-" + org})
                c.execute(text("insert into public.organization_members(organization_id,user_id,role) values(cast(:org as uuid),cast(:uid as uuid),'owner')"),
                          {"org": org, "uid": user})
                c.execute(text("insert into public.player_profiles(user_id,full_name,preferred_sports) values(cast(:uid as uuid),'CI Claims Original',array['padel'])"),
                          {"uid": user})
        yield db, users, orgs
    finally:
        db.engine.dispose()


def claims_state(c):
    return dict(c.execute(text("""
        select pg_backend_pid() as pid,current_user as db_role,session_user as session_role,
               nullif(current_setting('request.jwt.claim.sub',true),'')::uuid::text as uid,
               current_setting('request.jwt.claim.role',true) as claim_role,
               current_setting('request.jwt.claim.sub',true) as claim_sub,
               current_setting('transaction_read_only') as readonly,
               current_setting('transaction_isolation') as isolation
    """)).mappings().one())


def assert_user_claims(c, uid, org, readonly):
    state = claims_state(c)
    assert (state["db_role"], state["uid"], state["claim_role"], state["claim_sub"]) == (
        "authenticated", uid, "authenticated", uid)
    assert state["readonly"] == ("on" if readonly else "off")
    assert state["isolation"] == ("repeatable read" if readonly else "read committed")
    assert c.execute(text("select id::text from public.organizations")).scalars().all() == [org]
    assert c.execute(text("select user_id::text from public.player_profiles")).scalars().all() == [uid]
    return state["pid"]


def assert_claims_reset(c, pid):
    state = claims_state(c)
    assert state["pid"] == pid, "Must reuse the same physical PostgreSQL connection"
    assert state["db_role"] == state["session_role"] == "postgres"
    assert state["uid"] is None
    assert state["claim_role"] in (None, "") and state["claim_sub"] in (None, "")
    assert (state["readonly"], state["isolation"]) == ("off", "read committed")


def test_transaction_claims_pg16_two_tenants_pool_reuse_commit_and_rollback(transaction_claims_pg):
    db, users, orgs = transaction_claims_pg
    with db.user(users[0]) as c:
        pid = assert_user_claims(c, users[0], orgs[0], False)
        changed = c.execute(text("update public.player_profiles set full_name='CI Claims Committed' where user_id=cast(:uid as uuid)"),
                            {"uid": users[0]})
        assert changed.rowcount == 1
        denied = c.execute(text("update public.player_profiles set full_name='CI Claims Cross Tenant' where user_id=cast(:uid as uuid)"),
                           {"uid": users[1]})
        assert denied.rowcount == 0
    with db.trusted() as c:
        assert_claims_reset(c, pid)
        assert c.execute(text("select full_name from public.player_profiles where user_id=cast(:uid as uuid)"),
                         {"uid": users[0]}).scalar_one() == "CI Claims Committed"
    with db.user(users[1], readonly=True) as c:
        assert assert_user_claims(c, users[1], orgs[1], True) == pid

    failure = RuntimeError("synthetic rollback sentinel")
    with pytest.raises(RuntimeError) as caught:
        with db.user(users[0]) as c:
            assert assert_user_claims(c, users[0], orgs[0], False) == pid
            c.execute(text("update public.player_profiles set full_name='CI Claims Must Roll Back' where user_id=cast(:uid as uuid)"),
                      {"uid": users[0]})
            raise failure
    assert caught.value is failure
    with db.trusted() as c:
        assert_claims_reset(c, pid)
        assert c.execute(text("select full_name from public.player_profiles where user_id=cast(:uid as uuid)"),
                         {"uid": users[0]}).scalar_one() == "CI Claims Committed"
    with db.user(users[1]) as c:
        assert assert_user_claims(c, users[1], orgs[1], False) == pid


def test_transaction_claims_pg16_readonly_failure_resets_reused_connection(transaction_claims_pg):
    from sqlalchemy.exc import DBAPIError

    db, users, orgs = transaction_claims_pg
    with db.trusted() as c:
        pid = claims_state(c)["pid"]
    with pytest.raises(DBAPIError) as caught:
        with db.user(users[0], readonly=True) as c:
            assert assert_user_claims(c, users[0], orgs[0], True) == pid
            c.execute(text("update public.player_profiles set full_name='CI Claims Forbidden Write' where user_id=cast(:uid as uuid)"),
                      {"uid": users[0]})
    assert caught.value.orig.sqlstate == "25006"
    with db.trusted() as c:
        assert_claims_reset(c, pid)
        assert c.execute(text("select full_name from public.player_profiles where user_id=cast(:uid as uuid)"),
                         {"uid": users[0]}).scalar_one() == "CI Claims Original"
    with db.user(users[1]) as c:
        assert assert_user_claims(c, users[1], orgs[1], False) == pid
