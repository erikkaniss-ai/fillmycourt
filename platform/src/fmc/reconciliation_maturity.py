"""FMC-REV-F07: deterministic shadow reconciliation of authoritative Core facts.

Offline-signed provider fixtures are allegations, not independent booked/paid proof.
No award of attribution, no fee recognition, no refund or settlement execution.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class ShadowResolution:
    maturity: str
    source_resolution: str
    reason: str
    review_required: bool
    fee_minor: int = 0
    billable: bool = False
    causal_evidence_verified: bool = False


def reconcile_shadow(core_status: str, core_source: str,
                     provider_claim: str | None = None,
                     previous_maturity: str | None = None) -> ShadowResolution:
    """Core always wins booking status. Provider fixture cannot verify revenue.

    A contradictory fixture or any refund claim is disputed, never a payment
    fact. A disputed record stays disputed until separately adjudicated.
    """
    if core_status not in {"held", "confirmed", "cancelled", "failed"}:
        return ShadowResolution("pending_evidence", "provider_unverified",
                                "unknown_core_status", True)
    if previous_maturity == "disputed":
        return ShadowResolution("disputed", "provider_conflict",
                                "existing_dispute_requires_review", True)
    if provider_claim is not None and provider_claim not in {
        "pending", "confirmed", "cancelled", "refunded", "failed"
    }:
        return ShadowResolution("disputed", "provider_conflict",
                                "unsupported_provider_claim", True)
    if provider_claim == "refunded":
        return ShadowResolution("disputed", "provider_conflict",
                                "refund_claim_requires_independent_evidence", True)
    if (provider_claim == "confirmed" and core_status in {"cancelled", "failed"}) or (
        provider_claim in {"cancelled", "failed"} and core_status == "confirmed"
    ):
        return ShadowResolution("disputed", "provider_conflict",
                                "provider_core_state_conflict", True)
    if core_status in {"cancelled", "failed"}:
        return ShadowResolution("unverified", "core_native" if core_source in {
            "fmc", "getacourt"} else "provider_unverified",
                                "core_booking_not_active", False)
    if core_status == "confirmed" and core_source in {"fmc", "getacourt"}:
        return ShadowResolution("provisional", "core_native",
                                "core_booking_only_no_causal_proof", False)
    return ShadowResolution("pending_evidence", "provider_unverified",
                            "non_native_or_incomplete_authority", True)


def shadow_reconciliation_key(organization_id: str, booking_id: str,
                              snapshot_key: str, provider_event_key: str | None) -> str:
    """Stable on retry, changes only with immutable source evidence version."""
    value = "\x1f".join((organization_id, booking_id, snapshot_key,
                         provider_event_key or "NO_PROVIDER_FIXTURE"))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
