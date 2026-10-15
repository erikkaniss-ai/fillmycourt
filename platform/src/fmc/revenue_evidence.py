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
from .offline_evidence import EvidenceRejected, build_shadow_offer_link
from .reconciliation_maturity import reconcile_shadow, shadow_reconciliation_key
from .offer_proof_shadow import assess_offer_evidence, assessment_event_key
from .core_pathway_fixture import pathway_readiness

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


class OfferLinkIn(BaseModel):
    booking_id: uuid.UUID
    offer_id: uuid.UUID
    tracking_token: str = Field(min_length=8, max_length=180)


class ShadowAdjustmentIn(BaseModel):
    observation_id: uuid.UUID
    kind: str = Field(pattern="^(cancellation|provider_correction)$")


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


def next_sla_owner_role(risk: str) -> str:
    return {"low": "finance", "medium": "owner", "high": "owner_admin"}[risk]


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
            # Unique active source indexes enforce this in concurrent requests as well.
            params = {
                "org": org,
                "attr": str(body.attribution_id) if body.attribution_id else None,
                "recon": str(body.reconciliation_item_id) if body.reconciliation_item_id else None,
            }
            existing = one(c.execute(text("""
                select id::text,risk,status,sla_due_at from public.crm_dispute_cases
                where organization_id=cast(:org as uuid)
                  and status in ('open','pending_evidence','review','approved')
                  and ((cast(:attr as uuid) is not null
                         and attribution_id=cast(:attr as uuid))
                    or (cast(:recon as uuid) is not null
                         and reconciliation_item_id=cast(:recon as uuid)))
                limit 1 for update
            """), params))
            if existing:
                return {"case": existing, "mode": "shadow",
                        "reused": True, "financial_execution": False}
            policy=dispute_policy(body.risk)
            due=datetime.now(timezone.utc)+timedelta(hours=policy["target_hours"])
            item=one(c.execute(text("""
                insert into public.crm_dispute_cases
                (organization_id,attribution_id,reconciliation_item_id,risk,status,
                 reason,amount_at_risk_minor,initiated_by,policy_version,sla_due_at)
                values(cast(:org as uuid),cast(:attr as uuid),cast(:recon as uuid),:risk,'open',
                       :reason,0,cast(:actor as uuid),'disputes_shadow_v1',:due)
                on conflict do nothing
                returning id::text,risk,status,sla_due_at
            """),{"org":org,"attr":str(body.attribution_id) if body.attribution_id else None,
                  "recon":str(body.reconciliation_item_id) if body.reconciliation_item_id else None,
                  "risk":body.risk,"reason":body.reason,"actor":actor.id,"due":due}))
            if not item:
                # Conflict from concurrent request; return the active canonical case.
                item = one(c.execute(text("""
                    select id::text,risk,status,sla_due_at from public.crm_dispute_cases
                    where organization_id=cast(:org as uuid)
                      and status in ('open','pending_evidence','review','approved')
                      and ((cast(:attr as uuid) is not null
                             and attribution_id=cast(:attr as uuid))
                        or (cast(:recon as uuid) is not null
                             and reconciliation_item_id=cast(:recon as uuid)))
                    limit 1
                """),params))
                if not item:
                    raise DomainError("DISPUTE_CONFLICT","Source changed while creating dispute.",409)
                return {"case":item,"mode":"shadow","reused":True,"financial_execution":False}
            audit(c,request,org,actor,"dispute.shadow_opened","crm_dispute",item["id"],
                  after={"risk":item["risk"],"billable":False})
            return {"case":item,"mode":"shadow","reused":False,"financial_execution":False}

    @app.post("/api/fmc/{org}/disputes/evaluate-sla-shadow")
    def evaluate_shadow_dispute_sla(org: str, request: Request, limit: int = 100):
        staging_only()
        if not 1 <= limit <= 200:
            raise DomainError("LIMIT", "Use limit between 1 and 200.", 422)
        actor = who(request)
        with db.user(actor.id) as c:
            role(c, org, actor, MANAGER)
        with db.trusted() as c:
            db.require_role(c, org, actor.id, MANAGER)
            due = rows(c.execute(text("""
                select id::text,risk,policy_version,sla_due_at
                from public.crm_dispute_cases
                where organization_id=cast(:org as uuid)
                  and status in ('open','pending_evidence','review','approved')
                  and sla_due_at<=now()
                order by sla_due_at,id
                for update skip locked limit :limit
            """), {"org":org,"limit":limit}))
            created = 0
            for item in due:
                key = f"{item['id']}:{item['policy_version']}:sla_breached"
                entry = one(c.execute(text("""
                    insert into public.crm_dispute_escalations
                      (organization_id,case_id,kind,policy_version,risk,sla_due_at,
                       next_responsible_role,event_key)
                    values(cast(:org as uuid),cast(:case as uuid),'sla_breached',
                           :policy,:risk,:due,:role,:key)
                    on conflict(case_id,policy_version,kind) do nothing
                    returning id::text
                """), {"org":org,"case":item["id"],"policy":item["policy_version"],
                       "risk":item["risk"],"due":item["sla_due_at"],
                       "role":next_sla_owner_role(item["risk"]),"key":key}))
                if entry:
                    created+=1
            if created:
                audit(c,request,org,actor,"dispute.sla_shadow_escalation_recorded",
                      "organization",org,
                      after={"new_escalations":created,"notifications_sent":0,
                             "financial_execution":False})
            return {"evaluated_due":len(due),"new_escalations":created,
                    "already_escalated":len(due)-created,"mode":"shadow",
                    "notifications_sent":0,"financial_execution":False}

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



    @app.post("/api/fmc/{org}/bookings/{booking_id}/reconcile-shadow")
    def reconcile_core_booking_shadow(org: str, booking_id: uuid.UUID, request: Request):
        """Transactional Core-vs-offline-fixture observation; never financial action."""
        staging_only()
        actor=who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,MANAGER)
        with db.trusted() as c:
            db.require_role(c,org,actor.id,MANAGER)
            booking=one(c.execute(text("""
              select id::text,organization_id::text,status::text,source,
                     external_reference,updated_at
              from public.bookings where id=cast(:booking as uuid)
                 and organization_id=cast(:org as uuid) for update
            """),{"org":org,"booking":str(booking_id)}))
            if not booking:
                raise DomainError("BOOKING_NOT_FOUND","Booking not found in this organization.",404)
            snapshot_key=core_snapshot_key(booking)
            snap=c.execute(text("""
              select 1 from public.crm_booking_evidence
              where organization_id=cast(:org as uuid)
                and booking_id=cast(:booking as uuid) and event_key=:key
            """),{"org":org,"booking":booking["id"],"key":snapshot_key}).scalar_one_or_none()
            if not snap:
                raise DomainError("BOOKING_SNAPSHOT_REQUIRED",
                                  "Evaluate latest Core booking evidence before reconciling.",409)
            provider=None
            if booking["external_reference"] and booking["source"] not in NATIVE_SOURCES:
                provider=one(c.execute(text("""
                  select p.id::text,p.event_key,p.event_state,p.provider_sequence
                  from public.crm_provider_events_offline p
                  join public.crm_provider_signature_receipts_shadow receipt
                    on receipt.provider_event_id=p.id
                   and receipt.organization_id=p.organization_id
                   and receipt.provider_connection_id=p.provider_connection_id
                  where p.organization_id=cast(:org as uuid)
                    and p.provider=:provider and p.booking_reference=:reference
                  order by p.provider_sequence desc,p.created_at desc limit 1
                """),{"org":org,"provider":booking["source"],
                       "reference":booking["external_reference"]}))
            previous=one(c.execute(text("""
              select id::text,maturity,primary_offer_id::text,confidence
              from public.crm_attribution_records
              where organization_id=cast(:org as uuid) and booking_id=cast(:booking as uuid)
              for update
            """),{"org":org,"booking":booking["id"]}))
            if not previous:
                raise DomainError("ATTRIBUTION_NOT_EVALUATED",
                                  "Evaluate Core booking snapshot before reconciliation.",409)
            proposed=reconcile_shadow(booking["status"],booking["source"],
                provider["event_state"] if provider else None,previous["maturity"])
            event_key=shadow_reconciliation_key(
                org,booking["id"],snapshot_key,provider["event_key"] if provider else None)
            inserted=one(c.execute(text("""
              insert into public.crm_shadow_reconciliation_observations
                (organization_id,booking_id,core_snapshot_key,offline_event_id,
                 event_key,booking_status,provider_claim,source_resolution,
                 shadow_maturity,reason,review_required)
              values(cast(:org as uuid),cast(:booking as uuid),:snapshot,
                     cast(:provider_event as uuid),:event,:status,:claim,
                     :source,:maturity,:reason,:review)
              on conflict(event_key) do nothing returning id::text
            """),{"org":org,"booking":booking["id"],"snapshot":snapshot_key,
                  "provider_event":provider["id"] if provider else None,
                  "event":event_key,"status":booking["status"],
                  "claim":provider["event_state"] if provider else None,
                  "source":proposed.source_resolution,
                  "maturity":proposed.maturity,"reason":proposed.reason,
                  "review":proposed.review_required}))
            terminal=previous["maturity"] in ("finalized","adjusted")
            protected=previous["primary_offer_id"] is not None
            if inserted and not terminal and not protected:
                c.execute(text("""
                  update public.crm_attribution_records
                  set maturity=:maturity,confidence='ambiguous',
                      primary_action_id=null,primary_offer_id=null,
                      assisted_actions='[]'::jsonb,
                      authority_source=:authority,
                      gross_attributed_minor=0,fee_minor=0,billable=false,
                      policy_version='reconciliation_shadow_v1',
                      evidence_snapshot=cast(:evidence as jsonb),updated_at=now()
                  where id=cast(:record as uuid)
                """),{"maturity":proposed.maturity,
                      "authority":proposed.source_resolution,
                      "record":previous["id"],
                      "evidence":json.dumps({
                         "core_snapshot_key":snapshot_key,
                         "provider_event_key":provider["event_key"] if provider else None,
                         "provider_offline_only":bool(provider),
                         "causal_evidence_verified":False,
                         "financial_execution":False})})
            if inserted:
                audit(c,request,org,actor,"reconciliation.shadow_observed",
                    "booking",booking["id"],after={
                      "event_key":event_key,"maturity":proposed.maturity,
                      "provider_offline_only":bool(provider),"billable":False})
            return {"booking_id":booking["id"],
                    "observation_id":inserted["id"] if inserted else None,
                    "new_evidence":bool(inserted),"prior_maturity":previous["maturity"],
                    "proposed_maturity":proposed.maturity,
                    "maturity_applied":bool(inserted and not terminal and not protected),
                    "review_required":bool(proposed.review_required or terminal or protected),
                    "reason":proposed.reason,"source_resolution":proposed.source_resolution,
                    "provider_fixture_seen":bool(provider),
                    "fee_minor":0,"billable":False,"customer_messages_sent":0,
                    "refunds_executed":0,"mode":"shadow"}

    @app.get("/api/fmc/{org}/bookings/{booking_id}/reconciliation-history")
    def shadow_reconciliation_history(org: str, booking_id: uuid.UUID, request: Request):
        actor=who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,FINANCE)
            records=rows(c.execute(text("""
              select id::text,core_snapshot_key,event_key,booking_status,
                     provider_claim,source_resolution,shadow_maturity,reason,
                     review_required,billable,fee_minor,observed_at
              from public.crm_shadow_reconciliation_observations
              where organization_id=cast(:org as uuid)
                and booking_id=cast(:booking as uuid)
              order by observed_at,id
            """),{"org":org,"booking":str(booking_id)}))
        return {"items":records,"mode":"shadow","financial_execution":False}


    @app.post("/api/fmc/{org}/bookings/{booking_id}/adjustment-observe-shadow")
    def record_shadow_adjustment(org: str, booking_id: uuid.UUID,
                                 body: ShadowAdjustmentIn, request: Request):
        """Zero-delta observation only: cancellation fact or disputed claim."""
        staging_only()
        actor = who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,MANAGER)
        with db.trusted() as c:
            db.require_role(c,org,actor.id,MANAGER)
            booking = one(c.execute(text("""
                select id::text,organization_id::text,status::text,source,updated_at
                from public.bookings where organization_id=cast(:org as uuid)
                  and id=cast(:booking as uuid) for update
            """),{"org":org,"booking":str(booking_id)}))
            if not booking:
                raise DomainError("BOOKING_NOT_FOUND","Booking is missing in this organization.",404)
            latest_key=core_snapshot_key(booking)
            obs=one(c.execute(text("""
                select id::text,event_key,booking_status,provider_claim,
                       shadow_maturity,review_required,core_snapshot_key
                from public.crm_shadow_reconciliation_observations
                where organization_id=cast(:org as uuid)
                  and booking_id=cast(:booking as uuid)
                  and id=cast(:observation as uuid)
            """),{"org":org,"booking":str(booking_id),
                  "observation":str(body.observation_id)}))
            if not obs:
                raise DomainError("OBSERVATION_NOT_FOUND","No matching tenant observation.",404)
            if obs["core_snapshot_key"] != latest_key:
                raise DomainError("STALE_OBSERVATION",
                                  "Reconcile the latest Core booking state first.",409)
            if body.kind=="cancellation" and not (
                obs["booking_status"]=="cancelled" and
                obs["shadow_maturity"] in ("unverified","disputed")):
                raise DomainError("ADJUSTMENT_SOURCE",
                                  "Authoritative Core cancellation required.",422)
            if body.kind=="provider_correction" and not (
                obs["provider_claim"] is not None and obs["review_required"]
                and obs["shadow_maturity"]=="disputed"):
                raise DomainError("ADJUSTMENT_SOURCE",
                                  "Disputed external claim required.",422)
            attr=one(c.execute(text("""
                select id::text,maturity,billable,fee_minor
                from public.crm_attribution_records
                where organization_id=cast(:org as uuid)
                  and booking_id=cast(:booking as uuid) for update
            """),{"org":org,"booking":str(booking_id)}))
            if not attr or attr["billable"] or attr["fee_minor"]!=0:
                raise DomainError("FINANCE_LOCK","Financial adjustment prohibited.",409)
            ref=f"shadow:{obs['event_key'].strip()}:{body.kind}"
            evidence={"shadow_only":True,"financial_execution":False,
                      "causal_evidence_verified":False,
                      "source_observation_id":obs["id"],
                      "observation_kind":"external_claim_needs_review"
                      if body.kind=="provider_correction" else "core_cancellation_observed"}
            inserted=one(c.execute(text("""
                insert into public.crm_attribution_adjustments
                  (organization_id,attribution_id,kind,delta_minor,evidence,
                   correction_reference,created_by,source_observation_id)
                values(cast(:org as uuid),cast(:attr as uuid),:kind,0,
                       cast(:evidence as jsonb),:ref,cast(:actor as uuid),
                       cast(:observation as uuid))
                on conflict(attribution_id,correction_reference) do nothing
                returning id::text
            """),{"org":org,"attr":attr["id"],"kind":body.kind,
                  "evidence":json.dumps(evidence),"ref":ref,
                  "actor":actor.id,"observation":obs["id"]}))
            if inserted:
                audit(c,request,org,actor,"attribution.shadow_adjustment_observed",
                    "booking",str(booking_id),after={"kind":body.kind,
                    "source_observation_id":obs["id"],"delta_minor":0,
                    "financial_execution":False})
            return {"booking_id":str(booking_id),"observation_id":obs["id"],
                    "attribution_id":attr["id"],
                    "adjustment_id":inserted["id"] if inserted else None,
                    "new_evidence":bool(inserted),"kind":body.kind,
                    "delta_minor":0,"fee_minor":0,"billable":False,
                    "refunds_executed":0,"mode":"shadow"}



    @app.get("/api/fmc/{org}/bookings/{booking_id}/pathway-readiness")
    def list_core_pathway_readiness(org: str, booking_id: uuid.UUID, request: Request):
        """Read-only proof-readiness view. No booking, signing or webhook operation."""
        actor=who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,FINANCE)
            booking=one(c.execute(text("""
               select id::text,organization_id::text,source,status::text,updated_at
               from public.bookings where organization_id=cast(:org as uuid)
                 and id=cast(:booking as uuid)
            """),{"org":org,"booking":str(booking_id)}))
            if not booking:
                raise DomainError("BOOKING_NOT_FOUND","Booking unavailable for organization.",404)
            snapshot=core_snapshot_key(booking)
            events=rows(c.execute(text("""
               select id::text,path_id::text,offer_id::text,sequence,state,
                      prior_event_key,event_key,occurred_at,observed_at
               from public.crm_core_pathway_fixtures_shadow
               where organization_id=cast(:org as uuid)
                 and booking_id=cast(:booking as uuid)
                 and core_snapshot_key=:snapshot
               order by path_id,sequence,id limit 101
            """),{"org":org,"booking":booking["id"],"snapshot":snapshot}))
            if len(events)>100:
                return {"booking_id":booking["id"],"readiness":"REVIEW_LIMIT",
                        "causal_evidence_verified":False,
                        "core_origin_verified":False,"primary_offer_id":None,
                        "billable":False,"fee_minor":0,"mode":"shadow"}
            result=pathway_readiness(booking["status"],booking["source"],events)
            return {"booking_id":booking["id"],"fixture_event_count":len(events),
                    **result}

    @app.post("/api/fmc/{org}/bookings/{booking_id}/offer-proof-evaluate-shadow")
    def evaluate_offer_proof_shadow(org: str, booking_id: uuid.UUID, request: Request):
        """Explain a possible association; NEVER credit a financial conversion."""
        staging_only()
        actor=who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,MANAGER)
        with db.trusted() as c:
            db.require_role(c,org,actor.id,MANAGER)
            booking=one(c.execute(text("""
                select id::text,organization_id::text,source,status::text,updated_at
                from public.bookings where organization_id=cast(:org as uuid)
                 and id=cast(:booking as uuid) for update
            """),{"org":org,"booking":str(booking_id)}))
            if not booking:
                raise DomainError("BOOKING_NOT_FOUND","Booking missing in this organization.",404)
            key=core_snapshot_key(booking)
            source=c.execute(text("""
                select 1 from public.crm_booking_evidence
                where organization_id=cast(:org as uuid)
                  and booking_id=cast(:booking as uuid) and event_key=:key
            """),{"org":org,"booking":booking["id"],"key":key}).scalar_one_or_none()
            if not source:
                raise DomainError("BOOKING_SNAPSHOT_REQUIRED",
                                  "Evaluate current Core booking snapshot first.",409)
            links=rows(c.execute(text("""
                select distinct l.offer_id::text as offer_id
                from public.crm_booking_offer_links_shadow l
                join public.crm_offers o on o.id=l.offer_id
                  and o.organization_id=l.organization_id
                where l.organization_id=cast(:org as uuid)
                  and l.booking_id=cast(:booking as uuid)
                  and l.booking_snapshot_key=:key
                order by offer_id limit 26
            """),{"org":org,"booking":booking["id"],"key":key}))
            if len(links)>25:
                raise DomainError("EVIDENCE_LIMIT",
                                  "Too many candidate Offers for automatic assessment.",409)
            historical=c.execute(text("""
                select count(*) from public.crm_booking_offer_links_shadow
                where organization_id=cast(:org as uuid)
                  and booking_id=cast(:booking as uuid)
                  and booking_snapshot_key<>:key
            """),{"org":org,"booking":booking["id"],"key":key}).scalar_one()
            last_recon=one(c.execute(text("""
                select event_key,shadow_maturity from
                  public.crm_shadow_reconciliation_observations
                where organization_id=cast(:org as uuid)
                  and booking_id=cast(:booking as uuid)
                  and core_snapshot_key=:key
                order by observed_at desc,id desc limit 1
            """),{"org":org,"booking":booking["id"],"key":key}))
            proof=assess_offer_evidence(
                booking_status=booking["status"],booking_source=booking["source"],
                current_candidate_ids=[item["offer_id"] for item in links],
                historical_link_count=historical,
                reconciliation_maturity=last_recon["shadow_maturity"] if last_recon else None)
            event_key=assessment_event_key(
                organization_id=org,booking_id=booking["id"],snapshot_key=key,
                candidate_offer_ids=proof.candidate_offer_ids,
                reconciliation_event_key=last_recon["event_key"] if last_recon else None,
                outcome=proof.outcome)
            inserted=one(c.execute(text("""
                insert into public.crm_offer_proof_reviews_shadow
                  (organization_id,booking_id,core_snapshot_key,
                   reconciliation_event_key,event_key,outcome,
                   candidate_offer_ids,candidate_count,review_required,created_by)
                values(cast(:org as uuid),cast(:booking as uuid),:snapshot,:recon,
                       :event,:outcome,cast(:offers as jsonb),:count,:review,
                       cast(:actor as uuid))
                on conflict(event_key) do nothing returning id::text
            """),{"org":org,"booking":booking["id"],"snapshot":key,
                  "recon":last_recon["event_key"] if last_recon else None,
                  "event":event_key,"outcome":proof.outcome,
                  "offers":json.dumps(proof.candidate_offer_ids),
                  "count":len(proof.candidate_offer_ids),
                  "review":proof.review_required,"actor":actor.id}))
            if inserted:
                audit(c,request,org,actor,"attribution.offer_proof_shadow_evaluated",
                      "booking",booking["id"],after={
                      "outcome":proof.outcome,
                      "candidate_count":len(proof.candidate_offer_ids),
                      "causal_evidence_verified":False,"billable":False})
            return {"booking_id":booking["id"],"review_id":inserted["id"] if inserted else None,
                    "new_evidence":bool(inserted),"outcome":proof.outcome,
                    "candidate_offer_ids":list(proof.candidate_offer_ids),
                    "candidate_count":len(proof.candidate_offer_ids),
                    "review_required":proof.review_required,
                    "primary_offer_id":None,"causal_evidence_verified":False,
                    "billable":False,"fee_minor":0,"mode":"shadow"}

    @app.get("/api/fmc/{org}/bookings/{booking_id}/offer-proof-history")
    def list_offer_proof_history(org: str, booking_id: uuid.UUID, request: Request):
        actor=who(request)
        with db.user(actor.id) as c:
            role(c,org,actor,FINANCE)
            items=rows(c.execute(text("""
                select id::text,event_key,core_snapshot_key,reconciliation_event_key,
                       outcome,candidate_offer_ids,candidate_count,review_required,
                       primary_offer_id,causal_evidence_verified,billable,fee_minor,created_at
                from public.crm_offer_proof_reviews_shadow
                where organization_id=cast(:org as uuid)
                  and booking_id=cast(:booking as uuid)
                order by created_at,id
            """),{"org":org,"booking":str(booking_id)}))
        return {"items":items,"mode":"shadow","causal_credit_enabled":False}

    @app.post("/api/fmc/{org}/attributions/link-offer-shadow", status_code=200)
    def link_offer_shadow(org: str, body: OfferLinkIn, request: Request):
        """Internal operator observation only. Never confirms causal credit or fees."""
        staging_only()
        actor = who(request)
        with db.user(actor.id) as c:
            role(c, org, actor, MANAGER)
        with db.trusted() as c:
            db.require_role(c, org, actor.id, MANAGER)
            booking = one(c.execute(text("""
                select id::text,organization_id::text,court_id::text,
                       starts_at,ends_at,currency::text,source,status::text,updated_at
                from public.bookings
                where organization_id=cast(:org as uuid) and id=cast(:booking as uuid)
                for update
            """), {"org":org,"booking":str(body.booking_id)}))
            offer = one(c.execute(text("""
                select id::text,organization_id::text,action_id::text,
                       target_court_id::text,target_starts_at,target_ends_at,
                       currency::text,tracking_token
                from public.crm_offers
                where organization_id=cast(:org as uuid) and id=cast(:offer as uuid)
            """), {"org":org,"offer":str(body.offer_id)}))
            if not booking or not offer:
                raise DomainError("LINK_SOURCE_NOT_FOUND","Core booking or Offer missing in this organization.",404)
            snapshot_key = core_snapshot_key(booking)
            snapshot = c.execute(text("""
                select 1 from public.crm_booking_evidence
                where organization_id=cast(:org as uuid) and booking_id=cast(:booking as uuid)
                  and event_key=:key
            """), {"org":org,"booking":booking["id"],"key":snapshot_key}).scalar_one_or_none()
            if not snapshot:
                raise DomainError("BOOKING_SNAPSHOT_REQUIRED","Evaluate Core booking snapshot first.",409)
            try:
                link = build_shadow_offer_link(booking,offer,body.tracking_token,snapshot_key)
            except EvidenceRejected as exc:
                raise DomainError("OFFER_LINK_REJECTED",str(exc),422) from None
            inserted = one(c.execute(text("""
                insert into public.crm_booking_offer_links_shadow
                  (organization_id,booking_id,offer_id,booking_snapshot_key,
                   event_key,tracking_digest,outcome)
                values(cast(:org as uuid),cast(:booking as uuid),cast(:offer as uuid),
                       :snapshot,:key,:digest,:outcome)
                on conflict(event_key) do nothing returning id::text
            """), {"org":org,"booking":booking["id"],"offer":offer["id"],
                  "snapshot":snapshot_key,"key":link["event_key"],
                  "digest":link["tracking_digest"],"outcome":link["outcome"]}))
            if inserted:
                audit(c,request,org,actor,"attribution.shadow_offer_link_observed",
                      "booking",booking["id"],after={
                       "offer_id":offer["id"],"evidence_key":link["event_key"],
                       "causal_evidence_verified":False,"fee_minor":0})
            return {"booking_id":booking["id"],"offer_id":offer["id"],
                    "link_id":inserted["id"] if inserted else None,
                    "new_evidence":bool(inserted),"outcome":link["outcome"],
                    "causal_evidence_verified":False,"primary_winner":None,
                    "billable":False,"fee_minor":0,"mode":"shadow"}

    @app.get("/api/fmc/{org}/bookings/{booking_id}/offer-links")
    def list_shadow_offer_links(org: str, booking_id: uuid.UUID, request: Request):
        actor = who(request)
        with db.user(actor.id) as c:
            role(c, org, actor, FINANCE)
            items = rows(c.execute(text("""
                select id::text,booking_id::text,offer_id::text,
                       booking_snapshot_key,outcome,causal_evidence_verified,
                       fee_minor,created_at
                from public.crm_booking_offer_links_shadow
                where organization_id=cast(:org as uuid)
                  and booking_id=cast(:booking as uuid)
                order by created_at,id
            """), {"org":org,"booking":str(booking_id)}))
        return {"items":items,"mode":"shadow","financial_execution":False}

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
