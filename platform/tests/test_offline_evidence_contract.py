import hashlib
import hmac
import json
import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from fmc.offline_evidence import (
    EvidenceRejected, verify_offline_provider_event, replay_decision,
    build_shadow_offer_link,
)


ORG, CONN = str(uuid.uuid4()), str(uuid.uuid4())
NOW = datetime(2026, 10, 15, tzinfo=timezone.utc)
EPOCH = int(NOW.timestamp())
SECRET = "fixture-key-long-enough-for-hmac-v1"


def body(**changes):
    obj = dict(schema_version=1, organization_id=ORG, connection_id=CONN,
               provider="playtomic", event_id="event-123", sequence=7,
               booking_reference="ext-booking-23", state="confirmed",
               occurred_at="2026-10-14T23:59:55Z")
    obj.update(changes)
    return json.dumps(obj, separators=(",", ":")).encode()


def check(payload=None, *, epoch=EPOCH, signature=None, **kwargs):
    payload = body() if payload is None else payload
    signature = signature or hmac.new(
        SECRET.encode(), str(epoch).encode() + b"." + payload,
        hashlib.sha256).hexdigest()
    return verify_offline_provider_event(
        payload=payload, signature_hex=signature, signed_epoch=epoch,
        secret=SECRET, expected_organization_id=ORG,
        expected_connection_id=CONN, expected_provider="playtomic",
        now=NOW, **kwargs,
    )


def test_signed_fixture_is_normalized_but_not_causal():
    e = check()
    assert e.organization_id == ORG and e.connection_id == CONN
    assert e.sequence == 7 and e.provider == "playtomic"
    assert len(e.event_key) == len(e.payload_sha256) == 64
    assert e.event_key == check().event_key
    assert replay_decision(e, previous_event=None, last_sequence=6) == "accepted_shadow"
    assert replay_decision(e, previous_event=e, last_sequence=7) == "duplicate"
    assert replay_decision(replace(e, payload_sha256="0" * 64),
                           previous_event=e, last_sequence=7) == "event_id_conflict"
    assert replay_decision(replace(e, event_key="other", sequence=6),
                           previous_event=e, last_sequence=7) == "stale_or_reordered"


@pytest.mark.parametrize("changed", [
    {"organization_id": str(uuid.uuid4())},
    {"connection_id": str(uuid.uuid4())},
    {"provider": "wrong"},
    {"sequence": 0}, {"sequence": True},
    {"state": "paid"}, {"event_id": "../bad"},
    {"schema_version": 2},
    {"occurred_at": "invalid"},
    {"occurred_at": "2026-10-15T00:01:00Z"},
    {"booking_reference": ""},
    {"new_field": "unexpected"},
])
def test_bad_signed_payloads_fail_closed(changed):
    with pytest.raises(EvidenceRejected):
        check(body(**changed))


def test_signature_tamper_expiry_replay_and_duplicates():
    payload = body()
    valid = hmac.new(SECRET.encode(), str(EPOCH).encode() + b"." + payload,
                     hashlib.sha256).hexdigest()
    with pytest.raises(EvidenceRejected, match="INVALID_SIGNATURE"):
        check(payload + b" ", signature=valid)
    with pytest.raises(EvidenceRejected, match="EXPIRED"):
        check(epoch=EPOCH - 301)
    with pytest.raises(EvidenceRejected, match="EXPIRED"):
        check(epoch=EPOCH + 301)
    with pytest.raises(EvidenceRejected, match="PAYLOAD_SIZE"):
        check(payload=b"x" * 131073)
    duplicate = payload[:-1] + b',"event_id":"duplicate"}'
    with pytest.raises(EvidenceRejected, match="DUPLICATE_JSON_KEY"):
        check(duplicate)
    with pytest.raises(EvidenceRejected, match="KEY_NOT_CONFIGURED"):
        verify_offline_provider_event(
            payload=payload, signature_hex=valid, signed_epoch=EPOCH,
            secret="weak", expected_organization_id=ORG,
            expected_connection_id=CONN, expected_provider="playtomic", now=NOW)


def link_fixture(**booking_changes):
    start = datetime(2026, 10, 15, 18, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    booking = dict(id=str(uuid.uuid4()), organization_id=ORG,
                   court_id=str(uuid.uuid4()), starts_at=start,
                   ends_at=end, currency="EUR", source="getacourt",
                   status="confirmed")
    booking.update(booking_changes)
    offer = dict(id=str(uuid.uuid4()), organization_id=ORG,
                 target_court_id=booking["court_id"],
                 target_starts_at=start, target_ends_at=end,
                 currency="EUR", tracking_token="crm_123456789")
    return booking, offer


def test_offer_shadow_proof_is_non_billable_even_with_exact_token():
    booking, offer = link_fixture()
    observed = build_shadow_offer_link(booking, offer, "crm_123456789", "a" * 64)
    assert observed["outcome"] == "observed_match"
    assert observed["causal_evidence_verified"] is False
    assert observed["billable"] is False and observed["fee_minor"] == 0
    assert observed["event_key"] == build_shadow_offer_link(booking,offer,"crm_123456789","a"*64)["event_key"]
    for source, status in [("playtomic", "confirmed"), ("getacourt", "cancelled"),
                           ("getacourt", "failed")]:
        changed = {**booking, "source":source, "status":status}
        assert build_shadow_offer_link(changed, offer,"crm_123456789","a"*64)["outcome"] == "ambiguous"


def test_cross_tenant_token_slot_and_currency_protection():
    b, o = link_fixture()
    for changes, expected in [
        ({"organization_id":str(uuid.uuid4())}, "CROSS_TENANT"),
        ({"court_id":str(uuid.uuid4())}, "SLOT_MISMATCH"),
        ({"starts_at":b["starts_at"]+timedelta(minutes=5)}, "SLOT_MISMATCH"),
        ({"currency":"USD"}, "CURRENCY_MISMATCH"),
    ]:
        with pytest.raises(EvidenceRejected, match=expected):
            build_shadow_offer_link({**b, **changes},o,"crm_123456789","a"*64)
    with pytest.raises(EvidenceRejected, match="TOKEN_MISMATCH"):
        build_shadow_offer_link(b,o,"wrong","a"*64)
    with pytest.raises(EvidenceRejected, match="BOOKING_SNAPSHOT_REQUIRED"):
        build_shadow_offer_link(b,o,"crm_123456789","unknown")
