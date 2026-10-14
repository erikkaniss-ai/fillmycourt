"""Internal-only signed provider fixture persistence.

This module registers NO network routes, background consumer, provider writer,
or billing capability. The caller supplies a fixture-only key explicitly.
The signed receipt proves verification by this internal function, not
independent provider authority or commercial causality.
"""
from __future__ import annotations

from datetime import datetime
import hashlib

from sqlalchemy import text

from .offline_evidence import EvidenceRejected, verify_offline_provider_event
from .supabase_v1 import one


def record_signed_provider_fixture(c, *, organization_id: str,
                                   connection_id: str,
                                   payload: bytes, signature_hex: str,
                                   signed_epoch: int, fixture_secret: str,
                                   now: datetime) -> dict:
    """Require a trusted transaction, resolve authority from DB and lock source.

    Duplicate signed IDs are idempotent iff exact payload and sequence match.
    Any conflicting event ID, stale sequence, or tenant mismatch fails closed.
    """
    provider = one(c.execute(text("""
        select id::text,organization_id::text,provider
        from public.provider_connections
        where id=cast(:connection as uuid) and organization_id=cast(:org as uuid)
        for update
    """), {"connection":connection_id,"org":organization_id}))
    if not provider:
        raise EvidenceRejected("SOURCE_NOT_FOUND")
    event = verify_offline_provider_event(
        payload=payload,signature_hex=signature_hex,signed_epoch=signed_epoch,
        secret=fixture_secret,expected_organization_id=provider["organization_id"],
        expected_connection_id=provider["id"],expected_provider=provider["provider"],
        now=now,
    )
    existing = one(c.execute(text("""
        select p.id::text,p.event_key,p.payload_sha256,p.provider_sequence,
               p.event_state,r.id::text as receipt_id
        from public.crm_provider_events_offline p
        left join public.crm_provider_signature_receipts_shadow r
            on r.provider_event_id=p.id
        where p.organization_id=cast(:org as uuid)
          and p.provider_connection_id=cast(:conn as uuid) and p.event_id=:event_id
    """), {"org":organization_id,"conn":connection_id,"event_id":event.event_id}))
    if existing:
        if (existing["event_key"] != event.event_key or
                existing["payload_sha256"] != event.payload_sha256 or
                existing["provider_sequence"] != event.sequence or
                existing["event_state"] != event.state or not existing["receipt_id"]):
            raise EvidenceRejected("EVENT_ID_CONFLICT")
        return {"event_id":existing["id"],"receipt_id":existing["receipt_id"],
                "new_evidence":False,"event_key":event.event_key,
                "verified_mode":"offline_signed_fixture","causal_evidence_verified":False}
    max_sequence = c.execute(text("""
        select coalesce(max(provider_sequence),0)
        from public.crm_provider_events_offline
        where organization_id=cast(:org as uuid)
          and provider_connection_id=cast(:conn as uuid)
    """),{"org":organization_id,"conn":connection_id}).scalar_one()
    if event.sequence <= max_sequence:
        raise EvidenceRejected("STALE_OR_REORDERED_EVENT")
    inserted = one(c.execute(text("""
        insert into public.crm_provider_events_offline
          (organization_id,provider_connection_id,provider,event_id,
           provider_sequence,booking_reference,event_state,event_key,
           payload_sha256,event_occurred_at,signed_at)
        values(cast(:org as uuid),cast(:conn as uuid),:provider,:event_id,
               :sequence,:reference,:state,:key,:payload,:occurred,:signed)
        returning id::text
    """),{"org":event.organization_id,"conn":event.connection_id,
          "provider":event.provider,"event_id":event.event_id,
          "sequence":event.sequence,"reference":event.booking_reference,
          "state":event.state,"key":event.event_key,
          "payload":event.payload_sha256,"occurred":event.occurred_at,
          "signed":event.signed_at}))
    receipt = one(c.execute(text("""
        insert into public.crm_provider_signature_receipts_shadow
          (organization_id,provider_event_id,provider_connection_id,event_key,
           payload_sha256,signature_digest,signed_epoch)
        values(cast(:org as uuid),cast(:event as uuid),cast(:conn as uuid),
               :key,:payload,:signature,:signed_epoch)
        returning id::text
    """),{"org":event.organization_id,"event":inserted["id"],
          "conn":event.connection_id,"key":event.event_key,
          "payload":event.payload_sha256,
          "signature":hashlib.sha256(bytes.fromhex(signature_hex)).hexdigest(),
          "signed_epoch":signed_epoch}))
    return {"event_id":inserted["id"],"receipt_id":receipt["id"],
            "new_evidence":True,"event_key":event.event_key,
            "verified_mode":"offline_signed_fixture","causal_evidence_verified":False}
