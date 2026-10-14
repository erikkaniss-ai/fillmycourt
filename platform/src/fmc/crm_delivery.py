"""FMC-CRM-D01: idempotent, strictly non-live delivery evidence.

This adapter NEVER sends messages and NEVER claims delivery/read/booking.
Only owner-approved shadow actions are eligible for synthetic attempt records.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy import text

from .common import DomainError
from .supabase_v1 import one, rows

FINANCE_ROLES = {"owner", "admin", "manager", "analyst"}

# Only real provider adapters may eventually create provider-status events.
# The null adapter can append only CREATED and SHADOW_SIMULATED.
STATE_PRIORITY = {
    "CREATED": 0, "QUEUED": 1, "SHADOW_SIMULATED": 2,
    "PROVIDER_ACCEPTED": 3, "FAILED_TRANSIENT": 3,
    "RETRY_SCHEDULED": 3, "DELIVERED": 4, "READ": 5,
    "CLICKED": 6, "REPLIED": 7, "BOOKING_STARTED": 8,
    "PAYMENT_STARTED": 9, "BOOKING_CONFIRMED": 10,
}


def derive_delivery_state(event_types):
    """Monotonic semantic projection; out-of-order events cannot regress it."""
    events = set(event_types)
    if "OPT_OUT" in events:
        return "suppressed"
    if "BOOKING_CONFIRMED" in events:
        return "converted"
    if "FAILED_PERMANENT" in events and not events.intersection(
        {"DELIVERED", "READ", "CLICKED", "REPLIED", "BOOKING_STARTED"}
    ):
        return "failed_permanent"
    if "BOOKING_FAILED" in events or "ABANDONED" in events:
        return "re_evaluate"
    return max(events, key=lambda x: STATE_PRIORITY.get(x, -1)) if events else "unknown"


def deterministic_reply_intent(raw):
    """Safe deterministic opt-out precedence; AI classification is not live."""
    normalized = (raw or "").strip().casefold()
    if re.search(r"\b(stop|unsubscribe|remove me|opt[\s-]?out|parar mensagens|não me contacte)\b", normalized):
        return "OPT_OUT"
    return "UNKNOWN"


def business_key(org, action, offer, audience, channel):
    value = ":".join((org, action, offer, audience, channel))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def register_crm_delivery(app, db, who, role, audit):
    @app.post("/api/fmc/{org}/crm-actions/{action_id}/shadow-delivery")
    def prepare_shadow_delivery(org: str, action_id: str, request: Request):
        actor = who(request)
        # Authorization is checked under actual authenticated RLS before trusted work.
        with db.user(actor.id) as c:
            role(c, org, actor, FINANCE_ROLES)
        with db.trusted() as c:
            # Recheck membership inside the write transaction to avoid stale authority.
            db.require_role(c, org, actor.id, FINANCE_ROLES)
            action = one(c.execute(text("""
                select ca.id::text,ca.status,ca.mode,ca.execution_enabled,
                       ca.current_wave,ca.quote_amount_minor,
                       ro.status opportunity_status,ro.quote_amount_minor current_quote,
                       ro.expected_incremental_contribution_minor
                from public.crm_actions ca
                join public.revenue_opportunities ro on ro.id=ca.opportunity_id
                where ca.id=cast(:action as uuid)
                  and ca.organization_id=cast(:org as uuid)
                for update of ca
            """), {"org": org, "action": action_id}))
            if not action:
                raise DomainError("CRM_ACTION_NOT_FOUND", "CRM action not found.", 404)
            if action["mode"] != "shadow" or action["status"] != "approved" or action["execution_enabled"]:
                raise DomainError("SHADOW_ONLY", "Only approved, non-executing shadow actions are supported.", 409)
            if action["opportunity_status"] not in ("actionable", "in_progress"):
                raise DomainError("OPPORTUNITY_STATE", "Opportunity is no longer actionable.", 409)
            if (int(action["current_quote"]) != int(action["quote_amount_minor"])
                    or int(action["expected_incremental_contribution_minor"]) <= 0):
                raise DomainError("ACTION_STALE", "Authoritative price or contribution has changed.", 409)

            wave = int(action["current_wave"])
            candidates = rows(c.execute(text("""
                select au.id::text audience_id,au.person_id::text,au.channel,
                       p.phone,p.email,cp.status permission_status,cp.consent_proof,
                       cp.consent_at,cp.suppression_reason,cp.frequency_cap_hours,
                       cp.last_contacted_at,
                       o.id::text offer_id,o.status offer_status,o.expires_at,
                       o.target_court_id::text court_id,o.target_starts_at,o.target_ends_at
                from public.crm_action_audience au
                join public.people p on p.id=au.person_id and p.organization_id=au.organization_id
                join public.crm_offers o on o.action_id=au.action_id
                  and o.organization_id=au.organization_id and o.wave_number=au.wave_number
                left join public.communication_permissions cp on cp.id=au.permission_id
                  and cp.organization_id=au.organization_id
                  and cp.person_id=au.person_id and cp.channel=au.channel
                where au.action_id=cast(:action as uuid)
                  and au.organization_id=cast(:org as uuid)
                  and au.eligibility='eligible' and au.wave_number=:wave
                order by au.segment_rank,au.relevance_score desc,au.id
            """), {"org": org, "action": action_id, "wave": wave}))
            if not candidates:
                raise DomainError("NO_ELIGIBLE_AUDIENCE", "No planned eligible recipients in current wave.", 409)

            now = datetime.now(timezone.utc)
            prepared, existing, blocked = 0, 0, 0
            for item in candidates:
                if (item["permission_status"] != "granted" or not item["consent_proof"]
                    or not item["consent_at"] or item["suppression_reason"]
                    or not (item["phone"] if item["channel"] == "whatsapp" else item["email"])):
                    blocked += 1
                    continue
                if (item["frequency_cap_hours"] and item["last_contacted_at"]
                    and (now-item["last_contacted_at"]).total_seconds() <
                       int(item["frequency_cap_hours"])*3600):
                    blocked += 1
                    continue
                if (item["offer_status"] != "shadow" or item["expires_at"] <= now
                    or item["target_starts_at"] <= now):
                    blocked += 1
                    continue
                # No inventory reservation. Only read authoritative booking and hold state.
                conflict = c.execute(text("""
                    select exists(
                        select 1 from public.bookings b
                        where b.organization_id=cast(:org as uuid)
                          and b.court_id=cast(:court as uuid)
                          and b.status in ('confirmed','pending_payment','held')
                          and b.starts_at<:finish and b.ends_at>:start
                        union all
                        select 1 from public.booking_holds h
                        where h.organization_id=cast(:org as uuid)
                          and h.court_id=cast(:court as uuid) and h.expires_at>now()
                          and h.starts_at<:finish and h.ends_at>:start
                    )
                """), {"org": org, "court": item["court_id"],
                       "start": item["target_starts_at"], "finish": item["target_ends_at"]}).scalar_one()
                if conflict:
                    blocked += 1
                    continue
                key = business_key(org, action_id, item["offer_id"], item["audience_id"], item["channel"])
                inserted = one(c.execute(text("""
                    insert into public.crm_delivery_attempts
                      (organization_id,action_id,offer_id,audience_id,person_id,
                       channel,adapter,attempt_number,business_key,status)
                    values(cast(:org as uuid),cast(:action as uuid),cast(:offer as uuid),
                           cast(:audience as uuid),cast(:person as uuid),:channel,
                           'null',1,:key,'shadow_simulated')
                    on conflict(business_key) do nothing
                    returning id::text
                """), {"org": org, "action": action_id, "offer": item["offer_id"],
                       "audience": item["audience_id"], "person": item["person_id"],
                       "channel": item["channel"], "key": key}))
                if not inserted:
                    existing += 1
                    continue
                attempt_id = inserted["id"]
                c.execute(text("""
                    insert into public.crm_delivery_events
                      (organization_id,attempt_id,event_key,event_type,source,evidence)
                    values(cast(:org as uuid),cast(:attempt as uuid),:created,'CREATED','null',
                           cast(:ev as jsonb)),
                          (cast(:org as uuid),cast(:attempt as uuid),:simulated,'SHADOW_SIMULATED',
                           'null',cast(:ev as jsonb))
                """), {"org": org, "attempt": attempt_id, "created":key+":created",
                       "simulated":key+":shadow", "ev":json.dumps({"adapter":"null",
                              "external_send":False, "test_only":True})})
                prepared += 1
            if prepared:
                audit(c, request, org, actor, "crm.shadow_delivery_prepared",
                      "crm_action", action_id,
                      after={"wave": wave, "prepared": prepared, "existing": existing,
                             "blocked": blocked, "external_send": False})
            return {"action_id": action_id, "wave": wave, "adapter": "null",
                    "prepared": prepared, "existing": existing, "blocked": blocked,
                    "external_send": False, "execution_enabled": False,
                    "provider_message_ids": []}

    @app.get("/api/fmc/{org}/crm-actions/{action_id}/delivery")
    def read_shadow_delivery(org: str, action_id: str, request: Request):
        actor = who(request)
        with db.user(actor.id) as c:
            role(c, org, actor, FINANCE_ROLES)
            action = one(c.execute(text("""
                select id::text from public.crm_actions
                where id=cast(:action as uuid) and organization_id=cast(:org as uuid)
            """), {"action": action_id, "org": org}))
            if not action:
                raise DomainError("CRM_ACTION_NOT_FOUND", "CRM action not found.", 404)
            attempts = rows(c.execute(text("""
                select id::text,offer_id::text,audience_id::text,channel,adapter,
                       attempt_number,status,created_at
                from public.crm_delivery_attempts
                where action_id=cast(:action as uuid) and organization_id=cast(:org as uuid)
                order by created_at,id
            """), {"action": action_id, "org": org}))
            events = rows(c.execute(text("""
                select ev.id::text,ev.attempt_id::text,ev.event_type,ev.source,
                       ev.occurred_at,ev.received_at
                from public.crm_delivery_events ev
                join public.crm_delivery_attempts a on a.id=ev.attempt_id
                where a.action_id=cast(:action as uuid)
                  and a.organization_id=cast(:org as uuid)
                order by ev.received_at,ev.id
            """), {"action": action_id, "org": org}))
            return {"action_id": action_id, "attempts": attempts, "events": events,
                    "external_send": False, "live_delivery_available": False}
