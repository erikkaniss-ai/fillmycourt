"""FMC Revenue Finance shadow foundation (#88–#95).

Deterministic pure arbitration for tests + read-only operational queues.
Not connected to payment processors, provider writes, or financial settlement.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from fastapi import Request
from sqlalchemy import text
from .common import DomainError
from .supabase_v1 import one, rows

FINANCE_ROLES = {"owner", "admin", "manager", "analyst"}
EVIDENCE_WEIGHT = {
    "TRACKED_BOOKING": 100,
    "BOOKING_STARTED": 90,
    "POSITIVE_BOOKING_INTENT": 75,
    "CLICKED": 55,
    "DELIVERED": 10,
    "READ": 5,
}


def choose_primary_attribution(confirmed_booking: bool, candidates: list[dict]) -> dict:
    """One canonical winner; read/delivery alone never grants billable attribution."""
    if not confirmed_booking:
        return {"winner": None, "assisted": [], "confidence": "none", "billable": False}
    eligible = []
    for candidate in candidates:
        if not candidate.get("exact_slot_match"):
            continue
        evidence = set(candidate.get("evidence") or [])
        score = max((EVIDENCE_WEIGHT.get(k, 0) for k in evidence), default=0)
        # A tracked booking path has the highest evidentiary precedence.
        if candidate.get("tracking_token_preserved"):
            score = 100
        if score:
            eligible.append((score, str(candidate["action_id"]), str(candidate["offer_id"]), candidate))
    eligible.sort(key=lambda x: (-x[0], x[1], x[2]))
    if not eligible:
        return {"winner": None, "assisted": [], "confidence": "ambiguous", "billable": False}
    best = eligible[0]
    # Equally strong evidence from distinct Offers cannot quietly double-bill.
    tied = [x for x in eligible if x[0] == best[0] and (x[1], x[2]) != (best[1], best[2])]
    if tied:
        return {"winner": None, "assisted": [x[3] for x in eligible],
                "confidence": "ambiguous", "billable": False}
    confidence = "direct" if best[0] == 100 else "strong_inferred" if best[0] >= 55 else "weak_modelled"
    return {
        "winner": best[3] if best[0] >= 55 else None,
        "assisted": [x[3] for x in eligible[1:]],
        "confidence": confidence, "billable": False,  # settlement layer not active
    }


def attribution_maturity(*, confirmed_booking: bool, authority: str, provider_verified: bool,
                         reconciled: bool, grace_elapsed: bool, cancelled=False,
                         conflicting_evidence=False, sla_expired=False) -> str:
    if conflicting_evidence:
        return "disputed"
    if cancelled:
        return "unverified"
    evidence_ready = confirmed_booking and (
        authority == "native" or (authority == "provider" and provider_verified and reconciled)
    )
    if not evidence_ready:
        return "unverified" if sla_expired else "pending_evidence"
    return "finalized" if grace_elapsed else "provisional"


def dispute_policy(risk: str, initiator: str | None = None, approver: str | None = None) -> dict:
    risk = risk.lower()
    if risk not in ("low", "medium", "high"):
        raise ValueError("Unsupported risk")
    if risk == "high" and initiator and approver and initiator == approver:
        raise ValueError("Four-eyes approval must involve two separate users")
    target = {"low": 0, "medium": 48, "high": 24}[risk]
    return {"risk": risk, "target_hours": target,
            "approval": "deterministic_only" if risk == "low" else
                        "finance_or_manager" if risk == "medium" else "owner_admin_four_eyes",
            "auto_billable_on_timeout": False}


def register_financial_foundation(app, db, who, role):
    @app.get("/api/fmc/{org}/attributions")
    def list_attributions(org: str, request: Request):
        actor = who(request)
        with db.user(actor.id) as c:
            role(c, org, actor, FINANCE_ROLES)
            ledger = rows(c.execute(text("""
                select id::text,booking_id::text,primary_action_id::text,primary_offer_id::text,
                       confidence,maturity,authority_source,assisted_actions,
                       gross_attributed_minor,fee_minor,billable,policy_version,created_at,finalized_at
                from public.crm_attribution_records where organization_id=cast(:org as uuid)
                order by created_at desc,id limit 200
            """), {"org": org}))
            return {"items": ledger, "mode": "shadow", "billing_enabled": False}

    @app.get("/api/fmc/{org}/attribution-adjustments")
    def list_attribution_adjustments(org: str, request: Request):
        actor = who(request)
        with db.user(actor.id) as c:
            role(c, org, actor, FINANCE_ROLES)
            items = rows(c.execute(text("""
                select id::text,attribution_id::text,kind,delta_minor,evidence,
                       correction_reference,created_at
                from public.crm_attribution_adjustments
                where organization_id=cast(:org as uuid)
                order by created_at desc,id limit 200
            """), {"org": org}))
            return {"items": items, "mode": "shadow", "settlement_enabled": False}

    @app.get("/api/fmc/{org}/disputes")
    def list_disputes(org: str, request: Request):
        actor = who(request)
        with db.user(actor.id) as c:
            role(c, org, actor, FINANCE_ROLES)
            cases = rows(c.execute(text("""
                select id::text,attribution_id::text,reconciliation_item_id::text,
                       risk,status,reason,amount_at_risk_minor,currency,assignee_id::text,
                       policy_version,sla_due_at,created_at,resolved_at
                from public.crm_dispute_cases where organization_id=cast(:org as uuid)
                order by case risk when 'high' then 0 when 'medium' then 1 else 2 end,
                         sla_due_at nulls last,created_at desc limit 200
            """), {"org": org}))
            for item in cases:
                item["sla_overdue"] = (
                    item["sla_due_at"] is not None
                    and item["sla_due_at"] < datetime.now(timezone.utc)
                    and item["status"] not in ("resolved", "unverified")
                )
            return {"items": cases, "mode": "shadow", "auto_resolution": False}
