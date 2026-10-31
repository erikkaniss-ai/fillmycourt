"""Authenticated Operations read-only review against ephemeral PG16 fixtures."""
from datetime import datetime
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from fmc.config import Settings
from fmc.v1_app import create_v1_app
from test_fill_operator_tenant_isolation import StaticActor
from test_provider_provenance_review import pilot, NOW

TOKEN = {"Authorization": "Bearer ci-fixture-token"}


def client_for(pilot, monkeypatch, actor=None, service="operations"):
    db, owner, _, _, _, _ = pilot
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW
    monkeypatch.setattr("fmc.v1_app.datetime", Clock)
    settings = Settings(origin="https://fill.test", environment="test",
        database=db.engine.url.render_as_string(hide_password=False),
        supabase_url="https://example.supabase.co", supabase_publishable_key="sb_publishable_ci",
        data_contract="supabase-v1")
    return TestClient(create_v1_app(settings, service, auth_override=StaticActor(actor or owner)))


def test_api_returns_only_scoped_internal_report_and_safe_connection_list(pilot, monkeypatch):
    db, owner, outsider, org, foreign, pc = pilot
    client = client_for(pilot, monkeypatch)
    base = f"/api/fmc/{org}/provider-provenance"
    connections = client.get(base + "/connections", headers=TOKEN)
    assert connections.status_code == 200, connections.text
    assert connections.json() == {"items": [{"id": pc, "provider": "playtomic"}]}
    assert connections.headers["cache-control"] == "no-store"
    params = {"max_age_seconds": 60, "limit": 3}
    first = client.get(base + "/" + pc, params=params, headers=TOKEN)
    assert first.status_code == 200, first.text
    data = first.json()
    assert [item["status"] for item in data["items"]] == [
        "consistent_internal_evidence", "missing_receipt_reference", "stale_receipt"]
    assert data["has_more"] and data["status"] == "needs_review"
    second = client.get(base + "/" + pc, headers=TOKEN,
        params={**params, "after_booking_id": data["next_after_booking_id"]})
    assert [item["status"] for item in second.json()["items"]] == [
        "receipt_unavailable", "invalid_receipt"]
    assert not second.json()["has_more"]
    for report in (data, second.json()):
        assert not report["pilot_ready"] and not report["provider_requests_allowed"]
        assert not report["can_display_available_slots"]
        assert set(report["items"][0]) == {"booking_id", "status", "pilot_ready",
            "provider_requests_allowed", "can_display_available_slots"}
        for hidden in (foreign, "club-fixture", "official_grant", "agreement-fixture", "fingerprint"):
            assert hidden not in json.dumps(report)
    # Connection config and raw receipts are never returned by the picker.
    assert "config" not in connections.text and "capabilities" not in connections.text

    for suffix in ("/connections", "/" + pc):
        kwargs = {"params": {"max_age_seconds": 60}} if suffix != "/connections" else {}
        assert client.get(base + suffix, **kwargs).status_code == 401
        denied = client_for(pilot, monkeypatch, outsider).get(base + suffix, headers=TOKEN, **kwargs)
        assert denied.status_code == 403
        for method in ("post", "put", "delete", "patch"):
            assert getattr(client, method)(base + suffix, headers=TOKEN).status_code == 405
    assert client.get(base + "/" + str(uuid.uuid4()), headers=TOKEN,
        params={"max_age_seconds": 60}).status_code == 403
    assert client.get(f"/api/fmc/{foreign}/provider-provenance/{pc}", headers=TOKEN,
        params={"max_age_seconds": 60}).status_code == 403
    unsupported_pc = str(uuid.uuid4())
    with db.trusted() as c:
        c.execute(text("""insert into public.provider_connections(id,organization_id,provider)
            values(cast(:id as uuid),cast(:org as uuid),'tiesports')"""),
            {"id": unsupported_pc, "org": org})
    assert client.get(base + "/" + unsupported_pc, headers=TOKEN,
        params={"max_age_seconds": 60}).status_code == 403
    assert client.get(base + "/connections", headers=TOKEN).json() == connections.json()
    # These routes must not appear on the transactional Core service.
    core = client_for(pilot, monkeypatch, service="core")
    assert core.get(base + "/connections", headers=TOKEN).status_code == 404
    assert core.get(base + "/preflight", headers=TOKEN,
        params={"expected_operations_sha": "f" * 40}).status_code == 404


@pytest.mark.parametrize("role,expected", [
    ("owner", 200), ("admin", 200), ("manager", 403), ("analyst", 403),
    ("front_desk", 403), ("support", 403),
])
def test_evidence_requires_a_review_role(pilot, monkeypatch, role, expected):
    db, owner, _, org, _, pc = pilot
    with db.trusted() as c:
        c.execute(text("""update public.organization_members set role=cast(:role as public.fmc_member_role)
            where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)"""),
            {"role": role, "org": org, "uid": owner})
    client = client_for(pilot, monkeypatch)
    base = f"/api/fmc/{org}/provider-provenance"
    assert client.get(base + "/connections", headers=TOKEN).status_code == expected
    assert client.get(base + "/" + pc, params={"max_age_seconds": 60},
        headers=TOKEN).status_code == expected


@pytest.mark.parametrize("params", [{}, {"max_age_seconds": 0}, {"max_age_seconds": 31536001},
    {"max_age_seconds": "invalid"}, {"max_age_seconds": 60, "limit": 51},
    {"max_age_seconds": 60, "limit": 0}, {"max_age_seconds": 60, "after_booking_id": "bad"}])
def test_api_rejects_missing_or_invalid_review_scope(pilot, monkeypatch, params):
    _, _, _, org, _, pc = pilot
    client = client_for(pilot, monkeypatch)
    assert client.get(f"/api/fmc/{org}/provider-provenance/{pc}",
        params=params, headers=TOKEN).status_code == 422
