import hashlib
import hmac
from datetime import datetime, timezone

from fmc.revenue_evidence import verify_provider_signature, core_snapshot_key, core_maturity


def test_signature_must_be_verified_before_external_adapter_normalization():
    secret = "test-secret-only"
    payload = b'{"event":"confirmed"}'
    signed = hmac.new(secret.encode(),payload,hashlib.sha256).hexdigest()
    assert verify_provider_signature(payload,signed,secret)
    assert not verify_provider_signature(payload+b"x",signed,secret)
    assert not verify_provider_signature(payload,"bad",secret)
    assert not verify_provider_signature(payload,signed,"")
    

def test_core_snapshot_idempotent_key_uses_authority_version():
    book = {"id":"booking-1","status":"confirmed","source":"getacourt",
            "updated_at":datetime(2026,10,14,tzinfo=timezone.utc)}
    assert core_snapshot_key(book)==core_snapshot_key(dict(book))
    assert core_snapshot_key(book)!=core_snapshot_key({**book,"status":"cancelled"})
    assert core_snapshot_key(book)!=core_snapshot_key({**book,"source":"manual"})


def test_unknown_external_authority_does_not_finalize():
    assert core_maturity("confirmed","playtomic") == "pending_evidence"
    assert core_maturity("confirmed","getacourt") == "provisional"
    assert core_maturity("confirmed","manual") == "pending_evidence"
    assert core_maturity("cancelled","getacourt") == "unverified"
