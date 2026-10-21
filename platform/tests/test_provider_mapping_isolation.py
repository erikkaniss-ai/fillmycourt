"""Postgres16 regression: trusted provider mapping must never cross organizations.

A database mapping row can reference an arbitrary local_id UUID, so FK validity
alone does not enforce its tenant against the owning provider connection.
These fixtures use only the CI test database, never provider HTTP/credentials.
"""
import os
import uuid

import pytest
from sqlalchemy import text

from fmc.supabase_v1 import V1Store
from fmc.v1_workers import _mapping


@pytest.fixture
def store():
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires ephemeral Postgres16 CI test database")
    return V1Store(url)


def test_trusted_provider_court_mapping_is_tenant_isolated(store):
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    venue_a, venue_b = str(uuid.uuid4()), str(uuid.uuid4())
    court_a, court_b = str(uuid.uuid4()), str(uuid.uuid4())
    provider = str(uuid.uuid4())
    with store.trusted() as c:
        for org in (a, b):
            c.execute(text("""
                insert into public.organizations(id,slug,name)
                values(cast(:id as uuid),:slug,:name)
            """), {"id": org, "slug": "isolation-" + org[:8], "name": "Tenant fixture"})
        for venue, org in ((venue_a, a), (venue_b, b)):
            c.execute(text("""
                insert into public.venues(id,organization_id,name)
                values(cast(:id as uuid),cast(:org as uuid),:name)
            """), {"id": venue, "org": org, "name": "Fixture venue " + venue[:8]})
        for court, venue in ((court_a, venue_a), (court_b, venue_b)):
            c.execute(text("""
                insert into public.courts(id,venue_id,name,sport)
                values(cast(:id as uuid),cast(:venue as uuid),:name,'padel')
            """), {"id": court, "venue": venue, "name": "Fixture court"})
        c.execute(text("""
            insert into public.provider_connections(id,organization_id,provider,status)
            values(cast(:id as uuid),cast(:org as uuid),'playtomic','configured')
        """), {"id": provider, "org": a})
        for external, mapping_org, local_id in (
            ("good", a, court_a),
            ("foreign_court", a, court_b),
            ("foreign_mapping", b, court_a),
        ):
            c.execute(text("""
                insert into public.provider_mappings(
                    organization_id,provider_connection_id,entity_type,local_id,external_id)
                values(cast(:org as uuid),cast(:pc as uuid),'court',cast(:local as uuid),:external)
            """), {"org": mapping_org, "pc": provider, "local": local_id,
                   "external": external})
        valid = _mapping(store, c, provider, "good")
        assert valid is not None
        assert valid["court_id"] == court_a
        assert valid["venue_id"] == venue_a
        assert valid["organization_id"] == a
        # Even trusted workers must NOT use valid foreign local IDs.
        assert _mapping(store, c, provider, "foreign_court") is None
        assert _mapping(store, c, provider, "foreign_mapping") is None
        assert _mapping(store, c, provider, "missing") is None
