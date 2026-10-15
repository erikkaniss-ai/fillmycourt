"""FMC-REV-F11: offline Ed25519 verification of Core-shaped event attestations.

This verifier contains NO private key, signing function, live Core publisher,
webhook ingress, provider connector, booking writer, or money movement.
The registry permits fixture_only keys ONLY. Valid cryptographic signatures
from fixture keys must NEVER be represented as real Core-origin proof.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import uuid

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from sqlalchemy import text

from .offline_evidence import EvidenceRejected, _pairs_unique
from .supabase_v1 import one


DOMAIN = b"FMC.CORE.ATTESTATION.FIXTURE.V1\x00"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


def _uuid(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise EvidenceRejected("INVALID_ID") from None


def _datetime(value):
    if not isinstance(value, str):
        raise EvidenceRejected("INVALID_TIME")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise EvidenceRejected("INVALID_TIME") from None
    if dt.tzinfo is None:
        raise EvidenceRejected("INVALID_TIME")
    return dt.astimezone(timezone.utc)


@dataclass(frozen=True)
class CoreAttestationFixture:
    organization_id: str
    booking_id: str
    event_id: str
    issuer_instance_id: str
    key_id: str
    booking_source: str
    booking_status: str
    booking_updated_at: datetime
    core_snapshot_key: str
    occurred_at: datetime
    expires_at: datetime
    event_key: str
    payload_sha256: str
    signature_sha256: str


def verify_core_attestation_fixture(*, payload: bytes, signature: bytes,
                                    public_key_bytes: bytes, now: datetime,
                                    expected_organization_id: str,
                                    expected_booking_id: str,
                                    expected_issuer_instance_id: str,
                                    expected_key_id: str,
                                    expected_snapshot_key: str,
                                    expected_booking_updated_at: datetime
                                    ) -> CoreAttestationFixture:
    """Strict canonical source-bound payload; no key/private material is emitted."""
    if not isinstance(payload, bytes) or not 0 < len(payload) <= 16384:
        raise EvidenceRejected("PAYLOAD_SIZE")
    if not isinstance(signature, bytes) or len(signature) != 64:
        raise EvidenceRejected("INVALID_SIGNATURE")
    if not isinstance(public_key_bytes, bytes) or len(public_key_bytes) != 32:
        raise EvidenceRejected("INVALID_PUBLIC_KEY")
    fingerprint = hashlib.sha256(public_key_bytes).hexdigest()
    if not isinstance(expected_key_id, str) or fingerprint != expected_key_id:
        raise EvidenceRejected("KEY_FINGERPRINT_MISMATCH")
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise EvidenceRejected("INVALID_TIME")
    try:
        Ed25519PublicKey.from_public_bytes(public_key_bytes).verify(signature, DOMAIN + payload)
    except (InvalidSignature, ValueError, TypeError):
        raise EvidenceRejected("INVALID_SIGNATURE") from None
    try:
        body = json.loads(payload.decode("utf-8"), object_pairs_hook=_pairs_unique)
    except EvidenceRejected:
        raise
    except (ValueError, UnicodeError):
        raise EvidenceRejected("INVALID_JSON") from None
    keys={"schema_version","issuer","issuer_instance_id","key_id",
          "organization_id","booking_id","event_id","booking_source",
          "booking_status","booking_updated_at","core_snapshot_key",
          "occurred_at","expires_at"}
    if not isinstance(body, dict) or set(body)!=keys or type(body["schema_version"]) is not int or body["schema_version"]!=1:
        raise EvidenceRejected("UNSUPPORTED_SCHEMA")
    if body["issuer"] != "fmc-core-fixture":
        raise EvidenceRejected("UNTRUSTED_ISSUER")
    instance=_uuid(body["issuer_instance_id"])
    org=_uuid(body["organization_id"])
    booking=_uuid(body["booking_id"])
    event_id=_uuid(body["event_id"])
    if (instance!=_uuid(expected_issuer_instance_id)
        or org!=_uuid(expected_organization_id)
        or booking!=_uuid(expected_booking_id)):
        raise EvidenceRejected("SOURCE_OR_TENANT_MISMATCH")
    if body["key_id"] != fingerprint:
        raise EvidenceRejected("KEY_FINGERPRINT_MISMATCH")
    if not isinstance(body["core_snapshot_key"],str) or HEX64.fullmatch(body["core_snapshot_key"]) is None or body["core_snapshot_key"]!=expected_snapshot_key:
        raise EvidenceRejected("CORE_SNAPSHOT_MISMATCH")
    if body["booking_source"] not in ("fmc","getacourt") or body["booking_status"]!="confirmed":
        raise EvidenceRejected("NON_NATIVE_OR_UNCONFIRMED")
    updated=_datetime(body["booking_updated_at"])
    if not isinstance(expected_booking_updated_at,datetime) or expected_booking_updated_at.tzinfo is None or updated!=expected_booking_updated_at.astimezone(timezone.utc):
        raise EvidenceRejected("STALE_BOOKING_VERSION")
    occurred=_datetime(body["occurred_at"])
    expires=_datetime(body["expires_at"])
    now_utc=now.astimezone(timezone.utc)
    if (expires<=occurred or expires-occurred>timedelta(minutes=5)
        or now_utc<occurred-timedelta(seconds=30)
        or now_utc>=expires):
        raise EvidenceRejected("ATTESTATION_EXPIRED_OR_FUTURE")
    identity="\x1f".join((org,instance,event_id))
    return CoreAttestationFixture(
        organization_id=org,booking_id=booking,event_id=event_id,
        issuer_instance_id=instance,key_id=fingerprint,
        booking_source=body["booking_source"],
        booking_status=body["booking_status"],
        booking_updated_at=updated,
        core_snapshot_key=body["core_snapshot_key"],
        occurred_at=occurred,expires_at=expires,
        event_key=hashlib.sha256(identity.encode()).hexdigest(),
        payload_sha256=hashlib.sha256(payload).hexdigest(),
        signature_sha256=hashlib.sha256(signature).hexdigest())


def record_core_attestation_fixture(c, *, organization_id: str, booking_id: str,
                                    issuer_instance_id: str, key_id: str,
                                    payload: bytes, signature: bytes,
                                    now: datetime) -> dict:
    """Test-harness-only trusted transaction. Registry cannot grant live trust."""
    booking=one(c.execute(text("""
        select id::text,organization_id::text,status::text,source,updated_at
        from public.bookings where organization_id=cast(:org as uuid)
          and id=cast(:booking as uuid) for update
    """),{"org":organization_id,"booking":booking_id}))
    if not booking or booking["status"]!="confirmed" or booking["source"] not in ("fmc","getacourt"):
        raise EvidenceRejected("CORE_AUTHORITY_NOT_CONFIRMED")
    root=one(c.execute(text("""
        select id::text,organization_id::text,issuer_instance_id::text,key_id,
               public_key_hex,valid_from,valid_until
        from public.crm_core_attestation_fixture_keys
        where organization_id=cast(:org as uuid)
          and issuer_instance_id=cast(:issuer as uuid) and key_id=:key_id
          and trust_mode='fixture_only'
    """),{"org":organization_id,"issuer":issuer_instance_id,"key_id":key_id}))
    if not root:
        raise EvidenceRejected("UNREGISTERED_FIXTURE_KEY")
    from .revenue_evidence import core_snapshot_key
    snapshot=core_snapshot_key(booking)
    ev=verify_core_attestation_fixture(
        payload=payload,signature=signature,
        public_key_bytes=bytes.fromhex(root["public_key_hex"]),
        now=now,expected_organization_id=organization_id,
        expected_booking_id=booking_id,
        expected_issuer_instance_id=issuer_instance_id,
        expected_key_id=key_id,expected_snapshot_key=snapshot,
        expected_booking_updated_at=booking["updated_at"])
    if not (root["valid_from"]<=ev.occurred_at<root["valid_until"]):
        raise EvidenceRejected("FIXTURE_KEY_OUTSIDE_VALIDITY")
    existing=one(c.execute(text("""
        select id::text,payload_sha256,signature_sha256,event_key
        from public.crm_core_attestation_checks_shadow
        where organization_id=cast(:org as uuid)
          and issuer_instance_id=cast(:issuer as uuid)
          and event_id=cast(:event as uuid)
    """),{"org":organization_id,"issuer":issuer_instance_id,"event":ev.event_id}))
    if existing:
        if (existing["payload_sha256"]!=ev.payload_sha256
            or existing["signature_sha256"]!=ev.signature_sha256
            or existing["event_key"]!=ev.event_key):
            raise EvidenceRejected("EVENT_ID_CONFLICT")
        return {"attestation_id":existing["id"],"new_evidence":False,
                "cryptographic_fixture_valid":True,
                "core_origin_verified":False,"causal_evidence_verified":False,
                "billable":False,"fee_minor":0}
    inserted=one(c.execute(text("""
        insert into public.crm_core_attestation_checks_shadow
          (organization_id,booking_id,fixture_key_id,issuer_instance_id,event_id,
           event_key,core_snapshot_key,booking_status,booking_source,
           booking_updated_at,occurred_at,expires_at,
           payload_sha256,signature_sha256)
        values(cast(:org as uuid),cast(:booking as uuid),cast(:key as uuid),
               cast(:issuer as uuid),cast(:event as uuid),:event_key,:snapshot,
               :status,:source,:updated,:occurred,:expires,:payload,:signature)
        returning id::text
    """),{"org":organization_id,"booking":booking_id,"key":root["id"],
          "issuer":issuer_instance_id,"event":ev.event_id,
          "event_key":ev.event_key,"snapshot":snapshot,
          "status":ev.booking_status,"source":ev.booking_source,
          "updated":ev.booking_updated_at,"occurred":ev.occurred_at,
          "expires":ev.expires_at,"payload":ev.payload_sha256,
          "signature":ev.signature_sha256}))
    return {"attestation_id":inserted["id"],"new_evidence":True,
            "cryptographic_fixture_valid":True,
            "core_origin_verified":False,"causal_evidence_verified":False,
            "billable":False,"fee_minor":0}


def core_attestation_readiness(booking: dict, evidence: list[dict]) -> dict:
    """Never promote test signatures to actual Core-origin or financial authority."""
    if booking["status"] in ("cancelled","failed"):
        state="BOOKING_NOT_ACTIVE"
    elif booking["status"]!="confirmed" or booking["source"] not in ("fmc","getacourt"):
        state="CORE_AUTHORITY_PENDING"
    elif evidence:
        state="CRYPTOGRAPHIC_FIXTURE_VALID_CORE_ORIGIN_UNTRUSTED"
    else:
        state="NO_ATTESTATION_EVIDENCE"
    return {"readiness":state,"fixture_count":len(evidence),
            "trusted_core_issuer_configured":False,"core_origin_verified":False,
            "causal_evidence_verified":False,"primary_offer_id":None,
            "billable":False,"fee_minor":0,"mode":"shadow"}
