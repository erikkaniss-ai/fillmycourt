import pytest

from fmc.offer_proof_shadow import assess_offer_evidence, assessment_event_key


@pytest.mark.parametrize("status,source,offers,history,recon,expected", [
    ("confirmed","getacourt",["A"],0,None,"OBSERVED_ONLY"),
    ("confirmed","fmc",["B","A"],0,None,"COMPETING_OFFERS"),
    ("confirmed","getacourt",[],1,None,"STALE_LINK"),
    ("confirmed","getacourt",[],0,None,"NO_ASSOCIATION"),
    ("cancelled","getacourt",["A"],0,None,"BOOKING_NOT_ACTIVE"),
    ("failed","fmc",["A"],0,None,"BOOKING_NOT_ACTIVE"),
    ("held","getacourt",["A"],0,None,"BOOKING_UNCONFIRMED"),
    ("confirmed","playtomic",["A"],0,None,"PROVIDER_NOT_AUTHORITATIVE"),
    ("confirmed","getacourt",["A"],0,"disputed","SOURCE_CONFLICT"),
])
def test_shadow_attribution_never_claims_causal_credit(status,source,offers,history,recon,expected):
    proof=assess_offer_evidence(booking_status=status,booking_source=source,
                               current_candidate_ids=offers,
                               historical_link_count=history,
                               reconciliation_maturity=recon)
    assert proof.outcome==expected
    assert proof.primary_offer_id is None
    assert not proof.causal_evidence_verified and not proof.billable
    assert proof.fee_minor==0
    assert proof.candidate_offer_ids==tuple(sorted(set(offers)))


def test_event_keys_are_replay_safe_and_order_independent():
    args=dict(organization_id="org",booking_id="booking",snapshot_key="A",
              reconciliation_event_key=None,outcome="COMPETING_OFFERS")
    a=assessment_event_key(**args,candidate_offer_ids=("offer-1","offer-2"))
    assert a==assessment_event_key(**args,candidate_offer_ids=("offer-2","offer-1"))
    assert a!=assessment_event_key(**args,candidate_offer_ids=("offer-1",))
    assert a!=assessment_event_key(**{**args,"snapshot_key":"B"},
                                   candidate_offer_ids=("offer-1","offer-2"))
    assert a!=assessment_event_key(**{**args,"reconciliation_event_key":"R"},
                                   candidate_offer_ids=("offer-1","offer-2"))
