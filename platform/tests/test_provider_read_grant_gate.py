"""Fail closed BEFORE reading Playtomic credentials or calling external APIs."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from copy import deepcopy

import pytest

from fmc.common import DomainError
from fmc.provider_read_gate import require_official_club_read
from fmc import v1_workers

NOW = datetime(2026, 10, 20, 16, 0, tzinfo=timezone.utc)
ORG = "11111111-1111-4111-8111-111111111111"


def grant():
    return {
        "provider": "playtomic",
        "status": "approved",
        "authority": "club_or_certified_partner",
        "organization_id": ORG,
        "tenant_id": "club-fixture-01",
        "agreement_ref": "agreement-fixture-001",
        "owner_approval_ref": "ownerapproval-fixture-001",
        "approved_at": "2026-10-19T11:00:00Z",
        "expires_at": "2026-11-19T11:00:00Z",
        "scopes": ["bookings.read"],
    }


def connection():
    return {
        "provider": "playtomic", "status": "configured",
        "organization_id": ORG,
        "capabilities": {"write_mode": "read_sync", "official_read_authorized": True},
        "config": {"tenant_id": "club-fixture-01", "credential_ref": "PLAYTOMIC_CI",
                   "official_grant": grant()},
    }


def check(c=None, enabled="true", stream="bookings", now=NOW):
    return require_official_club_read(c or connection(), stream,
        env={"FMC_OFFICIAL_PROVIDER_READS_ENABLED": enabled}, now=now)


def test_approved_named_club_read_requires_exact_scope_and_explicit_env_go():
    permit=check()
    assert permit["provider"]=="playtomic"
    assert permit["scope"]=="bookings.read"
    assert permit["organization_id"]==ORG
    assert permit["tenant_id"]=="club-fixture-01"
    assert permit["writes_allowed"] is False
    assert permit["player_oauth_authorized"] is False
    assert permit["availability_feed_authorized"] is False
    assert "secret" not in repr(permit).lower()
    assert "token" not in repr(permit).lower()


@pytest.mark.parametrize("flag", [None, "", "false", "TRUE", "1", "yes"])
def test_missing_or_ambiguous_feature_flag_blocks_before_network(flag):
    c=connection()
    with pytest.raises(DomainError, match="not authorised"):
        require_official_club_read(c, "bookings",
            env={} if flag is None else {"FMC_OFFICIAL_PROVIDER_READS_ENABLED":flag},
            now=NOW)


@pytest.mark.parametrize("change", [
    ("provider", "tiesports"),
    ("status", "revoked"),
    ("organization_id", "22222222-2222-4222-8222-222222222222"),
    ("capabilities", {"write_mode": "read_sync"}),
    ("capabilities", {"write_mode": "native_write", "official_read_authorized":True}),
    ("capabilities", {"write_mode": "read_sync", "official_read_authorized":1}),
    ("config", {"tenant_id":"club-fixture-01","credential_ref":"PLAYTOMIC_CI"}),
])
def test_provider_connection_missing_grant_or_wrong_authority_blocks(change):
    c=connection();c[change[0]]=change[1]
    with pytest.raises(DomainError):
        check(c)


@pytest.mark.parametrize("field,value", [
    ("provider", "tiesports"),
    ("status", "pending"),
    ("authority", "personal_player_account"),
    ("tenant_id", "some-other-club"),
    ("organization_id", "22222222-2222-4222-8222-222222222222"),
    ("agreement_ref", ""),
    ("agreement_ref", "https://example.test"),
    ("owner_approval_ref", "not an opaque reference"),
    ("approved_at", "2026-10-21T12:00:00Z"),
    ("approved_at", "nonsense"),
    ("expires_at", "2026-10-19T00:00:00Z"),
    ("expires_at", "2026-10-25T09:00:00+01:00"),
    ("scopes", ["availability.read"]),
    ("scopes", ["bookings.read", "booking.write"]),
    ("scopes", "bookings.read"),
])
def test_invalid_or_expired_provider_issued_scope_receipt_blocks(field,value):
    c=connection();c["config"]["official_grant"][field]=value
    with pytest.raises(DomainError):
        check(c)


@pytest.mark.parametrize("stream", ["players","payments","availability","bookings.write",""])
def test_players_payments_and_unverified_availability_are_not_implicitly_covered(stream):
    with pytest.raises(DomainError):
        check(stream=stream)


def test_worker_checks_provider_rights_before_client_credentials(monkeypatch):
    c=connection()
    c["config"]["official_grant"]["scopes"]=["availability.read"]
    monkeypatch.setattr(v1_workers, "_connection", lambda _db,_id:c)
    def unexpected(*_args, **_kwargs):
        raise AssertionError("credentials, network and database write must not be reached")
    monkeypatch.setattr(v1_workers, "_credential", unexpected)
    monkeypatch.setattr(v1_workers, "Playtomic", unexpected)
    monkeypatch.delenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED",raising=False)
    with pytest.raises(DomainError):
        v1_workers._sync_playtomic(object(), {
            "payload":{"provider_connection_id":"fake-test-id","stream":"bookings"}
        })


def test_worker_synthetic_connection_is_denied_even_with_enabled_env(monkeypatch):
    c=connection();c["capabilities"]["official_read_authorized"]=False
    monkeypatch.setattr(v1_workers, "_connection", lambda _db,_id:c)
    monkeypatch.setattr(v1_workers, "_credential",lambda *_args: (_ for _ in ()).throw(AssertionError("Credential read")))
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED","true")
    with pytest.raises(DomainError):
        v1_workers._sync_playtomic(object(), {
            "payload":{"provider_connection_id":"fixture-id","stream":"bookings"}
        })
