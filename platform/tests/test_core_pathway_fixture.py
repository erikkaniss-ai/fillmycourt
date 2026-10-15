import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone, timedelta

import pytest

from fmc.core_pathway_fixture import verify_pathway_fixture,pathway_readiness
from fmc.offline_evidence import EvidenceRejected

ORG, BOOK, OFFER, PATH = (str(uuid.uuid4()) for _ in range(4))
SNAP = "a"*64
LINK = "b"*64
SECRET="fmc-F10-offline-fixture-secret"
NOW=datetime(2026,10,15,1,1,30,tzinfo=timezone.utc)


def payload(*,seq=1,parent=None,organization=ORG,booking=BOOK,
            offer=OFFER,occurred=None,state=None):
    data=dict(schema_version=1,organization_id=organization,booking_id=booking,
              offer_id=offer,path_id=PATH,event_id=f"fixture-{seq}",sequence=seq,
              state=state or ("BOOKING_STARTED" if seq==1 else "BOOKING_CONFIRMED"),
              snapshot_key=SNAP,offer_link_key=LINK,prior_event_key=parent,
              occurred_at=(occurred or NOW).isoformat())
    return json.dumps(data).encode()


def check(data=None, *,epoch=None,sig=None,**kwargs):
    data=data if data is not None else payload()
    epoch=int(NOW.timestamp()) if epoch is None else epoch
    sig=sig or hmac.new(SECRET.encode(),b"fmc-core-path-fixture-v1."+
         str(epoch).encode()+b"."+data,hashlib.sha256).hexdigest()
    return verify_pathway_fixture(
      payload=data,signature_hex=sig,signed_epoch=epoch,secret=SECRET,
      now=NOW,expected_organization_id=kwargs.get("organization",ORG),
      expected_booking_id=BOOK,expected_offer_id=OFFER,
      snapshot_key=SNAP,offer_link_key=LINK)


def test_f10_signature_and_strict_identity():
    ev=check()
    assert ev.sequence==1 and ev.state=="BOOKING_STARTED"
    assert len(ev.event_key)==64 and ev.payload_sha256==hashlib.sha256(payload()).hexdigest()
    for data,reason in [
      (payload(organization=str(uuid.uuid4())),"CROSS_TENANT_OR_IDENTITY"),
      (payload(booking=str(uuid.uuid4())),"CROSS_TENANT_OR_IDENTITY"),
      (payload(offer=str(uuid.uuid4())),"CROSS_TENANT_OR_IDENTITY"),
      (payload(seq=2,parent=None),"INVALID_PRIOR_LINK"),
      (payload(seq=1,parent="c"*64),"INVALID_PRIOR_LINK"),
      (payload(seq=True),"INVALID_SEQUENCE"),
      (payload(state="PAID"),"INVALID_STATE"),
      (payload(occurred=NOW+timedelta(seconds=2)),"INVALID_OCCURRED_AT"),
    ]:
       with pytest.raises(EvidenceRejected,match=reason):
           check(data)
    with pytest.raises(EvidenceRejected,match="INVALID_SIGNATURE"):
       check(payload()+b" ",sig=hmac.new(SECRET.encode(),b"fmc-core-path-fixture-v1."+
             str(int(NOW.timestamp())).encode()+b"."+payload(),hashlib.sha256).hexdigest())
    with pytest.raises(EvidenceRejected,match="SIGNATURE_REPLAY_WINDOW"):
       check(epoch=int(NOW.timestamp())-301)
    dup=payload()[:-1]+b',"sequence":1}'
    with pytest.raises(EvidenceRejected,match="DUPLICATE_JSON_KEY"):
       check(dup)


def test_f10_complete_chain_remains_noncausal():
    a=dict(path_id=PATH,offer_id=OFFER,sequence=1,event_key="x"*64,
           prior_event_key=None,occurred_at=NOW)
    b=dict(path_id=PATH,offer_id=OFFER,sequence=2,event_key="y"*64,
           prior_event_key="x"*64,occurred_at=NOW+timedelta(seconds=1))
    assert pathway_readiness("confirmed","getacourt",[])["readiness"]=="NO_PATH_FIXTURE"
    assert pathway_readiness("confirmed","getacourt",[a])["readiness"]=="INCOMPLETE_FIXTURE"
    full=pathway_readiness("confirmed","getacourt",[a,b])
    assert full["readiness"]=="FIXTURE_CHAIN_COMPLETE_NONCAUSAL"
    assert not full["billable"] and not full["core_origin_verified"] and not full["causal_evidence_verified"]
    other=[{**a,"path_id":str(uuid.uuid4())},{**b,"path_id":str(uuid.uuid4())}]
    # Different path ids for each step cannot form a separate valid chain.
    assert pathway_readiness("confirmed","getacourt",[a,b,*other])["readiness"]=="FIXTURE_CHAIN_COMPLETE_NONCAUSAL"
    q=str(uuid.uuid4())
    both=pathway_readiness("confirmed","getacourt",[a,b,{**a,"path_id":q},{**b,"path_id":q}])
    assert both["readiness"]=="COMPETING_FIXTURE_CHAINS"
    assert pathway_readiness("cancelled","getacourt",[a,b])["readiness"]=="BOOKING_NOT_ACTIVE"
