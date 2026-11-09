"""Local grant withdrawal must discard cached club tokens, without provider IO."""
from copy import deepcopy
from time import time

import httpx
import pytest

from fmc.common import DomainError
from fmc.playtomic import Deferred, Playtomic
from fmc.provider_token_sessions import ProviderTokenSessions
from fmc import v1_workers


def connection():
    org = "11111111-1111-4111-8111-111111111111"
    return {
        "provider": "playtomic", "status": "configured", "organization_id": org,
        "capabilities": {"write_mode": "read_sync", "official_read_authorized": True},
        "config": {"tenant_id": "club-fixture", "official_grant": {
            "provider": "playtomic", "status": "approved",
            "authority": "club_or_certified_partner", "organization_id": org,
            "tenant_id": "club-fixture", "agreement_ref": "agreement-fixture",
            "owner_approval_ref": "approval-fixture", "scopes": ["bookings.read"],
            "approved_at": "2020-01-01T00:00:00Z", "expires_at": "2099-01-01T00:00:00Z",
        }},
    }


def credentials(pc="pc-fixture", org=None):
    return dict(organization_id=org or connection()["organization_id"],
                connection_id=pc, client_id="client-fixture",
                secret="secret-fixture", tenant="club-fixture")


def job():
    return {"payload": {"provider_connection_id": "pc-fixture", "stream": "bookings",
                        "window_start": "2026-10-20T00:00:00Z",
                        "window_end": "2026-10-21T00:00:00Z"}}


def no_io(*_args, **_kwargs):
    raise AssertionError("No credential lookup, rate reservation, shadow write or provider request allowed")


def test_discard_clears_retained_client_and_preserves_other_connection():
    sessions = ProviderTokenSessions(factory=lambda *args: Playtomic(
        *args, http=httpx.Client(transport=httpx.MockTransport(no_io))))
    old = sessions.get(**credentials())
    other = sessions.get(**credentials(pc="pc-other", org="org-other"))
    old.token = "synthetic-old-token"
    old.expires = time() + 3600
    other.token = "synthetic-other-token"
    other.expires = time() + 3600
    sessions.discard(connection_id="pc-fixture")
    sessions.discard(connection_id="pc-fixture")  # idempotent
    assert old.token is None and old.expires == 0
    assert not old.token_usable()
    assert sessions.size() == 1
    assert sessions.get(**credentials(pc="pc-other", org="org-other")) is other
    assert other.token_usable()
    assert sessions.get(**credentials()) is not old


@pytest.mark.parametrize("denial", ["revoked", "expired", "flag_off", "disabled", "scope"])
def test_worker_discards_warm_session_before_any_io_on_grant_denial(monkeypatch, denial):
    calls = []
    def respond(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(200, json={"token": "synthetic-new-token", "expires_in": 3600})
    sessions = ProviderTokenSessions(factory=lambda *args: Playtomic(
        *args, http=httpx.Client(transport=httpx.MockTransport(respond))))
    old = sessions.get(**credentials())
    old.token = "synthetic-old-token"
    old.expires = time() + 3600
    current = connection()
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    if denial == "revoked":
        current["config"]["official_grant"]["status"] = "revoked"
    elif denial == "expired":
        current["config"]["official_grant"]["expires_at"] = "2020-01-02T00:00:00Z"
    elif denial == "flag_off":
        monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "false")
    elif denial == "scope":
        current["config"]["official_grant"]["scopes"] = ["availability.read"]
    def lookup(_db, _pc):
        if denial == "disabled":
            raise DomainError("PROVIDER_NOT_CONFIGURED", "Connection disabled.", 409)
        return deepcopy(current)
    monkeypatch.setattr(v1_workers, "_connection", lookup)
    monkeypatch.setattr(v1_workers, "_credential", no_io)
    with pytest.raises(DomainError):
        v1_workers._sync_playtomic(object(), job(), sessions=sessions)
    assert sessions.size() == 0
    assert old.token is None and old.expires == 0
    assert calls == []

    # A later reviewed approval cannot silently resurrect the old token.
    # It gets ONE OAuth operation and must defer the bookings read separately.
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    monkeypatch.setattr(v1_workers, "_connection", lambda *_: connection())
    monkeypatch.setattr(v1_workers, "_credential", lambda *_:
                        ("client-fixture", "secret-fixture", "club-fixture"))
    class Db:
        reservations = 0
        def reserve_provider_request(self, pc):
            assert pc == "pc-fixture"
            self.reservations += 1
            return 0
        trusted = no_io
    db = Db()
    with pytest.raises(Deferred) as deferred:
        v1_workers._sync_playtomic(db, job(), sessions=sessions)
    assert deferred.value.code == "PROVIDER_AUTH_PACING"
    assert deferred.value.seconds == 60
    assert db.reservations == 1
    assert calls == [("POST", "/api/v1/oauth/token")]
    assert sessions.get(**credentials()) is not old


@pytest.mark.parametrize("status", [401, 403])
def test_provider_denial_evicts_session_without_same_reservation_reauth(monkeypatch, status):
    calls = []
    def respond(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(status)
    sessions = ProviderTokenSessions(factory=lambda *args: Playtomic(
        *args, http=httpx.Client(transport=httpx.MockTransport(respond))))
    old = sessions.get(**credentials())
    old.token = "synthetic-denied-token"
    old.expires = time() + 3600
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED", "true")
    monkeypatch.setattr(v1_workers, "_connection", lambda *_: connection())
    monkeypatch.setattr(v1_workers, "_credential", lambda *_:
                        ("client-fixture", "secret-fixture", "club-fixture"))
    class Db:
        reservations = 0
        def reserve_provider_request(self, _pc):
            self.reservations += 1
            return 0
        trusted = no_io
    db = Db()
    with pytest.raises(DomainError) as denied:
        v1_workers._sync_playtomic(db, job(), sessions=sessions)
    assert denied.value.code == "PROVIDER_SCOPE"
    assert db.reservations == 1
    assert calls == [("GET", "/api/v1/bookings")]
    assert sessions.size() == 0
    assert old.token is None and old.expires == 0
