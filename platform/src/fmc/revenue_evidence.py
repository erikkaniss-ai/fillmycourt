"""FMC shadow-only authoritative booking evidence and dispute review.

Core snapshots prove the observed booking row, NEVER causal CRM messaging.
No provider webhook ingress, external transport, payment, or automatic billing.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from .common import DomainError
from .supabase_v1 import one, rows
from .revenue_finance import dispute_policy

FINANCE = {"owner", "admin", "manager", "analyst"}
MANAGER = {"owner", "admin", "manager"}
ADMIN = {"owner", "admin"}
NATIVE_SOURCES = {"fmc", "getacourt"}


def verify_provider_signature(payload: bytes, supplied_hex: str, shared_secret: str) -> bool:
    """Provider adapter primitive only. No live ingress is registered."""
    if not shared_secret or not isinstance(supplied_hex, str) or len(supplied_hex) != 64:
        return False
    try:
        bytes.fromhex(supplied_hex)
    except ValueError:
        return False
    expected = hmac.new(shared_secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, supplied_hex.lower())


def core_snapshot_key(booking: dict) -> str:
    """Stable across repeated evaluations, changes when authority version changes."""
    identity = "|".join([str(booking["id"]), str(booking["status"]),
                         booking["updated_at"].isoformat(),
                         str(booking["source"])])
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def core_maturity(status: str, source: str) -> str:
    """A native confirmed booking is provisional, never finalized by itself."""
    if status in ("cancelled", "failed"):
        return "unverified"
    if status == "confirmed" and source in NATIVE_SOURCES:
        return "provisional"
    return "pending_evidence"


class BookingEvidenceIn(BaseModel):
    booking_id: uuid.UUID


class CreateDisputeIn(BaseModel):
    attribution_id: uuid.UUID | None = None
    reconciliation_item_id: uuid.UUID | None = None
    risk: str = Field(pattern="^(low|medium|high)$")
    reason: str = Field(min_length=5, max_length=500)


class ProposeResolutionIn(BaseModel):
    code: str = Field(pattern="^(evidence_pending|no_financial_action|provider_review_required|dismiss_duplicate)$")
    note: str = Field(min_length=10, max_length=1500)


class ResolutionNoteIn(BaseModel):
    note: str = Field(min_length=10, max_length=1500)


def register_shadow_evidence(app, db, who, role, audit, settings):
    def staging_only():
        if settings.environment not in ("test", "staging"):
            raise DomainError("SHADOW_ONLY", "Evidence write workflows are staging-only.", 403)

    def append_decision(c, org, item, actor, transition, before, after, reason):
        c.execute(text("""
            insert into public.crm_dispute_decisions
             (organization_id,case_id,actor_id,event_key,transition,before_state,after_state,evidence)
            values (cast(:org as uuid),cast(:case as uuid),cast(:actor as uuid),
                    :key,:transition,:before,:after,cast(:evidence as jsonb))
        """), {"org": org,"case": item["id"],"actor": actor.id,
               "key": f"{item['id']}:{transition}:{uuid.uuid4().hex}",
               "transition": transition,"before": before,"after": after,
               "evidence": json.dumps({"reason": reason, "money_movement": False})})

    @app.post("/api/fmc/{org}/attributions/evaluate-shadow")
    def evaluate_booking_snapshot(org: str, body: BookingEvidenceIn, request: Request):
        staging_only()
        actor = who(request)
        with db.user(actor.id) as c:
            role(c, org, actor, MANAGER)
        with db.trusted() as c:
            db.require_role(c, org, actor.id, MANAGER)
            booking = one(c.execute(text("""
                select id::text,organization_id::text,status::text,source,
                       court_id::text,starts_at,ends_at,updated_at,
                       gross_amount_minor,currency::text
                from public.bookings
                where id=cast(:booking as uuid) and organization_id=cast(:org as uuid)
                for update
            """), {"org": org,"booking": str(body.booking_id)}))
            if not booking:
                raise DomainError("BOOKING_NOT_FOUND", "Booking not found in this organization.", 404)
            source = booking["source"]
            status = booking["status"]
            authority = "core_native" if source in NATIVE_SOURCES else "provider_unverified"
            maturity = core_maturity(status, source)
            # Immutable evidence is about the BOOKING ROW, never about delivery or attribution.
            ev = {"booking_status": status, "booking_source": source,
                  "authority": authority, "causal_evidence_verified": False,
                  "external_provider_confirmed": False,
                  "null_adapter_is_evidence": False, "record_version": booking["updated_at"].isoformat()}
            key = core_snapshot_key(booking)
            inserted = one(c.execute(text("""
                insert into public.crm_booking_evidence
                   (organization_id,booking_id,event_key,source_kind,booking_status,
                    booking_source,authoritative_updated_at,evidence)
                values (cast(:org as uuid),cast(:booking as uuid),:key,'core_snapshot',
                        :status,:source,:version,cast(:evidence as jsonb))
                on conflict(event_key) do nothing returning id::text
            """), {"org": org,"booking": booking["id"],"key": key,
                   "status": status,"source": source,"version": booking["updated_at"],
                   "evidence": json.dumps(ev)}))
            previous = one(c.execute(text("""
                select id::text,maturity,confidence,primary_offer_id::text
                from public.crm_attribution_records
                where organization_id=cast(:org as uuid) and booking_id=cast(:booking as uuid)
                for update
            """), {"org": org,"booking": booking["id"]}))
            if previous and previous["maturity"] in ("finalized","adjusted","disputed"):
                return {"booking_id":booking["id"],"record_id":previous["id"],
                        "maturity":previous["maturity"],"review_required":True,
                        "new_evidence":bool(inserted),"billable":False}
            record = one(c.execute(text("""
                insert into public.crm_attribution_records
                 (organization_id,booking_id,confidence,maturity,authority_source,
                  evidence_snapshot,gross_attributed_minor,fee_minor,billable,policy_version)
                values(cast(:org as uuid),cast(:booking as uuid),'ambiguous',:maturity,
                       :authority,cast(:evidence as jsonb),0,0,false,'core_snapshot_shadow_v1')
                on conflict(organization_id,booking_id) do update
                  set maturity=excluded.maturity,authority_source=excluded.authority_source,
                      evidence_snapshot=excluded.evidence_snapshot,
                      confidence='ambiguous',primary_action_id=null,primary_offer_id=null,
                      assisted_actions='[]'::jsonb,gross_attributed_minor=0,
                      fee_minor=0,billable=false,updated_at=now()
                returning id::text,maturity,confidence,billable,fee_minor
            """), {"org":org,"booking":booking["id"],"maturity":maturity,
                   "authority":authority,"evidence":json.dumps(ev)}))
            if inserted:
                audit(c, request, org, actor, "attribution.core_evidence_observed",
                      "booking", booking["id"],after={"event_key":key,
                      "maturity":record["maturity"],"causal_attribution":False})
            return {"booking_id":booking["id"],"record_id":record["id"],
                    "maturity":record["maturity"],"confidence":record["confidence"],
                    "new_evidence":bool(inserted),"review_required":False,
                    "primary_winner":None,"fee_minor":0,"billable":False,
                    "provider_confirmed":False,"customer_messages_sent":0}

    @app.get("/api/fmc/{org}/bookings/{booking_id}/evidence")
    def list_booking_evidence(org: str, booking_id: uuid.UUID, request: Request):
        actor = who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,FINANCE)
            out = rows(c.execute(text("""
                select id::text,event_key,source_kind,booking_status,booking_source,
                       authoritative_updated_at,observed_at,evidence
                from public.crm_booking_evidence
                where organization_id=cast(:org as uuid) and booking_id=cast(:booking as uuid)
                order by observed_at,id
            """), {"org":org,"booking":str(booking_id)}))
            return {"booking_id":str(booking_id),"items":out,"mode":"shadow"}

    @app.post("/api/fmc/{org}/disputes/shadow",status_code=201)
    def create_shadow_dispute(org: str, body: CreateDisputeIn, request: Request):
        staging_only()
        actor = who(request)
        if (body.attribution_id is None)==(body.reconciliation_item_id is None):
            raise DomainError("DISPUTE_SOURCE","Supply exactly one attribution or reconciliation item.",422)
        with db.user(actor.id) as c:
            role(c,org,actor,MANAGER)
        with db.trusted() as c:
            db.require_role(c,org,actor.id,MANAGER)
            if body.attribution_id:
                exists = c.execute(text("""
                    select 1 from public.crm_attribution_records
                    where id=cast(:ref as uuid) and organization_id=cast(:org as uuid)
                """),{"ref":str(body.attribution_id),"org":org}).scalar_one_or_none()
            else:
                exists = c.execute(text("""
                    select 1 from public.reconciliation_items
                    where id=cast(:ref as uuid) and organization_id=cast(:org as uuid)
                """),{"ref":str(body.reconciliation_item_id),"org":org}).scalar_one_or_none()
            if not exists:
                raise DomainError("SOURCE_NOT_FOUND","Dispute source unavailable in this organization.",404)
            policy=dispute_policy(body.risk)
            due=datetime.now(timezone.utc)+timedelta(hours=policy["target_hours"])
            item=one(c.execute(text("""
                insert into public.crm_dispute_cases
                (organization_id,attribution_id,reconciliation_item_id,risk,status,
                 reason,amount_at_risk_minor,initiated_by,policy_version,sla_due_at)
                values(cast(:org as uuid),cast(:attr as uuid),cast(:recon as uuid),:risk,'open',
                       :reason,0,cast(:actor as uuid),'disputes_shadow_v1',:due)
                returning id::text,risk,status,sla_due_at
            """),{"org":org,"attr":str(body.attribution_id) if body.attribution_id else None,
                  "recon":str(body.reconciliation_item_id) if body.reconciliation_item_id else None,
                  "risk":body.risk,"reason":body.reason,"actor":actor.id,"due":due}))
            audit(c,request,org,actor,"dispute.shadow_opened","crm_dispute",item["id"],
                  after={"risk":item["risk"],"billable":False})
            return {"case":item,"mode":"shadow","financial_execution":False}

    @app.post("/api/fmc/{org}/disputes/{case_id}/propose")
    def propose_dispute(org: str,case_id:uuid.UUID,body:ProposeResolutionIn,request:Request):
        staging_only()
        actor=who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,MANAGER)
        with db.trusted() as c:
            db.require_role(c,org,actor.id,MANAGER)
            item=one(c.execute(text("""
                select id::text,status,risk,initiated_by::text
                from public.crm_dispute_cases
                where id=cast(:case as uuid) and organization_id=cast(:org as uuid)
                for update
            """),{"org":org,"case":str(case_id)}))
            if not item:
                raise DomainError("CASE_NOT_FOUND","Dispute not found.",404)
            if item["status"] not in ("open","pending_evidence"):
                raise DomainError("CASE_STATE","Dispute not open for proposal.",409)
            c.execute(text("""
                update public.crm_dispute_cases
                set status='review',initiated_by=cast(:actor as uuid),
                    resolution=cast(:resolution as jsonb)
                where id=cast(:case as uuid)
            """),{"actor":actor.id,"case":str(case_id),
                  "resolution":json.dumps({"code":body.code,"note":body.note,"financial_action":False})})
            append_decision(c,org,item,actor,"PROPOSED",item["status"],"review",body.code)
            audit(c,request,org,actor,"dispute.shadow_proposed","crm_dispute",str(case_id),
                  after={"state":"review","financial_execution":False})
            return {"id":str(case_id),"status":"review","financial_execution":False}

    @app.post("/api/fmc/{org}/disputes/{case_id}/approve")
    def approve_dispute(org: str,case_id:uuid.UUID,body:ResolutionNoteIn,request:Request):
        staging_only()
        actor=who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,MANAGER)
        with db.trusted() as c:
            actor_role=db.require_role(c,org,actor.id,MANAGER)
            item=one(c.execute(text("""
                select id::text,status,risk,initiated_by::text
                from public.crm_dispute_cases
                where id=cast(:case as uuid) and organization_id=cast(:org as uuid)
                for update
            """),{"org":org,"case":str(case_id)}))
            if not item:
                raise DomainError("CASE_NOT_FOUND","Dispute not found.",404)
            if item["status"]!="review":
                raise DomainError("CASE_STATE","Review has not been proposed.",409)
            if item["initiated_by"] == actor.id:
                raise DomainError("FOUR_EYES","A different approver must authorize resolution.",409)
            if item["risk"]=="high" and actor_role not in ADMIN:
                raise DomainError("APPROVAL_ROLE","High-risk dispute needs owner/admin.",403)
            c.execute(text("""
                update public.crm_dispute_cases
                set status='approved',approved_by=cast(:actor as uuid)
                where id=cast(:case as uuid)
            """),{"actor":actor.id,"case":str(case_id)})
            append_decision(c,org,item,actor,"APPROVED","review","approved",body.note)
            audit(c,request,org,actor,"dispute.shadow_approved","crm_dispute",str(case_id),
                  after={"financial_execution":False})
            return {"id":str(case_id),"status":"approved","financial_execution":False}

    @app.post("/api/fmc/{org}/disputes/{case_id}/resolve")
    def resolve_dispute(org: str,case_id:uuid.UUID,body:ResolutionNoteIn,request:Request):
        staging_only()
        actor=who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,MANAGER)
        with db.trusted() as c:
            db.require_role(c,org,actor.id,MANAGER)
            item=one(c.execute(text("""
                select id::text,status,approved_by::text
                from public.crm_dispute_cases
                where id=cast(:case as uuid) and organization_id=cast(:org as uuid)
                for update
            """),{"org":org,"case":str(case_id)}))
            if not item:
                raise DomainError("CASE_NOT_FOUND","Dispute not found.",404)
            if item["status"]!="approved":
                raise DomainError("CASE_STATE","Approval required before resolution.",409)
            c.execute(text("""
                update public.crm_dispute_cases set status='resolved',resolved_at=now(),
                    resolution=resolution||cast(:note as jsonb)
                where id=cast(:case as uuid)
            """),{"case":str(case_id),"note":json.dumps({"resolution_note":body.note,"financial_action":False})})
            append_decision(c,org,item,actor,"RESOLVED","approved","resolved",body.note)
            audit(c,request,org,actor,"dispute.shadow_resolved","crm_dispute",str(case_id),
                  after={"financial_execution":False,"commission_changed":False})
            return {"id":str(case_id),"status":"resolved","financial_execution":False}

    @app.get("/api/fmc/{org}/disputes/{case_id}/decisions")
    def list_dispute_decisions(org:str,case_id:uuid.UUID,request:Request):
        actor=who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,FINANCE)
            items=rows(c.execute(text("""
                select id::text,actor_id::text,transition,before_state,after_state,evidence,occurred_at
                from public.crm_dispute_decisions
                where organization_id=cast(:org as uuid) and case_id=cast(:case as uuid)
                order by ingest_seq
            """),{"org":org,"case":str(case_id)}))
            return {"items":items,"mode":"shadow"}
