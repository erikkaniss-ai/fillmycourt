"""Local-only PKCE/state lifecycle simulation; never activates a provider grant."""
from __future__ import annotations
import pytest

from fmc.player_delegation_dryrun import (
    PlayerDelegationDryRun, DryRunDenied, DRY_RUN_CALLBACK
)

NOW=1792501200  # fixed synthetic timestamp, not wall clock
def start(lab, *, provider="playtomic", subject="player-fixture-01",
          consent="consent-fixture-01", now=NOW, scope="availability.read"):
    return lab.start(
        provider=provider, subject_ref=subject, consent_ref=consent,
        scope=scope, consented=True, now=now,
        callback=DRY_RUN_CALLBACK
    )

@pytest.mark.parametrize("provider", ["playtomic","tiesports"])
def test_synthetic_pkce_prepare_without_provider_redirect_or_credentials(provider):
    lab=PlayerDelegationDryRun()
    receipt=start(lab,provider=provider)
    assert receipt["mode"]=="synthetic_only"
    assert receipt["provider"]==provider
    assert receipt["status"]=="provider_grant_not_verified"
    assert receipt["scope"]=="availability.read"
    assert len(receipt["state"])>=32
    assert len(receipt["challenge"])==43
    assert receipt["challenge_method"]=="S256"
    assert receipt["callback"]==DRY_RUN_CALLBACK
    assert receipt["authorize_url"] is None
    assert receipt["provider_authorized"] is False
    assert receipt["can_read_availability"] is False
    assert receipt["can_write_booking"] is False
    assert "verifier" not in receipt
    assert lab.active_count()==1
    assert "verifier" not in repr(lab.public_status())

@pytest.mark.parametrize("wrong", [
    {"state":"invalid"}, {"provider":"tiesports"},
    {"subject_ref":"player-fixture-02"}, {"consent_ref":"consent-fixture-02"}
])
def test_callback_binding_must_match_and_wrong_attempt_cannot_grant(wrong):
    lab=PlayerDelegationDryRun()
    prepared=start(lab)
    args=dict(state=prepared["state"],provider="playtomic",
              subject_ref="player-fixture-01",consent_ref="consent-fixture-01",now=NOW+30)
    args.update(wrong)
    with pytest.raises(DryRunDenied):
        lab.consume(**args)
    assert lab.active_count()==1
    result=lab.consume(state=prepared["state"],provider="playtomic",
        subject_ref="player-fixture-01",consent_ref="consent-fixture-01",now=NOW+31)
    assert result["provider_authorized"] is False
    assert result["status"]=="blocked"
    assert result["reason"]=="OFFICIAL_PROVIDER_GRANT_REQUIRED"
    assert result["token_exchanged"] is False
    assert result["real_callback_processed"] is False
    assert result["provider_data_read"] is False
    assert lab.active_count()==0
    with pytest.raises(DryRunDenied):
        lab.consume(**args|{"state":prepared["state"],"provider":"playtomic",
                            "subject_ref":"player-fixture-01","consent_ref":"consent-fixture-01"})

def test_expiry_cancel_replay_and_limits():
    lab=PlayerDelegationDryRun()
    first=start(lab)
    with pytest.raises(DryRunDenied,match="expired"):
        lab.consume(state=first["state"],provider="playtomic",
                    subject_ref="player-fixture-01",consent_ref="consent-fixture-01",now=NOW+301)
    assert lab.active_count()==0
    second=start(lab,now=NOW+500)
    assert lab.cancel(state=second["state"],subject_ref="player-fixture-01",now=NOW+510)
    with pytest.raises(DryRunDenied):
        lab.consume(state=second["state"],provider="playtomic",
            subject_ref="player-fixture-01",consent_ref="consent-fixture-01",now=NOW+520)
    assert lab.active_count()==0

@pytest.mark.parametrize("override",[
    {"provider":"unknown"},
    {"scope":"booking.write"},
    {"consented":False},
    {"callback":"https://playtomic.com/redirect"},
    {"callback":"http://getacourt.example.invalid/provider-callback"},
    {"subject_ref":"player@example.test"},
    {"consent_ref":"https://provider.test"},
    {"now":-1},
])
def test_preflight_invalid_intent_never_issues_transaction(override):
    lab=PlayerDelegationDryRun()
    data=dict(provider="playtomic",subject_ref="player-fixture-01",
              consent_ref="consent-fixture-01",scope="availability.read",
              consented=True,now=NOW,callback=DRY_RUN_CALLBACK)
    data.update(override)
    with pytest.raises((ValueError,DryRunDenied)):
        lab.start(**data)
    assert lab.active_count()==0

def test_owner_test_lab_does_not_accept_codes_sessions_or_tokens():
    lab=PlayerDelegationDryRun()
    issued=start(lab)
    with pytest.raises(TypeError):
        lab.consume(state=issued["state"],provider="playtomic",
                    subject_ref="player-fixture-01",consent_ref="consent-fixture-01",
                    now=NOW+10,code="provider-authorization-code")
    assert lab.active_count()==1
    with pytest.raises(TypeError):
        lab.start(provider="playtomic",subject_ref="player-fixture-01",
                  consent_ref="consent-fixture-01",scope="availability.read",
                  consented=True,now=NOW,callback=DRY_RUN_CALLBACK,
                  access_token="never")
    assert lab.active_count()==1


def test_callback_and_cancellation_cannot_predate_issuance():
    lab=PlayerDelegationDryRun()
    receipt=start(lab)
    with pytest.raises(DryRunDenied,match="chronology"):
        lab.consume(state=receipt["state"],provider="playtomic",
            subject_ref="player-fixture-01",consent_ref="consent-fixture-01",now=NOW-1)
    with pytest.raises(DryRunDenied,match="chronology"):
        lab.cancel(state=receipt["state"],subject_ref="player-fixture-01",now=NOW-1)
    assert lab.active_count()==1
    correct=lab.consume(state=receipt["state"],provider="playtomic",
        subject_ref="player-fixture-01",consent_ref="consent-fixture-01",now=NOW+2)
    assert correct["status"]=="blocked"
    assert lab.active_count()==0


def test_callback_single_use_is_thread_safe_under_replay_race():
    from concurrent.futures import ThreadPoolExecutor
    lab=PlayerDelegationDryRun()
    receipt=start(lab)
    def race(_):
        try:
            return lab.consume(state=receipt["state"],provider="playtomic",
                subject_ref="player-fixture-01",consent_ref="consent-fixture-01",now=NOW+4)["status"]
        except DryRunDenied:
            return "rejected"
    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes=list(pool.map(race,range(8)))
    assert outcomes.count("blocked")==1
    assert outcomes.count("rejected")==7
    assert lab.active_count()==0


def test_status_never_leaks_state_nonce_verifier_or_subject():
    lab=PlayerDelegationDryRun()
    receipt=start(lab)
    status=lab.public_status()
    assert status=={"mode":"synthetic_only","active_pending":1,
                    "provider_authorized":False,"external_connections":0}
    serialized=repr(status)
    for forbidden in [receipt["state"], receipt["challenge"],
                      "player-fixture-01","consent-fixture-01"]:
        assert forbidden not in serialized
