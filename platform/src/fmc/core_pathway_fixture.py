"""FMC-F10 — offline Core-shaped booking pathway contract, NOT live Core attestation.

Only the internal fixture helper may accept explicit HMAC test keys. This module
registers NO booking writer, webhook listener, public signer, provider bridge or
CRM delivery capability. A complete fixture chain is *not* causal attribution.
"""
from __future__ import annotations

from datetime import datetime, timezone
from dataclasses import dataclass
import hashlib
import hmac
import json
import re
import uuid

from sqlalchemy import text

from .offline_evidence import EvidenceRejected, _pairs_unique
from .supabase_v1 import one


@dataclass(frozen=True)
class PathwayFixture:
    organization_id: str
    booking_id: str
    offer_id: str
    path_id: str
    event_id: str
    sequence: int
    state: str
    snapshot_key: str
    offer_link_key: str
    prior_event_key: str | None
    occurred_at: datetime
    event_key: str
    payload_sha256: str
    signature_digest: str


def _as_uuid(v):
    try:
        return str(uuid.UUID(str(v)))
    except (ValueError, TypeError, AttributeError):
        raise EvidenceRejected("INVALID_PATH_ID") from None


def verify_pathway_fixture(*, payload: bytes, signature_hex: str,
                           signed_epoch: int, secret: str, now: datetime,
                           expected_organization_id: str,
                           expected_booking_id: str,
                           expected_offer_id: str,
                           snapshot_key: str, offer_link_key: str) -> PathwayFixture:
    """Signature covers domain + UTC epoch + original bytes, no canonical reencoding."""
    if not isinstance(payload, bytes) or not 0 < len(payload) <= 16384:
        raise EvidenceRejected("PAYLOAD_SIZE")
    if not isinstance(secret, str) or len(secret.encode("utf-8")) < 16:
        raise EvidenceRejected("MISSING_FIXTURE_KEY")
    if not isinstance(signature_hex, str) or not re.fullmatch("[a-fA-F0-9]{64}",signature_hex):
        raise EvidenceRejected("INVALID_SIGNATURE")
    if type(signed_epoch) is not int or not isinstance(now,datetime) or now.tzinfo is None:
        raise EvidenceRejected("INVALID_TIMESTAMP")
    try:
        signed_at=datetime.fromtimestamp(signed_epoch,timezone.utc)
    except (OverflowError,ValueError,OSError):
        raise EvidenceRejected("INVALID_TIMESTAMP") from None
    if abs((now.astimezone(timezone.utc)-signed_at).total_seconds()) > 300:
        raise EvidenceRejected("SIGNATURE_REPLAY_WINDOW")
    mac=hmac.new(secret.encode("utf-8"),
                 b"fmc-core-path-fixture-v1." + str(signed_epoch).encode() + b"." + payload,
                 hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature_hex.lower(),mac):
        raise EvidenceRejected("INVALID_SIGNATURE")
    try:
        event=json.loads(payload.decode("utf-8"),object_pairs_hook=_pairs_unique)
    except EvidenceRejected:
        raise
    except (ValueError,UnicodeError,TypeError):
        raise EvidenceRejected("INVALID_JSON") from None
    if not isinstance(event,dict) or set(event)!={
        "schema_version","organization_id","booking_id","offer_id","path_id",
        "event_id","sequence","state","snapshot_key","offer_link_key",
        "prior_event_key","occurred_at"
    } or type(event["schema_version"]) is not int or event["schema_version"]!=1:
        raise EvidenceRejected("SCHEMA_REJECTED")
    ids=("organization_id","booking_id","offer_id","path_id")
    for field in ids:
        event[field]=_as_uuid(event[field])
    if (event["organization_id"]!=_as_uuid(expected_organization_id) or
        event["booking_id"]!=_as_uuid(expected_booking_id) or
        event["offer_id"]!=_as_uuid(expected_offer_id)):
        raise EvidenceRejected("CROSS_TENANT_OR_IDENTITY")
    if (event["snapshot_key"]!=snapshot_key or event["offer_link_key"]!=offer_link_key
        or not re.fullmatch("[a-f0-9]{64}",snapshot_key)
        or not re.fullmatch("[a-f0-9]{64}",offer_link_key)):
        raise EvidenceRejected("EVIDENCE_LINK_MISMATCH")
    if not isinstance(event["event_id"],str) or not re.fullmatch("[A-Za-z0-9:_-]{1,128}",event["event_id"]):
        raise EvidenceRejected("INVALID_EVENT_ID")
    if type(event["sequence"]) is not int or event["sequence"] not in (1,2):
        raise EvidenceRejected("INVALID_SEQUENCE")
    if (event["sequence"],event["state"]) not in ((1,"BOOKING_STARTED"),(2,"BOOKING_CONFIRMED")):
        raise EvidenceRejected("INVALID_STATE")
    parent=event["prior_event_key"]
    if event["sequence"]==1 and parent is not None:
        raise EvidenceRejected("INVALID_PRIOR_LINK")
    if event["sequence"]==2 and (not isinstance(parent,str)
                                 or re.fullmatch("[a-f0-9]{64}",parent) is None):
        raise EvidenceRejected("INVALID_PRIOR_LINK")
    try:
        occurred=datetime.fromisoformat(event["occurred_at"].replace("Z","+00:00"))
    except (ValueError,TypeError,AttributeError):
        raise EvidenceRejected("INVALID_OCCURRED_AT") from None
    if occurred.tzinfo is None or occurred.astimezone(timezone.utc)>signed_at:
        raise EvidenceRejected("INVALID_OCCURRED_AT")
    digest=hashlib.sha256(payload).hexdigest()
    identity="\x1f".join((event["organization_id"],event["path_id"],event["event_id"]))
    return PathwayFixture(
        organization_id=event["organization_id"],booking_id=event["booking_id"],
        offer_id=event["offer_id"],path_id=event["path_id"],event_id=event["event_id"],
        sequence=event["sequence"],state=event["state"],snapshot_key=snapshot_key,
        offer_link_key=offer_link_key,prior_event_key=parent,occurred_at=occurred,
        event_key=hashlib.sha256(identity.encode()).hexdigest(),payload_sha256=digest,
        signature_digest=hashlib.sha256(bytes.fromhex(signature_hex)).hexdigest(),
    )


def record_pathway_fixture(c, *, organization_id: str, booking_id: str,
                           offer_id: str, payload: bytes, signature_hex: str,
                           signed_epoch: int, fixture_secret: str, now: datetime) -> dict:
    """Trusted transaction supplied by test harness; DB serializes on Core booking."""
    booking=one(c.execute(text("""
        select id::text,organization_id::text,status::text,source,updated_at
        from public.bookings where id=cast(:booking as uuid)
          and organization_id=cast(:org as uuid) for update
    """),{"booking":booking_id,"org":organization_id}))
    if not booking or booking["source"] not in ("fmc","getacourt") or booking["status"]!="confirmed":
        raise EvidenceRejected("CORE_AUTHORITY_NOT_CONFIRMED")
    from .revenue_evidence import core_snapshot_key
    snapshot=core_snapshot_key(booking)
    link=one(c.execute(text("""
        select l.event_key, l.offer_id::text, l.booking_snapshot_key
        from public.crm_booking_offer_links_shadow l
        join public.crm_booking_evidence e
          on e.event_key=l.booking_snapshot_key and e.booking_id=l.booking_id
         and e.organization_id=l.organization_id
        where l.organization_id=cast(:org as uuid)
          and l.booking_id=cast(:booking as uuid)
          and l.offer_id=cast(:offer as uuid) and l.booking_snapshot_key=:snapshot
          and l.outcome='observed_match'
    """),{"org":organization_id,"booking":booking_id,"offer":offer_id,"snapshot":snapshot}))
    if not link:
        raise EvidenceRejected("CURRENT_OFFER_LINK_REQUIRED")
    ev=verify_pathway_fixture(
        payload=payload,signature_hex=signature_hex,signed_epoch=signed_epoch,
        secret=fixture_secret,now=now,expected_organization_id=organization_id,
        expected_booking_id=booking_id,expected_offer_id=offer_id,
        snapshot_key=snapshot,offer_link_key=link["event_key"])
    existing=one(c.execute(text("""
        select id::text,event_key,payload_sha256,sequence,state,path_id::text
        from public.crm_core_pathway_fixtures_shadow
        where organization_id=cast(:org as uuid)
          and path_id=cast(:path as uuid) and event_id=:event_id
    """),{"org":organization_id,"path":ev.path_id,"event_id":ev.event_id}))
    if existing:
        if (existing["event_key"]!=ev.event_key or existing["payload_sha256"]!=ev.payload_sha256
            or existing["sequence"]!=ev.sequence or existing["state"]!=ev.state):
            raise EvidenceRejected("EVENT_ID_CONFLICT")
        return {"event_id":existing["id"],"event_key":ev.event_key,
                "new_evidence":False,"fixture_only":True,"causal_evidence_verified":False}
    predecessor=None
    if ev.sequence==1:
        other=c.execute(text("""
           select 1 from public.crm_core_pathway_fixtures_shadow
           where organization_id=cast(:org as uuid) and path_id=cast(:path as uuid)
        """),{"org":organization_id,"path":ev.path_id}).scalar_one_or_none()
        if other:
            raise EvidenceRejected("SEQUENCE_CONFLICT")
    else:
        predecessor=one(c.execute(text("""
           select event_key,occurred_at,offer_id::text
           from public.crm_core_pathway_fixtures_shadow
           where organization_id=cast(:org as uuid) and path_id=cast(:path as uuid)
             and sequence=1 and booking_id=cast(:booking as uuid)
        """),{"org":organization_id,"path":ev.path_id,"booking":booking_id}))
        if not predecessor or predecessor["offer_id"]!=offer_id:
            raise EvidenceRejected("PATH_START_REQUIRED")
        if predecessor["event_key"]!=ev.prior_event_key or predecessor["occurred_at"]>ev.occurred_at:
            raise EvidenceRejected("INVALID_CHAIN_OR_ORDER")
    inserted=one(c.execute(text("""
        insert into public.crm_core_pathway_fixtures_shadow
         (organization_id,booking_id,offer_id,core_snapshot_key,offer_link_event_key,
          path_id,event_id,sequence,state,prior_event_key,event_key,
          payload_sha256,signature_digest,occurred_at,signed_epoch)
        values(cast(:org as uuid),cast(:booking as uuid),cast(:offer as uuid),
               :snapshot,:link,cast(:path as uuid),:event_id,:seq,:state,:prior,
               :event_key,:payload,:signature,:occurred,:epoch)
        returning id::text
    """),{"org":organization_id,"booking":booking_id,"offer":offer_id,
          "snapshot":snapshot,"link":ev.offer_link_key,"path":ev.path_id,
          "event_id":ev.event_id,"seq":ev.sequence,"state":ev.state,
          "prior":ev.prior_event_key,"event_key":ev.event_key,
          "payload":ev.payload_sha256,"signature":ev.signature_digest,
          "occurred":ev.occurred_at,"epoch":signed_epoch}))
    return {"event_id":inserted["id"],"event_key":ev.event_key,
            "new_evidence":True,"fixture_only":True,"causal_evidence_verified":False}


def pathway_readiness(status: str, source: str, paths: list[dict]) -> dict:
    """Readiness describes fixtures, never proven origin or incremental revenue."""
    if status in ("cancelled","failed"):
        reason="BOOKING_NOT_ACTIVE"
    elif status!="confirmed" or source not in ("fmc","getacourt"):
        reason="CORE_AUTHORITY_PENDING"
    elif not paths:
        reason="NO_PATH_FIXTURE"
    else:
        grouped={}
        for r in paths:
            path_id=str(r["path_id"])
            grouped.setdefault(path_id,[]).append(r)
        complete=0
        for records in grouped.values():
            started=next((x for x in records if x["sequence"]==1),None)
            confirmed=next((x for x in records if x["sequence"]==2),None)
            if started and confirmed and (
                confirmed["prior_event_key"]==started["event_key"]
                and confirmed["occurred_at"]>=started["occurred_at"]
                and confirmed["offer_id"]==started["offer_id"]
            ):
                complete+=1
        if complete>1:
            reason="COMPETING_FIXTURE_CHAINS"
        elif complete==1:
            reason="FIXTURE_CHAIN_COMPLETE_NONCAUSAL"
        else:
            reason="INCOMPLETE_FIXTURE"
    return {"readiness":reason,"causal_evidence_verified":False,
            "core_origin_verified":False,"primary_offer_id":None,
            "fee_minor":0,"billable":False,"mode":"shadow"}
