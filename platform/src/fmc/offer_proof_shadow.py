"""FMC-REV-F09: explainable, non-financial Offer/booking evidence arbitration.

A Core booking is an authoritative booking fact; an Offer association is only a
shadow observation. Neither a matching tracking token nor signed offline fixture
proves delivery, marketing causality, incremental revenue, or earned fees.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class EvidenceAssessment:
    outcome: str
    candidate_offer_ids: tuple[str, ...]
    review_required: bool
    primary_offer_id: None = None
    causal_evidence_verified: bool = False
    billable: bool = False
    fee_minor: int = 0


def assess_offer_evidence(*, booking_status: str, booking_source: str,
                          current_candidate_ids: list[str],
                          historical_link_count: int = 0,
                          reconciliation_maturity: str | None = None
                          ) -> EvidenceAssessment:
    """Fail closed; candidates are offer IDs, never recipient/player identities."""
    candidates = tuple(sorted(set(current_candidate_ids)))
    if booking_status in ("cancelled", "failed"):
        outcome = "BOOKING_NOT_ACTIVE"
    elif booking_status != "confirmed":
        outcome = "BOOKING_UNCONFIRMED"
    elif reconciliation_maturity == "disputed":
        outcome = "SOURCE_CONFLICT"
    elif booking_source not in ("fmc", "getacourt"):
        outcome = "PROVIDER_NOT_AUTHORITATIVE"
    elif len(candidates) > 1:
        outcome = "COMPETING_OFFERS"
    elif len(candidates) == 1:
        outcome = "OBSERVED_ONLY"
    elif historical_link_count:
        outcome = "STALE_LINK"
    else:
        outcome = "NO_ASSOCIATION"
    return EvidenceAssessment(outcome=outcome,candidate_offer_ids=candidates,
                              review_required=outcome != "NO_ASSOCIATION")


def assessment_event_key(*, organization_id: str, booking_id: str,
                         snapshot_key: str, candidate_offer_ids: tuple[str, ...],
                         reconciliation_event_key: str | None,
                         outcome: str) -> str:
    payload={
        "policy":"offer_proof_shadow_v1",
        "org":organization_id,"booking":booking_id,"snapshot":snapshot_key,
        "candidates":list(sorted(set(candidate_offer_ids))),
        "reconciliation":reconciliation_event_key,
        "outcome":outcome,
    }
    return hashlib.sha256(json.dumps(payload,sort_keys=True,
                                      separators=(",",":")).encode()).hexdigest()
