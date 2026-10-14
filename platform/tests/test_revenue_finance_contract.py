import pytest
from fmc.revenue_finance import choose_primary_attribution, attribution_maturity, dispute_policy


def candidate(a, evidence, token=False):
    return {"action_id": a, "offer_id": a+"-offer", "exact_slot_match": True,
            "evidence": evidence, "tracking_token_preserved": token}


def test_primary_winner_precedence_and_no_double_bill():
    winner = choose_primary_attribution(True, [
        candidate("A", ["BOOKING_STARTED"]),
        candidate("B", ["READ"]),
        candidate("C", ["CLICKED"], token=True),
    ])
    assert winner["winner"]["action_id"] == "C"
    assert winner["confidence"] == "direct"
    assert winner["billable"] is False
    assert [x["action_id"] for x in winner["assisted"]] == ["A", "B"]


def test_tie_is_ambiguous_and_read_does_not_claim_revenue():
    tie = choose_primary_attribution(True, [
        candidate("A", ["BOOKING_STARTED"]),candidate("B", ["BOOKING_STARTED"]),
    ])
    assert tie["winner"] is None and tie["confidence"] == "ambiguous"
    weak = choose_primary_attribution(True, [candidate("C", ["READ"])])
    assert weak["winner"] is None and weak["confidence"] == "weak_modelled"
    unconfirmed = choose_primary_attribution(False, [candidate("D", ["TRACKED_BOOKING"])])
    assert unconfirmed["winner"] is None and unconfirmed["billable"] is False


def test_maturity_requires_provider_evidence_and_never_finalizes_timeout():
    args=dict(confirmed_booking=True,authority="provider",provider_verified=False,
              reconciled=False,grace_elapsed=True)
    assert attribution_maturity(**args) == "pending_evidence"
    assert attribution_maturity(**args,sla_expired=True) == "unverified"
    assert attribution_maturity(**{**args,"provider_verified":True,"reconciled":True}) == "finalized"
    assert attribution_maturity(**{**args,"provider_verified":True,"reconciled":True},cancelled=True) == "unverified"
    assert attribution_maturity(**args,conflicting_evidence=True) == "disputed"
    assert attribution_maturity(confirmed_booking=True,authority="native",
                                provider_verified=False,reconciled=False,grace_elapsed=False) == "provisional"


def test_dispute_sla_authority_and_four_eyes():
    assert dispute_policy("medium")["target_hours"] == 48
    assert dispute_policy("high","alice","bob")["target_hours"] == 24
    assert dispute_policy("low")["auto_billable_on_timeout"] is False
    with pytest.raises(ValueError,match="Four-eyes"):
        dispute_policy("high","alice","alice")
