"""Protected-UAT rehearsal, not hosted acceptance or pilot GO.

Real Operations routes + authenticated PG16/RLS + Chromium, with a local mocked
Auth transport. Fixture setup refuses remote/non-test databases. No provider
transport, deployed credentials, production, schema or policy changes.
"""
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import threading
from types import SimpleNamespace
import uuid
from urllib.parse import urlparse
from http.server import ThreadingHTTPServer

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url

from fmc.config import Settings
from fmc.supabase_v1 import SupabaseAuth, V1Store
from fmc.v1_app import create_v1_app
from test_provider_provenance_review import (
    NOW, evidence, record, _observe, _observe_booking_receipt,
)

EXPECTED = ["consistent_internal_evidence", "missing_receipt_reference",
            "stale_receipt", "receipt_unavailable"]
MEMBERSHIPS = {
    "owner_a": {0: "owner"}, "owner_b": {1: "owner"},
    "admin_a": {0: "admin"}, "admin_b": {1: "admin"},
    "dual_admin": {0: "admin", 1: "admin"},
    "mixed": {0: "owner", 1: "manager"},
    **{role: {0: role, 1: role} for role in ("manager", "analyst", "front_desk", "support")},
    "outsider": {},
}


def fixture_database(url, opt_in):
    """Do not print a rejected DSN or silently fall back to another database."""
    try:
        parsed = make_url(url)
        valid = (opt_in == "ci-local-only" and parsed.drivername == "postgresql+psycopg"
                 and parsed.host in {"localhost", "127.0.0.1", "::1"}
                 and parsed.database == "fmc_test" and not parsed.query)
    except Exception:
        valid = False
    if not valid:
        raise ValueError("UAT fixtures require explicit opt-in and a loopback fmc_test database.")
    return url


@pytest.mark.parametrize("url,opt_in", [
    ("postgresql+psycopg://fixture:never-print@remote.invalid/fmc_test", "ci-local-only"),
    ("postgresql+psycopg://fixture@localhost/production", "ci-local-only"),
    ("postgresql+psycopg://fixture@localhost/fmc_test", ""),
    ("postgresql+psycopg://fixture@localhost/fmc_test?host=remote.invalid", "ci-local-only"),
    ("sqlite:///fmc_test", "ci-local-only"), ("not-a-url", "ci-local-only"),
    ("", "ci-local-only"),
], ids=["remote-host", "non-test-db", "missing-opt-in", "query-host-override",
        "wrong-driver", "malformed-url", "missing-db"])
def test_uat_fixture_setup_refuses_unsafe_targets(url, opt_in):
    with pytest.raises(ValueError) as rejected:
        fixture_database(url, opt_in)
    assert "never-print" not in str(rejected.value)
    if url:
        assert url not in str(rejected.value)


@pytest.fixture
def two_org_uat(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url and not os.getenv("FILL_PROVENANCE_UAT_FIXTURES"):
        pytest.skip("Requires CI-local ephemeral PostgreSQL16, not a hosted project")
    fixture_database(url, os.getenv("FILL_PROVENANCE_UAT_FIXTURES"))
    db = V1Store(url)
    orgs, connections, venues, courts = [[str(uuid.uuid4()) for _ in range(2)] for _ in range(4)]
    users = {name: str(uuid.uuid4()) for name in MEMBERSHIPS}
    tokens = {name: "ci-uat-" + str(uuid.uuid4()) for name in MEMBERSHIPS}
    ids = [[str(uuid.UUID(int=(uuid.uuid4().int & ~0xFFFF) + n + 1))
            for n in range(4)] for _ in range(2)]
    # UUID order, rather than insertion order, defines the reader's keyset.
    ids = [sorted(group) for group in ids]
    current, stale = [], []
    for i in range(2):
        current.append(evidence(monkeypatch, org=orgs[i], pc=connections[i]))
        stale.append(evidence(monkeypatch, org=orgs[i], pc=connections[i],
                              observed=NOW - timedelta(seconds=120)))
    with db.trusted() as c:
        for uid in users.values():
            c.execute(text("insert into auth.users(id) values(cast(:id as uuid))"), {"id": uid})
        for i in range(2):
            c.execute(text("""insert into public.organizations(id,slug,name)
                values(cast(:id as uuid),:slug,:name)"""),
                {"id": orgs[i], "slug": "uat-" + orgs[i], "name": "SYNTHETIC UAT " + "AB"[i]})
            for name, roles in MEMBERSHIPS.items():
                if i in roles:
                    c.execute(text("""insert into public.organization_members(organization_id,user_id,role)
                        values(cast(:org as uuid),cast(:uid as uuid),cast(:role as public.fmc_member_role))"""),
                        {"org": orgs[i], "uid": users[name], "role": roles[i]})
            c.execute(text("""insert into public.venues(id,organization_id,name)
                values(cast(:id as uuid),cast(:org as uuid),'SYNTHETIC UAT venue')"""),
                {"id": venues[i], "org": orgs[i]})
            c.execute(text("""insert into public.courts(id,venue_id,name,sport)
                values(cast(:id as uuid),cast(:venue as uuid),'SYNTHETIC UAT court','padel')"""),
                {"id": courts[i], "venue": venues[i]})
            config = current[i][0]
            c.execute(text("""insert into public.provider_connections
                (id,organization_id,provider,status,capabilities,config)
                values(cast(:id as uuid),cast(:org as uuid),'playtomic','configured',
                    cast(:caps as jsonb),cast(:config as jsonb))"""),
                {"id": connections[i], "org": orgs[i], "caps": json.dumps(config["capabilities"]),
                 "config": json.dumps(config["config"])})
            for row in (current[i][2], stale[i][2]):
                _observe_booking_receipt(c, row["payload"])
            _observe(c, orgs[i], connections[i], "bookings", record())
            metadata = [current[i][1]["metadata"], {}, stale[i][1]["metadata"], current[1-i][1]["metadata"]]
            for n in range(4):
                c.execute(text("""insert into public.bookings
                    (id,organization_id,venue_id,court_id,source,status,starts_at,ends_at,
                     currency,external_reference,metadata)
                    values(cast(:id as uuid),cast(:org as uuid),cast(:venue as uuid),cast(:court as uuid),
                        'playtomic','confirmed','2026-10-21T10:00:00Z','2026-10-21T11:00:00Z',
                        'EUR',:ext,cast(:metadata as jsonb))"""),
                    {"id": ids[i][n], "org": orgs[i], "venue": venues[i], "court": courts[i],
                     "ext": "booking-fixture" if n == 0 else f"uat-{n}",
                     "metadata": json.dumps(metadata[n])})

    def auth_response(request):
        assert str(request.url) == "https://auth.uat.invalid/auth/v1/user"
        assert request.method == "GET"
        name = next((name for name, token in tokens.items()
                     if request.headers.get("authorization") == "Bearer " + token), None)
        if name is None:
            return httpx.Response(401, json={"error": "synthetic invalid session"})
        # Forged user-editable role and org claims MUST NOT grant DB access.
        return httpx.Response(200, json={"id": users[name], "email": name + "@example.invalid",
            "user_metadata": {"role": "owner", "organization_id": orgs[1]}})

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW
    monkeypatch.setattr("fmc.v1_app.datetime", Clock)
    monkeypatch.setattr("fmc.v1_app.V1Store", lambda _: db)
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "false")
    with httpx.Client(transport=httpx.MockTransport(auth_response)) as http:
        auth = SupabaseAuth("https://auth.uat.invalid", "fixture-publishable-key", http=http)
        settings = Settings(origin="http://testserver", environment="test", database=url,
            supabase_url="https://auth.uat.invalid", supabase_publishable_key="fixture-publishable-key",
            data_contract="supabase-v1")
        with TestClient(create_v1_app(settings, "operations", auth_override=auth)) as client:
            yield SimpleNamespace(db=db, client=client, orgs=orgs, connections=connections,
                                  users=users, tokens=tokens, booking_ids=ids, auth=auth)
    db.engine.dispose()


def headers(uat, name):
    return {"Authorization": "Bearer " + uat.tokens[name]}


def root(uat, i):
    return f"/api/fmc/{uat.orgs[i]}/provider-provenance"


def report(uat, i, name, *, connection=None, **params):
    return uat.client.get(root(uat, i) + "/" + (connection or uat.connections[i]),
        headers=headers(uat, name), params={"max_age_seconds": 60, "limit": 2, **params})


def assert_no_foreign_or_private_data(response, uat, i):
    for value in (uat.orgs[1-i], uat.connections[1-i], *uat.booking_ids[1-i],
                  "official_grant", "agreement-fixture", "club-fixture", "fingerprint"):
        assert value not in response.text


@pytest.mark.parametrize("name", MEMBERSHIPS)
def test_two_org_role_matrix_and_no_foreign_evidence(two_org_uat, name):
    uat = two_org_uat
    own = uat.client.get("/api/fmc/organizations", headers=headers(uat, name))
    assert {o["id"] for o in own.json()["items"]} == {
        uat.orgs[i] for i in MEMBERSHIPS[name]}
    for i in range(2):
        allowed = MEMBERSHIPS[name].get(i) in {"owner", "admin"}
        connections = uat.client.get(root(uat, i) + "/connections", headers=headers(uat, name))
        first = report(uat, i, name)
        assert connections.status_code == first.status_code == (200 if allowed else 403)
        assert connections.headers["cache-control"] == first.headers["cache-control"] == "no-store"
        assert_no_foreign_or_private_data(connections, uat, i)
        assert_no_foreign_or_private_data(first, uat, i)
        preflight = uat.client.get(root(uat, i) + "/preflight",
            headers=headers(uat, name), params={"expected_operations_sha": "f" * 40})
        assert preflight.status_code == (200 if allowed else 403)
        assert_no_foreign_or_private_data(preflight, uat, i)
        assert preflight.headers["cache-control"] == "no-store"
        if allowed:
            assert preflight.json()["hosted_uat_ready"] is False
        if not allowed:
            assert first.json()["error"] == connections.json()["error"] == "FORBIDDEN"
            assert all(bid not in first.text for bid in uat.booking_ids[i])
            continue
        assert connections.json() == {"items": [{"id": uat.connections[i], "provider": "playtomic"}]}
        second = report(uat, i, name, after_booking_id=first.json()["next_after_booking_id"])
        assert second.status_code == 200
        assert_no_foreign_or_private_data(second, uat, i)
        items = first.json()["items"] + second.json()["items"]
        assert [item["booking_id"] for item in items] == uat.booking_ids[i]
        assert [item["status"] for item in items] == EXPECTED
        assert first.json()["has_more"] and not second.json()["has_more"]
        for data in (first.json(), second.json(), *items):
            assert all(data[flag] is False for flag in (
                "pilot_ready", "provider_requests_allowed", "can_display_available_slots"))
        # Being an admin in both orgs must not permit mixed org/connection IDs.
        assert report(uat, i, name, connection=uat.connections[1-i]).status_code == 403
        # A foreign UUID cursor must not change authorization or expose its row.
        cursor = report(uat, i, name, after_booking_id=uat.booking_ids[1-i][0])
        assert cursor.status_code == 200
        assert_no_foreign_or_private_data(cursor, uat, i)
        assert {item["booking_id"] for item in cursor.json()["items"]} <= set(uat.booking_ids[i])


@pytest.mark.parametrize("authorization", [None, "Bearer expired-fixture-token", "Bearer invalid-fixture-token"],
                         ids=["anonymous", "expired-session-fixture", "invalid-session-fixture"])
def test_two_org_auth_denials_do_not_return_private_data(two_org_uat, authorization):
    uat = two_org_uat
    for i in range(2):
        for suffix, params in (("/connections", {}), ("/" + uat.connections[i], {"max_age_seconds": 60})):
            response = uat.client.get(root(uat, i) + suffix, params=params,
                headers={"Authorization": authorization} if authorization else {})
            assert response.status_code == 401
            assert all(bid not in response.text for group in uat.booking_ids for bid in group)
            assert response.headers["cache-control"] == "no-store"


def test_membership_changes_are_rechecked_even_with_a_cached_actor(two_org_uat):
    uat = two_org_uat
    assert report(uat, 0, "dual_admin").status_code == 200
    assert uat.auth.cache, "Exercise the normal short-lived identity cache"
    with uat.db.trusted() as c:
        c.execute(text("""update public.organization_members set role='manager'
            where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)"""),
            {"org": uat.orgs[0], "uid": uat.users["dual_admin"]})
    assert report(uat, 0, "dual_admin").status_code == 403
    assert report(uat, 1, "dual_admin").status_code == 200
    with uat.db.trusted() as c:
        c.execute(text("""delete from public.organization_members
            where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)"""),
            {"org": uat.orgs[1], "uid": uat.users["dual_admin"]})
    assert report(uat, 1, "dual_admin").status_code == 403


def scoped_snapshot(uat):
    result = {}
    # Fixed table identifiers, parameterized scope; never print private rows.
    for table in ("organizations", "organization_members", "provider_connections", "bookings",
                  "provider_observations", "booking_holds", "jobs"):
        column = "id" if table == "organizations" else "organization_id"
        with uat.db.trusted() as c:
            result[table] = c.execute(text(f"""select coalesce(jsonb_agg(to_jsonb(t)
                order by to_jsonb(t)::text),'[]'::jsonb) from public.{table} t
                where {column} in (cast(:a as uuid),cast(:b as uuid))"""),
                {"a": uat.orgs[0], "b": uat.orgs[1]}).scalar_one()
    return hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()


def test_uat_reads_and_rejected_writes_preserve_both_orgs(two_org_uat):
    uat = two_org_uat
    before = scoped_snapshot(uat)
    for i in range(2):
        assert report(uat, i, "dual_admin").status_code == 200
        for method in ("post", "put", "patch", "delete"):
            for suffix in ("/connections", "/" + uat.connections[i]):
                assert getattr(uat.client, method)(root(uat, i) + suffix,
                    headers=headers(uat, "dual_admin")).status_code == 405
    assert scoped_snapshot(uat) == before
    assert os.getenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED") == "false"


@pytest.mark.parametrize("revision,flag,expected", [
    ("f" * 40, "false", "operations_checks_passed"),
    (None, "false", "blocked"), ("e" * 40, "false", "blocked"),
    ("f" * 40, "true", "blocked"), ("f" * 40, "ambiguous", "blocked"),
])
def test_operations_preflight_is_scoped_read_only_and_never_uat_go(two_org_uat, monkeypatch,
                                                                 revision, flag, expected):
    uat = two_org_uat
    if revision is None:
        monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)
    else:
        monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", revision)
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", flag)
    before = scoped_snapshot(uat)
    for i in range(2):
        path = root(uat, i) + "/preflight"
        response = uat.client.get(path, headers=headers(uat, "dual_admin"),
                                  params={"expected_operations_sha": "f" * 40})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == expected
        for check in ("owner_admin_scope", "authenticated_rls_context", "repeatable_read_only",
                      "schema_rls_select", "reader_columns_present", "get_routes_present"):
            assert body["checks"][check] == "pass", body
        assert all(body[flag] is False for flag in ("hosted_uat_ready", "uat_accepted",
            "pilot_ready", "provider_requests_allowed", "can_display_available_slots", "deploy_allowed"))
        assert_no_foreign_or_private_data(response, uat, i)
        for method in ("post", "put", "patch", "delete"):
            assert getattr(uat.client, method)(path, headers=headers(uat, "dual_admin")).status_code == 405
        for bad in ({}, {"expected_operations_sha": "short"}):
            assert uat.client.get(path, headers=headers(uat, "dual_admin"), params=bad).status_code == 422
        assert uat.client.get(path, params={"expected_operations_sha": "f" * 40}).status_code == 401
    assert scoped_snapshot(uat) == before


def test_preflight_database_failure_is_redacted_without_trusted_retry(two_org_uat, monkeypatch):
    from contextlib import contextmanager
    from sqlalchemy.exc import SQLAlchemyError
    uat = two_org_uat

    @contextmanager
    def unavailable(*args, **kwargs):
        assert kwargs == {"readonly": True}
        raise SQLAlchemyError("fixture-private-dsn-and-schema-details")
        yield  # pragma: no cover

    def no_fallback():
        raise AssertionError("Preflight must not fall back to trusted SQL")

    monkeypatch.setattr(uat.db, "user", unavailable)
    monkeypatch.setattr(uat.db, "trusted", no_fallback)
    response = uat.client.get(root(uat, 0) + "/preflight", headers=headers(uat, "dual_admin"),
        params={"expected_operations_sha": "f" * 40})
    assert response.status_code == 503
    assert response.json() == {"error": "PREFLIGHT_UNAVAILABLE",
                               "message": "Operations preflight is unavailable."}
    assert "private" not in response.text and "schema" not in response.text


@pytest.mark.parametrize("late_status", [200, 403])
def test_two_org_browser_uses_real_rls_and_discards_late_scope(two_org_uat, tmp_path, late_status):
    from playwright.sync_api import expect, sync_playwright
    from test_fill_operator_e2e import QuietHandler

    uat = two_org_uat
    before = scoped_snapshot(uat)
    directory = Path(os.getenv("FILL_QA_ARTIFACT_DIR") or tmp_path)
    directory.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    pending, calls = [], []
    hold = [False]
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.add_init_script("if(!sessionStorage.getItem('fill.access')) "
                f"sessionStorage.setItem('fill.access', {json.dumps(uat.tokens['dual_admin'])});")

            def forward(route):
                req = route.request
                url = urlparse(req.url)
                assert url.netloc == f"127.0.0.1:{server.server_port}", "External traffic forbidden"
                if not url.path.startswith("/api/"):
                    return route.continue_()
                assert req.method == "GET", "UAT must not send business/auth writes"
                calls.append(url.path)
                if hold[0] and url.path == root(uat, 0) + "/" + uat.connections[0]:
                    pending.append(route)
                    return
                response = uat.client.get(url.path + ("?" + url.query if url.query else ""),
                    headers={"Authorization": req.headers.get("authorization", "")})
                route.fulfill(status=response.status_code, content_type="application/json", body=response.text)

            page.route("**/*", forward)
            page.goto(f"http://127.0.0.1:{server.server_port}/fill/", wait_until="networkidle")
            page.get_by_role("button", name="Provider evidence", exact=True).click()

            def review(i):
                page.locator("#provenanceConnection").select_option(uat.connections[i])
                page.locator("#provenanceAge").fill("60")
                page.get_by_role("button", name="Review stored evidence", exact=True).click()

            page.locator("#orgSelect").select_option(uat.orgs[0])
            review(0)
            expect(page.locator("#provenanceReport")).to_contain_text(uat.booking_ids[0][0])
            hold[0] = True
            page.get_by_role("button", name="Review stored evidence", exact=True).click()
            expect(page.locator("#provenanceMessage")).to_contain_text("Reviewing stored evidence")
            page.wait_for_timeout(50)
            assert len(pending) == 1
            page.locator("#orgSelect").select_option(uat.orgs[1])
            expect(page.locator("#provenanceReport")).to_be_empty()
            assert uat.connections[0] not in page.locator(
                "#provenanceConnection option").evaluate_all("(options) => options.map(o => o.value)")
            assert page.locator("#provenanceAge").input_value() == ""
            review(1)
            expect(page.locator("#provenanceReport")).to_contain_text(uat.booking_ids[1][0])
            for bid in uat.booking_ids[0]:
                assert bid not in page.content(), "Former organization leaked in hidden DOM"
            if late_status == 403:
                with uat.db.trusted() as c:
                    c.execute(text("""update public.organization_members set role='manager'
                        where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)"""),
                        {"org": uat.orgs[0], "uid": uat.users["dual_admin"]})
            old = report(uat, 0, "dual_admin", limit=50)
            assert old.status_code == late_status
            with page.expect_response(lambda r: r.url.endswith(
                    "/provider-provenance/" + uat.connections[0] + "?max_age_seconds=60&limit=50")):
                pending[0].fulfill(status=old.status_code, content_type="application/json", body=old.text)
            expect(page.locator("#provenanceReport")).to_contain_text(uat.booking_ids[1][0])
            expect(page.locator("#provenanceMessage")).not_to_contain_text("permission")
            assert uat.connections[0] not in page.locator(
                "#provenanceConnection option").evaluate_all("(options) => options.map(o => o.value)")
            for bid in uat.booking_ids[0]:
                assert bid not in page.content()
            page.set_viewport_size({"width": 320, "height": 800})
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            page.screenshot(path=str(directory / f"fill-provenance-two-org-{late_status}-FIXTURE-ONLY.png"),
                            full_page=True)
            page.get_by_role("button", name="Sign out", exact=True).click()
            expect(page.locator("#workspace")).to_be_hidden()
            expect(page.locator("#provenanceReport")).to_be_empty()
            assert all(bid not in page.content() for group in uat.booking_ids for bid in group)
            # No add_init_script token for the next principal: explicit CI fixture,
            # not a claimed real password login or Supabase account provisioning.
            page.evaluate("(token) => sessionStorage.setItem('fill.access', token)", uat.tokens["manager"])
            page.reload(wait_until="networkidle")
            page.get_by_role("button", name="Provider evidence", exact=True).click()
            expect(page.locator("#provenanceMessage")).to_contain_text("permission")
            expect(page.locator("#provenanceReview")).to_be_disabled()
            expect(page.locator("#provenanceReport")).to_be_empty()
            assert all(bid not in page.content() for group in uat.booking_ids for bid in group)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    assert calls and all("/providers" not in path for path in calls)
    if late_status == 200:
        assert scoped_snapshot(uat) == before


@pytest.mark.parametrize("late_status", [200, 401, 403])
def test_preflight_viewer_two_org_real_api_scope_and_denials(two_org_uat, monkeypatch, tmp_path, late_status):
    """Source-only UI rehearsal, with real scoped API/RLS and no hosted traffic."""
    from playwright.sync_api import expect, sync_playwright
    from test_fill_operator_e2e import QuietHandler

    uat = two_org_uat
    before = scoped_snapshot(uat)
    sha_a, sha_b = "a" * 40, "b" * 40
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", sha_a)
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "false")
    directory = Path(os.getenv("FILL_QA_ARTIFACT_DIR") or tmp_path)
    directory.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    pending, calls = [], []
    hold = [False]
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.add_init_script("if(!sessionStorage.getItem('fill.access')) "
                f"sessionStorage.setItem('fill.access', {json.dumps(uat.tokens['dual_admin'])});")

            def forward(route):
                req, url = route.request, urlparse(route.request.url)
                assert url.netloc == f"127.0.0.1:{server.server_port}", "External traffic forbidden"
                if not url.path.startswith("/api/"):
                    return route.continue_()
                assert req.method == "GET", "Preflight UI cannot send writes"
                calls.append(url.path)
                if hold[0] and url.path == root(uat, 0) + "/preflight":
                    pending.append(route)
                    return
                response = uat.client.get(url.path + ("?" + url.query if url.query else ""),
                    headers={"Authorization": req.headers.get("authorization", "")})
                route.fulfill(status=response.status_code, content_type="application/json", body=response.text)

            page.route("**/*", forward)
            page.goto(f"http://127.0.0.1:{server.server_port}/fill/", wait_until="networkidle")
            page.get_by_role("button", name="Provider evidence", exact=True).click()
            page.locator("#orgSelect").select_option(uat.orgs[0])
            expect(page.locator("#operationsSha")).to_have_value("")
            assert not any(path.endswith("/preflight") for path in calls), "No automatic preflight"

            def check(sha):
                page.get_by_label("Expected Operations SHA", exact=True).fill(sha)
                page.get_by_role("button", name="Check Operations preflight", exact=True).click()

            check(sha_a)
            expect(page.locator("#preflightMessage")).to_contain_text("checks passed — not UAT or pilot approval")
            expect(page.locator("#preflightReport")).to_contain_text("not independent identity attestation")
            expect(page.locator("#preflightReport")).to_contain_text("Owner UAT GO")
            # A receipt review and its request epoch must remain independent.
            page.locator("#provenanceConnection").select_option(uat.connections[0])
            page.locator("#provenanceAge").fill("60")
            page.get_by_role("button", name="Review stored evidence", exact=True).click()
            expect(page.locator("#provenanceReport")).to_contain_text(uat.booking_ids[0][0])
            expect(page.locator("#preflightReport")).to_contain_text(sha_a)
            hold[0] = True
            page.get_by_role("button", name="Check Operations preflight", exact=True).click()
            expect(page.locator("#preflightMessage")).to_contain_text("Checking scoped Operations")
            page.wait_for_timeout(50)
            assert len(pending) == 1
            monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", sha_b)
            page.locator("#orgSelect").select_option(uat.orgs[1])
            expect(page.locator("#preflightReport")).to_be_empty()
            expect(page.locator("#operationsSha")).to_have_value("")
            check(sha_b)
            expect(page.locator("#preflightMessage")).to_contain_text("checks passed")
            expect(page.locator("#preflightReport")).to_contain_text(sha_b)

            if late_status == 403:
                # Synthetic setup only: demonstrate that a revoked A role does
                # not affect the valid B scope or permit a trusted retry.
                with uat.db.trusted() as c:
                    c.execute(text("""update public.organization_members set role='manager'
                        where organization_id=cast(:org as uuid) and user_id=cast(:uid as uuid)"""),
                        {"org": uat.orgs[0], "uid": uat.users["dual_admin"]})
            monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", sha_a)
            old = uat.client.get(root(uat, 0) + "/preflight",
                headers=headers(uat, "dual_admin") if late_status != 401
                    else {"Authorization": "Bearer invalid-ci-fixture"},
                params={"expected_operations_sha": sha_a})
            assert old.status_code == late_status
            monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", sha_b)
            with page.expect_response(lambda response: response.url.endswith(
                    "/preflight?expected_operations_sha=" + sha_a)):
                pending[0].fulfill(status=old.status_code, content_type="application/json", body=old.text)
            expect(page.locator("#preflightMessage")).to_contain_text("checks passed")
            expect(page.locator("#preflightReport")).to_contain_text(sha_b)
            expect(page.locator("#workspace")).to_be_visible()
            assert sha_a not in page.content(), "Former revision leaked into hidden DOM"
            assert all(bid not in page.content() for bid in uat.booking_ids[0])

            # HTTP 200 with a revision mismatch must visibly remain blocked.
            check("c" * 40)
            expect(page.locator("#preflightMessage")).to_contain_text("checks blocked")
            expect(page.locator("#preflightReport")).to_contain_text("Blocked")
            page.set_viewport_size({"width": 320, "height": 800})
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            page.screenshot(path=str(directory / f"fill-operations-preflight-{late_status}-FIXTURE-ONLY.png"),
                            full_page=True)
            page.get_by_role("button", name="Sign out", exact=True).click()
            expect(page.locator("#workspace")).to_be_hidden()
            expect(page.locator("#preflightReport")).to_be_empty()
            expect(page.locator("#operationsSha")).to_have_value("")
            assert sha_b not in page.content()
            page.evaluate("(token) => sessionStorage.setItem('fill.access', token)", uat.tokens["manager"])
            page.reload(wait_until="networkidle")
            page.get_by_role("button", name="Provider evidence", exact=True).click()
            check(sha_b)
            expect(page.locator("#preflightMessage")).to_contain_text("do not have permission")
            expect(page.locator("#preflightReport")).to_be_empty()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    assert calls and all("/providers" not in path for path in calls)
    if late_status != 403:
        assert scoped_snapshot(uat) == before
