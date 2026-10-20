"""Synthetic player provider account consent is NOT official API authority."""
import pytest

from fmc.player_link_contract import (
    PlayerProviderBoundary, OfficialProviderGrantRequired
)

@pytest.mark.parametrize("provider", ["playtomic","tiesports"])
def test_owner_consent_does_not_activate_external_player_account(provider):
    boundary=PlayerProviderBoundary(provider)
    plan=boundary.create_intent(
        participant_ref="player-fixture-1",
        consent_ref="proof-fixture-1",
        consent_recorded_at="2026-10-20T14:50:00Z",
        owner_consented=True
    )
    assert plan.provider==provider
    assert plan.account_owner_consented is True
    assert plan.provider_authorized is False
    assert plan.remote_session_established is False
    assert plan.status=="awaiting_official_player_delegation"
    cap=boundary.capabilities(plan)
    assert cap["owner_consent_recorded"] is True
    assert cap["reason"]=="PROVIDER_PLAYER_DELEGATION_UNVERIFIED"
    assert cap["provider_authorized"] is False
    assert cap["can_begin_oauth"] is False
    assert cap["can_read_availability"] is False
    assert cap["can_read_private_session"] is False
    assert cap["can_write_booking"] is False
    assert cap["provider_account_data"] is None
    for operation in (
        boundary.begin_oauth,
        boundary.read_availability,
        boundary.open_player_session,
        boundary.write_booking
    ):
        with pytest.raises(OfficialProviderGrantRequired):
            operation("malicious-test-credential", access_token="fake", password="fake")

def test_player_intent_requires_opaque_ids_and_utc_consent_evidence():
    boundary=PlayerProviderBoundary("playtomic")
    base={
        "participant_ref":"player-fixture-1",
        "consent_ref":"proof-fixture-1",
        "consent_recorded_at":"2026-10-20T14:50:00Z",
        "owner_consented":True
    }
    with pytest.raises(ValueError,match="Explicit"):
        boundary.create_intent(**{**base,"owner_consented":False})
    for bad in ["owner@example.test","https://playtomic.com/",""]:
        with pytest.raises(ValueError,match="Opaque"):
            boundary.create_intent(**{**base,"participant_ref":bad})
    for bad in ["2026-10-20T14:50:00","2026-10-20T15:50:00+01:00","not-a-date"]:
        with pytest.raises(ValueError,match="UTC"):
            boundary.create_intent(**{**base,"consent_recorded_at":bad})
    with pytest.raises(ValueError,match="Unknown"):
        PlayerProviderBoundary("private-provider")

def test_player_intent_has_no_token_or_live_oauth_method():
    b=PlayerProviderBoundary("tiesports")
    p=b.create_intent(participant_ref="player-fixture-1",consent_ref="proof-fixture-1",
        consent_recorded_at="2026-10-20T14:50:00Z",owner_consented=True)
    assert "token" not in repr(p).lower()
    assert "password" not in repr(p).lower()
    assert not hasattr(b,"provider_fetch")
    assert not hasattr(b,"token_store")
