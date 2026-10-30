"""Offline Auth Admin contract tests: all HTTP is intercepted, zero real users."""
import json
import uuid

import httpx
import pytest

from fill_auth_admin import (
    BAN, GO, ORIGIN, PROJECT, FixtureAuthAdmin, FixtureAuthError,
)


class AuthServer:
    def __init__(self):
        self.users = {}
        self.requests = []
        self.fail = None

    def handle(self, request):
        self.requests.append(request)
        if self.fail:
            response = self.fail(request)
            if response is not None:
                return response
        assert str(request.url).startswith(ORIGIN + "/auth/v1/admin/users")
        assert request.headers["apikey"] == "test-admin-secret"
        assert request.headers["authorization"] == "Bearer test-admin-secret"
        assert request.method in ("GET", "POST", "PUT")
        if request.method == "POST":
            assert request.url.path == "/auth/v1/admin/users"
            payload = json.loads(request.content)
            assert set(payload) == {"email", "password", "email_confirm",
                                    "ban_duration", "app_metadata"}
            assert payload["email"].endswith("@example.invalid")
            assert payload["email_confirm"] is True
            assert payload["ban_duration"] == BAN
            assert len(payload["password"]) >= 40
            uid = str(uuid.uuid4())
            self.users[uid] = {
                "id": uid, "email": payload["email"], "role": "authenticated",
                "app_metadata": payload["app_metadata"],
                "email_confirmed_at": "2026-10-30T12:00:00Z",
                "banned_until": "2126-10-30T12:00:00Z",
            }
            return httpx.Response(201, json=self.users[uid])
        uid = request.url.path.rsplit("/", 1)[1]
        if request.method == "PUT":
            payload = json.loads(request.content)
            assert set(payload) == {"ban_duration"}
            assert payload["ban_duration"] in (BAN, "none")
            self.users[uid]["banned_until"] = (
                None if payload["ban_duration"] == "none" else "2126-10-30T12:00:00Z")
        return httpx.Response(200, json=self.users[uid])

    def run(self, **kwargs):
        return FixtureAuthAdmin(project_ref=PROJECT, go=GO, key="test-admin-secret",
                                transport=httpx.MockTransport(self.handle), **kwargs)


@pytest.mark.parametrize("project,go,key", [
    ("production", GO, "key"), (PROJECT + ".evil.test", GO, "key"),
    (PROJECT, None, "key"), (PROJECT, "true", "key"), (PROJECT, GO, ""),
    (PROJECT, GO, None), (PROJECT, GO, "   "),
])
def test_requires_explicit_fixed_staging_target_and_private_key(project, go, key):
    with pytest.raises(FixtureAuthError):
        FixtureAuthAdmin(project_ref=project, go=go, key=key)


def test_environment_gate_has_no_generic_supabase_fallback(monkeypatch):
    for name in ("FILL_AUTH_ADMIN_GO", "FILL_AUTH_ADMIN_PROJECT_REF", "FILL_AUTH_ADMIN_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "must-not-be-used")
    with pytest.raises(FixtureAuthError, match="STAGING_FIXTURE_GO_REQUIRED"):
        FixtureAuthAdmin.from_env()


def test_supported_creation_activation_and_verified_disable():
    server = AuthServer()
    with server.run() as run:
        a = run.create("a-owner")
        b = run.create("b-owner")
        assert a.user_id != b.user_id
        assert a.password != b.password
        assert a.password not in repr(a)
        assert a.password not in json.dumps(run.receipt())
        assert "test-admin-secret" not in repr(run)
        run.activate(a.user_id)
        assert server.users[a.user_id]["banned_until"] is None
        assert run.receipt()["users"][0]["disabled_verified"] is False
    report = run.receipt()
    assert report["closed"] is True
    assert all(u["disabled_verified"] for u in report["users"])
    assert report["hosted_uat"] == "NOT_RUN"
    assert report["immediate_revoke"] == "NOT_VERIFIED"
    assert all("email" not in u and "password" not in u for u in report["users"])
    assert all(r.method != "DELETE" for r in server.requests)


def test_finally_disables_after_uat_failure():
    server = AuthServer()
    with pytest.raises(RuntimeError, match="UAT failure"):
        with server.run() as run:
            user = run.create("a-owner")
            run.activate(user.user_id)
            raise RuntimeError("UAT failure")
    assert run.receipt()["users"][0]["disabled_verified"] is True


@pytest.mark.parametrize("label", ["real-owner@example.com", "../users", "", "owner"])
def test_only_fixed_fictional_labels_without_arbitrary_emails(label):
    server = AuthServer()
    with server.run() as run:
        with pytest.raises(FixtureAuthError, match="FIXTURE_LABEL_DENIED"):
            run.create(label)
    assert server.requests == []


def test_duplicate_label_foreign_user_and_closed_run_do_not_send_requests():
    server = AuthServer()
    with server.run() as run:
        user = run.create("a-owner")
        count = len(server.requests)
        with pytest.raises(FixtureAuthError, match="FIXTURE_LABEL_DENIED"):
            run.create("a-owner")
        with pytest.raises(FixtureAuthError, match="FOREIGN_USER_DENIED"):
            run.activate(str(uuid.uuid4()))
        assert len(server.requests) == count
    count = len(server.requests)
    with pytest.raises(FixtureAuthError, match="RUN_CLOSED"):
        run.activate(user.user_id)
    with pytest.raises(FixtureAuthError, match="RUN_CLOSED"):
        run.create("b-owner")
    run.close()
    assert len(server.requests) == count


@pytest.mark.parametrize("mode", ["timeout", "500", "redirect", "bad-json", "bad-id"])
def test_ambiguous_create_never_retries_follows_redirect_or_claims_cleanup(mode):
    server = AuthServer()
    def fail(request):
        if mode == "timeout":
            raise httpx.ReadTimeout("sensitive-upstream-body test-admin-secret", request=request)
        if mode == "500":
            return httpx.Response(500, text="sensitive-upstream-body")
        if mode == "redirect":
            return httpx.Response(307, headers={"location": "https://evil.test"})
        if mode == "bad-json":
            return httpx.Response(201, text="not-json-sensitive-upstream-body")
        return httpx.Response(201, json={"id": "../another-user"})
    server.fail = fail
    run = server.run()
    with pytest.raises(FixtureAuthError, match="CREATE_OUTCOME_UNVERIFIED_NO_RETRY") as err:
        run.create("a-owner")
    assert "sensitive" not in str(err.value)
    with pytest.raises(FixtureAuthError, match="NEEDS_RECONCILIATION"):
        run.create("b-owner")
    with pytest.raises(FixtureAuthError, match="CLEANUP_UNVERIFIED"):
        run.close()
    assert len(server.requests) == 1
    assert run.receipt()["unknown_create_outcome"] is True


@pytest.mark.parametrize("field,value", [
    ("email", "real-user@example.com"), ("role", "service_role"),
    ("app_metadata", {"fill_f1_run": "other-run"}), ("app_metadata", None),
])
def test_ownership_drift_prevents_activation_and_cleanup_mutation(field, value):
    server = AuthServer()
    run = server.run()
    user = run.create("a-owner")
    server.users[user.user_id][field] = value
    with pytest.raises(FixtureAuthError, match="OWNERSHIP_UNVERIFIED"):
        run.activate(user.user_id)
    with pytest.raises(FixtureAuthError, match="CLEANUP_UNVERIFIED"):
        run.close()
    assert not any(r.method == "PUT" for r in server.requests)
    assert run.receipt()["users"][0]["disabled_verified"] is False


def test_cleanup_attempts_remaining_users_when_one_ban_fails():
    server = AuthServer()
    run = server.run()
    a = run.create("a-owner")
    b = run.create("b-owner")
    run.activate(a.user_id)
    run.activate(b.user_id)
    server.fail = lambda request: (
        httpx.Response(503, text="secret body")
        if request.method == "PUT" and request.url.path.endswith(a.user_id) else None)
    with pytest.raises(FixtureAuthError, match="CLEANUP_UNVERIFIED"):
        run.close()
    receipt = {u["id"]: u["disabled_verified"] for u in run.receipt()["users"]}
    assert receipt == {a.user_id: False, b.user_id: True}


def test_successful_put_without_ban_readback_is_not_cleanup_success():
    server = AuthServer()
    run = server.run()
    user = run.create("a-owner")
    run.activate(user.user_id)
    server.fail = lambda request: (
        httpx.Response(200, json={}) if request.method == "PUT" else None)
    with pytest.raises(FixtureAuthError, match="CLEANUP_UNVERIFIED"):
        run.close()
    assert run.receipt()["users"][0]["disabled_verified"] is False


def test_create_readback_failure_still_tracks_identity_for_cleanup():
    server = AuthServer()
    run = server.run()
    server.fail = lambda request: (
        httpx.Response(503, json={}) if request.method == "GET" else None)
    with pytest.raises(FixtureAuthError):
        run.create("a-owner")
    server.fail = None
    run.close()
    assert len(run.receipt()["users"]) == 1
    assert run.receipt()["users"][0]["disabled_verified"] is True


@pytest.mark.parametrize("bad_value", ["not-a-date", "2126-01-01T00:00:00Z", 12, "2020-01-01"])
def test_activation_requires_a_valid_unbanned_readback(bad_value):
    server = AuthServer()
    run = server.run()
    user = run.create("a-owner")
    def fail(request):
        if request.method == "PUT":
            server.users[user.user_id]["banned_until"] = bad_value
            return httpx.Response(200, json={})
    server.fail = fail
    with pytest.raises(FixtureAuthError, match="ACTIVATION_UNVERIFIED"):
        run.activate(user.user_id)
    assert run.receipt()["users"][0]["disabled_verified"] is False
    server.fail = None
    run.close()


def test_activation_timeout_is_cleaned_up_without_retrying_activation():
    server = AuthServer()
    run = server.run()
    user = run.create("a-owner")
    def fail(request):
        if request.method == "PUT" and json.loads(request.content)["ban_duration"] == "none":
            server.users[user.user_id]["banned_until"] = None
            raise httpx.ReadTimeout("response lost after successful activation", request=request)
    server.fail = fail
    with pytest.raises(FixtureAuthError, match="OUTCOME_UNVERIFIED"):
        run.activate(user.user_id)
    run.close()
    assert run.receipt()["users"][0]["disabled_verified"] is True
    assert sum(r.method == "PUT" and json.loads(r.content)["ban_duration"] == "none"
               for r in server.requests) == 1
