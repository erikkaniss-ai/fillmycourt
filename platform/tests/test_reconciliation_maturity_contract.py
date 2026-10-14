import pytest

from fmc.reconciliation_maturity import (
    reconcile_shadow, shadow_reconciliation_key,
)


@pytest.mark.parametrize("status,source,provider,expected,reason", [
    ("confirmed","getacourt",None,"provisional","core_booking_only_no_causal_proof"),
    ("confirmed","fmc",None,"provisional","core_booking_only_no_causal_proof"),
    ("confirmed","playtomic","confirmed","pending_evidence","non_native_or_incomplete_authority"),
    ("confirmed","playtomic",None,"pending_evidence","non_native_or_incomplete_authority"),
    ("cancelled","getacourt",None,"unverified","core_booking_not_active"),
    ("failed","fmc",None,"unverified","core_booking_not_active"),
    ("confirmed","playtomic","refunded","disputed","refund_claim_requires_independent_evidence"),
    ("cancelled","playtomic","refunded","disputed","refund_claim_requires_independent_evidence"),
    ("confirmed","playtomic","cancelled","disputed","provider_core_state_conflict"),
    ("cancelled","playtomic","confirmed","disputed","provider_core_state_conflict"),
    ("held","playtomic","pending","pending_evidence","non_native_or_incomplete_authority"),
])
def test_reconciliation_authority(status,source,provider,expected,reason):
    x=reconcile_shadow(status,source,provider)
    assert x.maturity==expected and x.reason==reason
    assert x.billable is False and x.fee_minor==0 and x.causal_evidence_verified is False


def test_dispute_is_sticky_and_unknown_sources_fail_closed():
    x=reconcile_shadow("confirmed","getacourt",None,"disputed")
    assert x.maturity=="disputed" and x.review_required
    assert reconcile_shadow("unknown","getacourt").maturity=="pending_evidence"
    assert reconcile_shadow("confirmed","playtomic","unknown").maturity=="disputed"


def test_idempotent_source_version_key():
    a=shadow_reconciliation_key("org","booking","core-v1",None)
    assert a==shadow_reconciliation_key("org","booking","core-v1",None)
    assert a!=shadow_reconciliation_key("org","booking","core-v2",None)
    assert a!=shadow_reconciliation_key("org","booking","core-v1","provider-v1")
