"""Official Playtomic club-read worker: one provider page per durable lease.

No real Playtomic API, player account, live club credential or booking write.
"""
from __future__ import annotations
from datetime import datetime, timezone
import uuid
import os

import pytest
from sqlalchemy import text
from fmc.supabase_v1 import V1Store
from fmc.provider_page_budget import read_page_state, next_page_state, PageBudgetError
from fmc.common import DomainError


def test_page_cursor_offset_and_window_are_bounded():
    payload={"provider_connection_id":str(uuid.uuid4()),"stream":"bookings"}
    start="2026-10-20T00:00:00Z"; end="2026-10-21T00:00:00Z"
    one=read_page_state(payload,start,end)
    assert one=={"page":0,"cursor":None,"window_start":start,"window_end":end}
    two=next_page_state(one,{"has_more":True,"next_cursor":None,"records":[{"external_id":"fixture-1"}]})
    assert two["page"]==1
    assert two["cursor"] is None
    assert two["window_start"]==start
    assert next_page_state(two,{"has_more":False,"next_cursor":None,"records":[]}) is None
    for bad in [{"page":49,"cursor":None,"window_start":start,"window_end":end},
                {"page":-1,"cursor":None,"window_start":start,"window_end":end},
                {"page":True,"cursor":None,"window_start":start,"window_end":end},
                {"page":0,"cursor":None,"window_start":start,"window_end":"bad"}]:
        with pytest.raises(PageBudgetError):
            read_page_state({"progress":bad},start,end)


def test_nonbookings_and_untrusted_cursor_fails_closed():
    fixture={"page":0,"cursor":None,"window_start":"2026-10-20T00:00:00Z","window_end":"2026-10-21T00:00:00Z"}
    with pytest.raises(PageBudgetError):
        read_page_state({"progress":{**fixture,"window_end":"2026-10-22T00:00:00Z"}},fixture["window_start"],fixture["window_end"])
    with pytest.raises(PageBudgetError):
        next_page_state(fixture,{"has_more":True,"next_cursor":"https://provider.invalid","records":[]})
    with pytest.raises(PageBudgetError):
        next_page_state(fixture,{"has_more":"true","next_cursor":None,"records":[]})
    with pytest.raises(PageBudgetError):
        next_page_state(fixture,{"has_more":True,"next_cursor":None,"records":None})


@pytest.fixture
def store():
    url=os.getenv("TEST_DATABASE_URL")
    if not url:pytest.skip("Postgres16 CI only")
    return V1Store(url)


def test_shared_connection_rate_reservation_persists_across_jobs(store):
    """Two sync streams sharing one connection must not each call immediately."""
    org=str(uuid.uuid4()); pc=str(uuid.uuid4())
    with store.trusted() as c:
        c.execute(text("insert into public.organizations(id,slug,name) values(cast(:org as uuid),:slug,'CI rate org')"),
                  {"org":org,"slug":"rate-"+org[:8]})
        c.execute(text("insert into public.provider_connections(id,organization_id,provider,status) values(cast(:pc as uuid),cast(:org as uuid),'playtomic','configured')"),
                  {"pc":pc,"org":org})
    assert store.reserve_provider_request(pc)==0
    wait=store.reserve_provider_request(pc)
    assert 1<=wait<=60
    with store.trusted() as c:
        row=c.execute(text("select next_allowed_at>now() from public.provider_request_windows where provider_connection_id=cast(:pc as uuid)"),{"pc":pc}).scalar_one()
        assert row is True


def test_durable_job_checkpoint_does_not_consume_retry_budget(store):
    org=str(uuid.uuid4()); job_id=str(uuid.uuid4()); lease=str(uuid.uuid4())
    with store.trusted() as c:
        c.execute(text("insert into public.organizations(id,slug,name) values(cast(:org as uuid),:slug,'CI checkpoint org')"),
                  {"org":org,"slug":"chk-"+org[:8]})
        c.execute(text("""
            insert into public.jobs(id,organization_id,kind,dedupe_key,payload,status,attempts,lease_token,lease_until)
            values(cast(:id as uuid),cast(:org as uuid),'sync_bookings','ci-checkpoint','{}'::jsonb,
                  'leased',2,cast(:lease as uuid),now()+interval '45 seconds')
        """),{"id":job_id,"org":org,"lease":lease})
        payload={"provider_connection_id":"fixture","stream":"bookings",
                 "progress":{"page":1,"cursor":None,"window_start":"2026-10-20T00:00:00Z","window_end":"2026-10-21T00:00:00Z"}}
        store.checkpoint_provider_job(c,job_id,lease,payload,delay_seconds=60)
    with store.trusted() as c:
        r=c.execute(text("select status,attempts,payload,lease_token,due_at>now() as future from public.jobs where id=cast(:id as uuid)"),
                    {"id":job_id}).mappings().one()
        assert r["status"]=="queued"
        assert r["attempts"]==1
        assert r["payload"]["progress"]["page"]==1
        assert r["lease_token"] is None
        assert r["future"] is True
    with pytest.raises(DomainError):
        with store.trusted() as c:
            store.checkpoint_provider_job(c,job_id,lease,{"wrong":True},delay_seconds=60)


def test_checkpoint_transaction_rollback_does_not_advance_cursor(store):
    org=str(uuid.uuid4()); job_id=str(uuid.uuid4()); lease=str(uuid.uuid4())
    with store.trusted() as c:
        c.execute(text("insert into public.organizations(id,slug,name) values(cast(:org as uuid),:slug,'CI rollback org')"),
                  {"org":org,"slug":"roll-"+org[:8]})
        c.execute(text("""
            insert into public.jobs(id,organization_id,kind,dedupe_key,payload,status,attempts,lease_token,lease_until)
            values(cast(:id as uuid),cast(:org as uuid),'sync_bookings','ci-rollback','{}'::jsonb,
                'leased',1,cast(:lease as uuid),now()+interval '45 seconds')
        """),{"id":job_id,"org":org,"lease":lease})
    with pytest.raises(RuntimeError):
        with store.trusted() as c:
            store.checkpoint_provider_job(c,job_id,lease,{"progress":{"page":12}},delay_seconds=60)
            raise RuntimeError("simulate crash before commit")
    with store.trusted() as c:
        row=c.execute(text("select payload,status from public.jobs where id=cast(:id as uuid)"),{"id":job_id}).mappings().one()
        assert row["payload"]=={}
        assert row["status"]=="leased"


def test_worker_processes_only_one_page_per_lease_and_resumes_exact_offset(monkeypatch):
    from contextlib import contextmanager
    from fmc import v1_workers
    class Conn:
        def __init__(self):
            self.statements=[]
        def execute(self, stmt, params=None):
            self.statements.append((str(stmt),params))
    class FakeDb:
        def __init__(self):
            self.conn=Conn()
            self.requests=0
            self.checkpoints=[]
        def reserve_provider_request(self, _connection_id):
            self.requests+=1
            return 0
        @contextmanager
        def trusted(self):
            yield self.conn
        def checkpoint_provider_job(self,c,job_id,lease,payload,delay_seconds):
            assert c is self.conn
            self.checkpoints.append((job_id,lease,payload,delay_seconds))
    class FakePlaytomic:
        calls=[]
        def __init__(self,client_id,secret,tenant):
            assert (client_id,secret,tenant)==("fixture-id","fixture-secret","club-fixture-01")
        def page(self,kind,start,end,cursor=None,page=0):
            self.calls.append((kind,start,end,cursor,page))
            return {"records":[],"has_more":page==0,"next_cursor":None}
    c={
        "provider":"playtomic","organization_id":"11111111-1111-4111-8111-111111111111",
        "status":"configured","capabilities":{"write_mode":"read_sync","official_read_authorized":True},
        "config":{"tenant_id":"club-fixture-01","official_grant":{
            "provider":"playtomic","status":"approved",
            "authority":"club_or_certified_partner",
            "organization_id":"11111111-1111-4111-8111-111111111111",
            "tenant_id":"club-fixture-01","agreement_ref":"fixture-agreement-01",
            "owner_approval_ref":"fixture-owner-01","scopes":["bookings.read"],
            "approved_at":"2026-01-01T00:00:00Z",
            "expires_at":"2027-01-01T00:00:00Z"
        }}
    }
    monkeypatch.setattr(v1_workers,"_connection",lambda db,pc:c)
    monkeypatch.setattr(v1_workers,"_credential",lambda c:("fixture-id","fixture-secret","club-fixture-01"))
    monkeypatch.setattr(v1_workers,"Playtomic",FakePlaytomic)
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED","true")
    db=FakeDb()
    job={"id":"fake-job","lease_token":"fake-lease","payload":{
        "provider_connection_id":"fixture-connection","stream":"bookings",
        "window_start":"2026-10-20T00:00:00Z",
        "window_end":"2026-10-21T00:00:00Z"}}
    result=v1_workers._sync_playtomic(db,job)
    assert result["checkpointed"] is True
    assert db.requests==1
    assert len(FakePlaytomic.calls)==1
    assert db.checkpoints[0][2]["progress"]["page"]==1
    assert db.checkpoints[0][3]==60
    # Separate leased invocation resumes exactly at the durable page offset.
    next_job={**job,"payload":db.checkpoints[0][2]}
    done=v1_workers._sync_playtomic(db,next_job)
    assert done=={"provider":"playtomic","stream":"bookings","records":0}
    assert db.requests==2
    assert [x[-1] for x in FakePlaytomic.calls]==[0,1]
    assert len(db.checkpoints)==1


def test_worker_rate_wait_stops_before_credential_and_network(monkeypatch):
    from fmc import v1_workers
    from fmc.playtomic import Deferred
    db=type("NoReadDb",(),{
        "reserve_provider_request":lambda self,pc:54
    })()
    c={"provider":"playtomic","status":"configured",
       "organization_id":"11111111-1111-4111-8111-111111111111",
       "capabilities":{"write_mode":"read_sync","official_read_authorized":True},
       "config":{"tenant_id":"club-fixture-01","official_grant":{
           "provider":"playtomic","status":"approved",
           "authority":"club_or_certified_partner",
           "organization_id":"11111111-1111-4111-8111-111111111111",
           "tenant_id":"club-fixture-01","agreement_ref":"fixture-agreement-01",
           "owner_approval_ref":"fixture-owner-01","scopes":["bookings.read"],
           "approved_at":"2026-01-01T00:00:00Z",
           "expires_at":"2027-01-01T00:00:00Z"}}}
    monkeypatch.setattr(v1_workers,"_connection",lambda db,pc:c)
    def denied(*_args,**_kwargs):
        raise AssertionError("Never fetch credentials or call provider")
    monkeypatch.setattr(v1_workers,"_credential",denied)
    monkeypatch.setattr(v1_workers,"Playtomic",denied)
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED","true")
    with pytest.raises(Deferred) as err:
        v1_workers._sync_playtomic(db,{"id":"fake-job","lease_token":"fake-lease",
            "payload":{"provider_connection_id":"fixture","stream":"bookings",
                       "window_start":"2026-10-20T00:00:00Z",
                       "window_end":"2026-10-21T00:00:00Z"}})
    assert err.value.seconds==54
