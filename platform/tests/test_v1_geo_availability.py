"""QA-11: Core GPS search must honor GetACourt radius and native booking authority.

Fixtures are written only to the fresh PostgreSQL16 GitHub CI database.
No live Supabase, Netlify, provider, auth account or real booking calls.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import json
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from fmc.config import Settings
from fmc.supabase_v1 import V1Store
from fmc.v1_app import _venue_coordinates, _distance_km, create_v1_app


def test_haversine_and_coordinate_fail_closed():
    assert _venue_coordinates({"lat": 38.6979, "lon": -9.4215}) == (38.6979, -9.4215)
    for address in ({}, None, "Cascais", {"lat": "not-gps", "lon": -9},
                    {"lat": True, "lon": 2}, {"lat": 91, "lon": 2},
                    {"lat": "NaN", "lon": 1}, {"lat": 38, "lon": "Infinity"}):
        assert _venue_coordinates(address) is None
    assert _distance_km(38.6979, -9.4215, 38.6979, -9.4215) == 0
    assert 20 < _distance_km(38.6979, -9.4215, 38.77, -9.13) < 40


@pytest.fixture
def geo_core():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires CI PostgreSQL migration database")
    db = V1Store(url)
    created = []
    with db.trusted() as conn:
        for suffix, lat, lon in (
            ("near", 38.6979, -9.4215),
            ("far", 38.77, -9.13),
            ("missing", None, None)
        ):
            oid, vid, cid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
            slug = "geo-" + oid[:8]
            conn.execute(text("insert into public.organizations(id,slug,name) values(cast(:id as uuid),:slug,:name)"),
                         {"id": oid, "slug": slug, "name": "Geo QA " + suffix})
            address = {"city": "Cascais" if suffix != "far" else "Lisbon",
                       "country": "Portugal"}
            if lat is not None:
                address.update(lat=lat, lon=lon)
            conn.execute(text("""insert into public.venues(id,organization_id,name,address)
                                 values(cast(:vid as uuid),cast(:oid as uuid),:name,cast(:address as jsonb))"""),
                         {"vid": vid, "oid": oid, "name": "QA geo " + suffix, "address": json.dumps(address)})
            conn.execute(text("""insert into public.courts
                (id,venue_id,name,sport,indoor,inventory_mode,native_write_enabled)
                values(cast(:cid as uuid),cast(:vid as uuid),'QA court','padel',true,'native',true)"""),
                         {"cid": cid, "vid": vid})
            conn.execute(text("""insert into public.court_rates
                (organization_id,court_id,price_minor,currency)
                values(cast(:oid as uuid),cast(:cid as uuid),2500,'EUR')"""),
                         {"oid": oid, "cid": cid})
            created.append((oid, vid, cid))
    try:
        app = create_v1_app(Settings(database=url), service="core")
        with TestClient(app) as client:
            yield client
    finally:
        with db.trusted() as conn:
            for oid, vid, cid in reversed(created):
                conn.execute(text("delete from public.court_rates where court_id=cast(:cid as uuid)"), {"cid": cid})
                conn.execute(text("delete from public.courts where id=cast(:cid as uuid)"), {"cid": cid})
                conn.execute(text("delete from public.venues where id=cast(:vid as uuid)"), {"vid": vid})
                conn.execute(text("delete from public.organizations where id=cast(:oid as uuid)"), {"oid": oid})


def _query(client, **extras):
    day = (datetime.now(ZoneInfo("Europe/Lisbon")) + timedelta(days=3)).date().isoformat()
    params={"date": day, "time": "17:00", "end_time": "19:00", "sport": "padel",
            "duration": 90, "location": "Current location"}
    return client.get("/api/availability", params={**params, **extras})


def test_gps_location_ignores_placeholder_text_and_obeys_radius(geo_core):
    center={"lat": 38.6979, "lon": -9.4215}
    near=_query(geo_core, **center, radius_km=5)
    assert near.status_code == 200, near.text
    slots=near.json()["slots"]
    assert slots and {s["venue_name"] for s in slots} == {"QA geo near"}
    assert all(s["distance_km"] <= 5 for s in slots)
    assert all(s["venue_lat"] == 38.6979 and s["venue_lon"] == -9.4215 for s in slots)

    expanded=_query(geo_core, **center, radius_km=50)
    assert expanded.status_code == 200
    assert {s["venue_name"] for s in expanded.json()["slots"]} == {"QA geo near", "QA geo far"}
    assert max(s["distance_km"] for s in expanded.json()["slots"]) > 20
    assert all("QA geo missing" != s["venue_name"] for s in expanded.json()["slots"])


def test_gps_invalid_coordinates_never_expand_to_country_wide_query(geo_core):
    for fields in ({"lat": 38.7}, {"lon": -9.42}, {"lat": 90.01, "lon": 0},
                   {"lat": 38.7, "lon": -9.42, "radius_km": 0},
                   {"lat": 38.7, "lon": -9.42, "radius_km": 51},
                   {"lat": "NaN", "lon": 0},
                   {"lat": 38.7, "lon": "Infinity"}):
        res = _query(geo_core, **fields)
        assert res.status_code == 422, (fields, res.status_code, res.text)


def test_legacy_typed_area_remains_supported_with_real_map_coords(geo_core):
    day=(datetime.now(ZoneInfo("Europe/Lisbon")) + timedelta(days=3)).date().isoformat()
    res=geo_core.get("/api/availability",params={
        "date":day,"time":"17:00","end_time":"19:00","sport":"padel","duration":90,
        "location":"Lisbon"
    })
    assert res.status_code == 200, res.text
    assert {s["venue_name"] for s in res.json()["slots"]} == {"QA geo far"}
    assert all(s["venue_lat"] == 38.77 and s["venue_lon"] == -9.13 for s in res.json()["slots"])
    assert all("distance_km" not in s for s in res.json()["slots"])
