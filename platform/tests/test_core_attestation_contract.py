import hashlib
import json
import uuid
from datetime import datetime,timedelta,timezone

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

from fmc.core_attestation_contract import (
    DOMAIN,verify_core_attestation_fixture,core_attestation_readiness,
)
from fmc.offline_evidence import EvidenceRejected

NOW=datetime(2026,10,15,1,20,tzinfo=timezone.utc)
ORG,BOOK,ISSUER=(str(uuid.uuid4()) for _ in range(3))
SNAP="a"*64
VERSION=datetime(2026,10,15,1,0,tzinfo=timezone.utc)

def make_data(*,org=ORG,booking=BOOK,issuer=ISSUER,status="confirmed",
              source="getacourt",occurred=NOW,expires=None,event_id=None,key_id=None):
    return dict(schema_version=1,issuer="fmc-core-fixture",
                issuer_instance_id=issuer,key_id=key_id,
                organization_id=org,booking_id=booking,event_id=event_id or str(uuid.uuid4()),
                booking_source=source,booking_status=status,
                booking_updated_at=VERSION.isoformat(),core_snapshot_key=SNAP,
                occurred_at=occurred.isoformat(),
                expires_at=(expires or occurred+timedelta(minutes=2)).isoformat())

def setup():
    key=Ed25519PrivateKey.generate()
    pub=key.public_key().public_bytes(encoding=serialization.Encoding.Raw,
                                      format=serialization.PublicFormat.Raw)
    return key,pub,hashlib.sha256(pub).hexdigest()

def verify(data,key,pub,fingerprint,*,payload=None,sig=None,now=NOW):
    raw=payload or json.dumps(data).encode()
    signature=sig or key.sign(DOMAIN+raw)
    return verify_core_attestation_fixture(
        payload=raw,signature=signature,public_key_bytes=pub,
        now=now,expected_organization_id=ORG,expected_booking_id=BOOK,
        expected_issuer_instance_id=ISSUER,expected_key_id=fingerprint,
        expected_snapshot_key=SNAP,expected_booking_updated_at=VERSION)

def test_valid_crypto_does_not_claim_real_core_origin_or_caused_booking():
    key,pub,kid=setup()
    result=verify(make_data(key_id=kid),key,pub,kid)
    assert result.organization_id==ORG and result.booking_id==BOOK
    assert result.booking_status=="confirmed"
    readiness=core_attestation_readiness({"status":"confirmed","source":"getacourt"},[{"id":"fixture"}])
    assert readiness["readiness"]=="CRYPTOGRAPHIC_FIXTURE_VALID_CORE_ORIGIN_UNTRUSTED"
    assert not readiness["trusted_core_issuer_configured"]
    assert not readiness["core_origin_verified"] and not readiness["causal_evidence_verified"]
    assert readiness["fee_minor"]==0 and readiness["billable"] is False

@pytest.mark.parametrize("field,value,reason",[
 ("organization_id",str(uuid.uuid4()),"SOURCE_OR_TENANT_MISMATCH"),
 ("booking_id",str(uuid.uuid4()),"SOURCE_OR_TENANT_MISMATCH"),
 ("issuer_instance_id",str(uuid.uuid4()),"SOURCE_OR_TENANT_MISMATCH"),
 ("booking_source","playtomic","NON_NATIVE_OR_UNCONFIRMED"),
 ("booking_status","cancelled","NON_NATIVE_OR_UNCONFIRMED"),
 ("core_snapshot_key","b"*64,"CORE_SNAPSHOT_MISMATCH"),
 ("booking_updated_at",datetime(2026,10,15,0,0,tzinfo=timezone.utc).isoformat(),"STALE_BOOKING_VERSION"),
])
def test_source_and_version_protection(field,value,reason):
    key,pub,kid=setup()
    data=make_data(key_id=kid)
    data[field]=value
    with pytest.raises(EvidenceRejected,match=reason):
        verify(data,key,pub,kid)

def test_signature_replay_expiry_rotation_and_duplicate_json():
    key,pub,kid=setup()
    data=make_data(key_id=kid)
    raw=json.dumps(data).encode()
    sig=key.sign(DOMAIN+raw)
    assert verify(data,key,pub,kid,sig=sig).key_id==kid
    with pytest.raises(EvidenceRejected,match="INVALID_SIGNATURE"):
        verify(data,key,pub,kid,payload=raw+b" ",sig=sig)
    other,other_pub,other_id=setup()
    with pytest.raises(EvidenceRejected,match="KEY_FINGERPRINT_MISMATCH"):
        verify(data,key,pub,other_id)
    with pytest.raises(EvidenceRejected,match="INVALID_SIGNATURE"):
        verify(data,key,other_pub,other_id,sig=sig)
    data["expires_at"]=(NOW-timedelta(seconds=1)).isoformat()
    with pytest.raises(EvidenceRejected,match="ATTESTATION_EXPIRED_OR_FUTURE"):
        verify(data,key,pub,kid)
    dup=raw[:-1]+b',"booking_id":"'+BOOK.encode()+b'"}'
    with pytest.raises(EvidenceRejected,match="DUPLICATE_JSON_KEY"):
        verify(data,key,pub,kid,payload=dup,sig=key.sign(DOMAIN+dup))

def test_unknown_event_or_future_not_promoted():
    assert core_attestation_readiness({"status":"confirmed","source":"getacourt"},[])["readiness"]=="NO_ATTESTATION_EVIDENCE"
    assert core_attestation_readiness({"status":"cancelled","source":"getacourt"},[{}])["readiness"]=="BOOKING_NOT_ACTIVE"
    assert core_attestation_readiness({"status":"confirmed","source":"playtomic"},[{}])["readiness"]=="CORE_AUTHORITY_PENDING"
