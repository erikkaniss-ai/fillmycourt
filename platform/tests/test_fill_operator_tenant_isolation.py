"""Operations API authorization regression: support may read its own club only.

All users and organizations are CI-only PostgreSQL fixtures. No real Supabase
sessions, hosted club data, provider writes, bookings or external requests.
This DOES NOT substitute for a real authenticated staging tenant UAT.
"""
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from fmc.common import DomainError
from fmc.config import Settings
from fmc.supabase_v1 import Actor, V1Store
from fmc.v1_app import create_v1_app


class StaticActor:
    def __init__(self, uid):
        self.user = Actor(id=uid, email="fixture-operator@example.invalid")

    def verify(self, authorization):
        if authorization != "Bearer ci-fixture-token":
            raise DomainError("AUTH_REQUIRED", "Sign in is required.", 401)
        return self.user


@pytest.fixture()
def two_support_clubs():
    database = os.environ.get("TEST_DATABASE_URL")
    if not database:
        pytest.skip("TEST_DATABASE_URL not configured")
    store = V1Store(database)
    members = [str(uuid.uuid4()), str(uuid.uuid4())]
    orgs = [str(uuid.uuid4()), str(uuid.uuid4())]
    with store.trusted() as c:
        for member in members:
            c.execute(text("insert into auth.users(id) values(cast(:uid as uuid))"),
                      {"uid": member})
        for idx, org in enumerate(orgs):
            c.execute(text("""
                insert into public.organizations(id,slug,name,timezone,default_currency)
                values(cast(:org as uuid),:slug,:name,'Europe/Lisbon','EUR')
            """), {"org": org, "slug": "support-ci-"+org[:12],
                   "name": "SYNTHETIC TENANT "+str(idx)})
            c.execute(text("""
                insert into public.organization_members(organization_id,user_id,role)
                values(cast(:org as uuid),cast(:uid as uuid),'support')
            """), {"org": org, "uid": members[idx]})
    try:
        yield database, members, orgs
    finally:
        with store.trusted() as c:
            c.execute(text("select set_config('fmc.allow_delivery_purge','on',true)"))
            c.execute(text("select set_config('fmc.allow_finance_purge','on',true)"))
            for org in orgs:
                c.execute(text("delete from public.organizations where id=cast(:org as uuid)"),
                          {"org": org})
            for member in members:
                c.execute(text("delete from auth.users where id=cast(:uid as uuid)"),
                          {"uid": member})


def test_fill_operator_support_reads_only_its_own_tenant(two_support_clubs):
    database, members, orgs = two_support_clubs
    settings = Settings(
        origin="https://fill.test", environment="test", database=database,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1",
    )
    token = {"Authorization": "Bearer ci-fixture-token"}
    date = {"date": "2026-10-19"}
    range_ = {"start": "2026-10-19T00:00:00+01:00",
              "end": "2026-10-20T00:00:00+01:00"}

    for idx, actor_id in enumerate(members):
        client = TestClient(create_v1_app(
            settings, "operations", auth_override=StaticActor(actor_id)))
        own_org, other_org = orgs[idx], orgs[1-idx]

        # Enumerating clubs cannot reveal even the other SYNTHETIC tenant.
        scoped = client.get("/api/fmc/organizations", headers=token)
        assert scoped.status_code == 200, scoped.text
        assert {o["id"] for o in scoped.json()["items"]} == {own_org}
        assert scoped.json()["items"][0]["role"] == "support"

        own_today = client.get(
            f"/api/fmc/{own_org}/today", params=date, headers=token)
        assert own_today.status_code == 200, own_today.text
        assert own_today.json()["summary"]["active_courts"] == 0

        own_calendar = client.get(
            f"/api/fmc/{own_org}/calendar", params=range_, headers=token)
        assert own_calendar.status_code == 200, own_calendar.text
        assert own_calendar.json() == {"bookings": [], "holds": [], "blocks": []}

        # A valid and well-formed session is still DENIED for a foreign tenant.
        for path, params in (
            (f"/api/fmc/{other_org}/today", date),
            (f"/api/fmc/{other_org}/calendar", range_),
            (f"/api/fmc/{uuid.uuid4()}/today", date),
        ):
            denied = client.get(path, params=params, headers=token)
            assert denied.status_code == 403, (path, denied.status_code, denied.text)
            assert denied.json().get("error") == "FORBIDDEN"

        # Without bearer, the same own-tenant URLs must fail authentication.
        for path, params in (
            (f"/api/fmc/{own_org}/today", date),
            (f"/api/fmc/{own_org}/calendar", range_),
        ):
            denied = client.get(path, params=params)
            assert denied.status_code == 401, (path, denied.status_code)
