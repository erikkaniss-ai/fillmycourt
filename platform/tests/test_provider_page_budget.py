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
