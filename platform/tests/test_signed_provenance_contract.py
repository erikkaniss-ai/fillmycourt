import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone, timedelta

import pytest

from fmc.offline_evidence import EvidenceRejected, verify_offline_provider_event
from fmc.reconciliation_maturity import reconcile_shadow

def test_previously_suspect_shadow_receipt_never_claims_causal_credit():
    r = reconcile_shadow("confirmed","playtomic","confirmed")
    assert r.maturity=="pending_evidence"
    assert r.billable is False and r.fee_minor==0
    assert not r.causal_evidence_verified

def test_signed_source_fails_untrusted_org_and_replay():
    org=str(uuid.uuid4())
    conn=str(uuid.uuid4())
    now=datetime(2026,10,15,1,0,tzinfo=timezone.utc)
    t=int(now.timestamp())
    doc={"schema_version":1,"organization_id":org,"connection_id":conn,
         "provider":"playtomic","event_id":"evt-1","sequence":1,
         "booking_reference":"ext-1","state":"confirmed",
         "occurred_at":now.isoformat()}
    payload=json.dumps(doc).encode()
    secret="fixture-secret-long-enough"
    sig=hmac.new(secret.encode(),str(t).encode()+b"."+payload,hashlib.sha256).hexdigest()
    def call(**override):
        return verify_offline_provider_event(
            payload=override.get("payload",payload),
            signature_hex=override.get("signature_hex",sig),
            signed_epoch=override.get("signed_epoch",t),
            secret=secret,
            expected_organization_id=override.get("expected_organization_id",org),
            expected_connection_id=conn,expected_provider="playtomic",
            now=now)
    assert call().event_id=="evt-1"
    with pytest.raises(EvidenceRejected,match="TENANT_OR_SOURCE_MISMATCH"):
        call(expected_organization_id=str(uuid.uuid4()))
    with pytest.raises(EvidenceRejected,match="INVALID_SIGNATURE"):
        call(payload=payload+b" ")
    with pytest.raises(EvidenceRejected,match="EXPIRED_OR_FUTURE_SIGNATURE"):
        call(signed_epoch=t-301)
