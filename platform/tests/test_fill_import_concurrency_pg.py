"""Simultaneous real import routes in disposable CI PG16, with fictional Auth.

The first real SELECT FOR UPDATE is paused after acquiring its row lock. A
second ASGI request uses another backend. Python synchronization is orchestration;
pg_blocking_pids + pg_locks + pg_stat_activity are the actual database wait proof.
No application SQL/results, policies, hosted identities or external HTTP change.
"""
import asyncio
from threading import Event, Lock
import time
import uuid

import httpx
import pytest
from sqlalchemy import event, text

from test_fill_import_rollback_pg import pg_rollback, commit_item


pytestmark = pytest.mark.parametrize("pg_rollback", ["concurrency-two"], indirect=True)
STATE_ERROR = {"error": "IMPORT_STATE", "message": "Only a committed import can be rolled back."}


class BatchWatch:
    def __init__(self, h):
        self.h = h
        self.release = Event()
        self.locked = Event()
        self.mutex = Lock()
        self.records, self.by_connection = [], {}
        self.before_listener, self.after_listener = self.before, self.after

    @staticmethod
    def is_batch_lock(statement):
        sql = " ".join(statement.lower().split())
        return sql.startswith("select * from public.import_batches ") and sql.endswith("for update")

    def before(self, c, cursor, statement, parameters, context, executemany):
        if not self.is_batch_lock(statement):
            return
        state = dict(c.execute(text("""select pg_backend_pid() as pid,current_user as role,
            current_setting('request.jwt.claim.sub') as uid,
            current_setting('transaction_isolation') as isolation,
            (select rolbypassrls from pg_roles where rolname=current_user) as bypass""")).mappings().one())
        assert state["role"] == "authenticated" and state["bypass"] is False
        assert state["isolation"] == "read committed"
        with self.mutex:  # Never held while waiting or executing the batch SQL.
            record = {**state, "index": len(self.records), "batch": parameters["id"],
                      "org": parameters["org"], "acquired": False}
            self.records.append(record)
            self.by_connection[id(c)] = record

    def after(self, c, cursor, statement, parameters, context, executemany):
        if not self.is_batch_lock(statement):
            return
        record = self.by_connection[id(c)]
        record["acquired"] = True
        if record["index"] == 0:
            self.locked.set()
            assert self.release.wait(8), "First request's test-owned lock gate expired"

    def install(self):
        event.listen(self.h.store.engine, "before_cursor_execute", self.before_listener)
        event.listen(self.h.store.engine, "after_cursor_execute", self.after_listener)

    def remove(self):
        event.remove(self.h.store.engine, "before_cursor_execute", self.before_listener)
        event.remove(self.h.store.engine, "after_cursor_execute", self.after_listener)
        assert not event.contains(self.h.store.engine, "before_cursor_execute", self.before_listener)
        assert not event.contains(self.h.store.engine, "after_cursor_execute", self.after_listener)

    def observe(self, statement, params=None):
        # Fresh observer transaction on a third physical backend; autocommit
        # prevents a cached pg_stat_activity snapshot during bounded polling.
        with self.h.observer.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
            pid = c.execute(text("select pg_backend_pid()")).scalar_one()
            self.h.observer_pids.append(pid)
            assert pid not in [r["pid"] for r in self.records]
            return [dict(r) for r in c.execute(text(statement), params or {}).mappings()]

    def database_wait(self):
        first, second = self.records
        assert first["pid"] != second["pid"]
        deadline = time.monotonic() + 1.8  # Below opt-in lock_timeout=3s.
        while time.monotonic() < deadline:
            proof = self.observe("""select pg_blocking_pids(:waiter) as blockers,
                a.state,a.wait_event_type,a.wait_event,a.query,
                exists(select 1 from pg_locks l where l.pid=:waiter and not l.granted) as pending_lock
                from pg_stat_activity a where a.pid=:waiter""", {"waiter": second["pid"]})
            if proof and first["pid"] in proof[0]["blockers"]:
                row = proof[0]
                assert row["state"] == "active" and row["wait_event_type"] == "Lock"
                assert row["pending_lock"] is True
                assert "for update" in row["query"].lower()
                assert first["acquired"] is True and second["acquired"] is False
                return row
            time.sleep(0.01)  # Polling itself is never treated as lock evidence.
        pytest.fail("Second physical backend never demonstrated a PostgreSQL batch-row wait")


async def until(predicate, seconds):
    deadline = asyncio.get_running_loop().time() + seconds
    while not predicate():
        assert asyncio.get_running_loop().time() < deadline, "Bounded request coordination expired"
        await asyncio.sleep(0.005)


async def simultaneous(h, first_op, second_op, *, independent=False):
    """Own/settle all ASGI tasks and clients before removing test listeners."""
    watch = BatchWatch(h)
    tasks = []
    proof = None
    watch.install()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=h.app), base_url="http://testserver") as left:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=h.app), base_url="http://testserver") as right:
                def send(client, op, tenant, actor):
                    return client.post(f"/api/fmc/{h.orgs[tenant]}/imports/{h.batches[tenant]}/{op}",
                                       headers={"Authorization": "Bearer fictional-ci-" + str(actor)})
                try:
                    tasks.append(asyncio.create_task(send(left, first_op, 0, 0)))
                    await until(watch.locked.is_set, 2)
                    tasks.append(asyncio.create_task(send(right, second_op, 1 if independent else 0,
                                                          1 if independent else 2)))
                    await until(lambda: len(watch.records) == 2, 2)
                    assert not tasks[0].done()
                    if independent:
                        second = await asyncio.wait_for(asyncio.shield(tasks[1]), 2)
                        assert second.status_code == 200, second.text
                        assert not tasks[0].done() and not watch.release.is_set()
                        state = watch.observe("""select pid,state,xact_start,pg_blocking_pids(pid) as blockers
                            from pg_stat_activity where pid=:pid""", {"pid": watch.records[0]["pid"]})
                        assert state[0]["state"] == "idle in transaction" and state[0]["xact_start"] is not None
                        assert state[0]["blockers"] == []
                        proof = {"independent_completed_while_first_locked": True}
                    else:
                        proof = watch.database_wait()
                        assert not tasks[1].done()
                    watch.release.set()
                    responses = await asyncio.wait_for(asyncio.gather(*tasks), 6)
                finally:
                    watch.release.set()  # Also on assertion, timeout or client error.
                    if tasks:
                        await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 8)
                    assert all(t.done() for t in tasks), "No test-owned request task may escape cleanup"
    finally:
        watch.release.set()
        watch.remove()
    assert h.store.engine.pool.checkedout() == 0, "No route connection still owned after request settlement"
    assert len(watch.records) == 2 and all(r["acquired"] for r in watch.records)
    pids = [r["pid"] for r in watch.records]
    assert len(set(pids)) == 2
    idle = watch.observe("""select pid,state,xact_start,pg_blocking_pids(pid) as blockers
        from pg_stat_activity where pid=any(:pids) and datname='fmc_test' and application_name=:name""",
                         {"pids": pids, "name": h.application_name})
    assert len(idle) == 2
    assert all(r["state"] == "idle" and r["xact_start"] is None and r["blockers"] == [] for r in idle)
    expected = [(0, 0), (1, 1)] if independent else [(0, 0), (0, 2)]
    for record, (tenant, actor) in zip(watch.records, expected):
        assert (record["uid"], record["org"], record["batch"]) == (
            h.users[actor], h.orgs[tenant], h.batches[tenant])
    return responses, watch.records, proof


def prepare(h, tenant=0):
    person = h.people[tenant][0]
    key = "serialization-new-" + str(uuid.uuid4())
    h.configure_commit([commit_item(person, name="CI concurrent imported name", marketing_consent=False),
                        {"external_id": key, "name": "CI concurrent created person"}], tenant)
    return key


def batch_row(h, snapshot, tenant=0):
    return next(r for r in snapshot["import_batches"] if str(r["id"]) == h.batches[tenant])


def assert_events(h, snapshot, events, tenant=0, actors=None):
    for table, key in [("audit_events", "entity_id"), ("domain_events", "aggregate_id")]:
        rows = [r for r in snapshot[table] if str(r["organization_id"]) == h.orgs[tenant]]
        assert [r["event_type"] for r in rows] == events
        assert all(str(r[key]) == h.batches[tenant] for r in rows)
        if table == "audit_events":
            assert [str(r["actor_user_id"]) for r in rows] == (actors or [h.users[tenant]] * len(events))


def assert_committed(h, snapshot, new_key, tenant=0):
    batch = batch_row(h, snapshot, tenant)
    assert batch["status"] == "committed" and batch["committed_at"] is not None
    assert batch["result"]["count"] == 2
    changes = batch["result"]["changes"]
    existing = next(r for r in snapshot["people"] if str(r["id"]) == h.people[tenant][0])
    assert existing["full_name"] == "CI concurrent imported name" and existing["marketing_consent"] is False
    added = [r for r in snapshot["people"] if r["external_key"] == new_key]
    assert len(added) == 1 and str(added[0]["organization_id"]) == h.orgs[tenant]
    assert changes[0]["id"] == h.people[tenant][0] and changes[0]["created"] is False
    assert changes[1] == {"id": str(added[0]["id"]), "created": True}
    return batch


def assert_restored(h, before, after, rollback_actor=0):
    assert {str(r["id"]) for r in after["people"]} == {str(r["id"]) for r in before["people"]}
    originals = {str(r["id"]): r for r in before["people"]}
    for row in after["people"]:
        original = originals[str(row["id"])]
        if str(row["id"]) == h.people[0][0]:
            # Existing rollback intentionally updates timestamps; only the stored
            # restoration fields, identity and tenant are claimed restored.
            assert all(row[k] == original[k] for k in (
                "id", "organization_id", "auth_user_id", "external_key", "full_name", "email",
                "phone", "marketing_consent", "source", "created_at"))
        else:
            assert row == original
    batch = batch_row(h, after)
    assert batch["status"] == "rolled_back" and batch["rolled_back_at"] is not None
    assert batch["result"]["count"] == 2
    assert batch["result"]["changes"][1]["created"] is True
    assert batch["result"]["changes"][1]["id"] not in originals
    assert_events(h, after, ["import.committed", "import.rolled_back"],
                  actors=[h.users[0], h.users[rollback_actor]])


def proven(h, capsys, request, records, proof):
    assert all(r["pid"] not in h.observer_pids for r in records)
    assert all(m["state"]["pid"] not in h.observer_pids for m in h.mutations)
    for mutation in h.mutations:
        tenant = 0 if mutation["state"]["uid"] in (h.users[0], h.users[2]) else 1
        assert all(r["organization_id"] == h.orgs[tenant] for r in mutation["visible"])
    assert h.store.engine.pool.checkedout() == 0
    with capsys.disabled():
        detail = "independent_completed_while_first_locked" if "independent_completed_while_first_locked" in proof else "pg_blocking_pids_and_pending_lock"
        print("FILL_IMPORT_CONCURRENCY_PG16_PASS " + request.node.name + " proof=" + detail, flush=True)


def test_commit_commit_serializes_and_creates_once(pg_rollback, capsys, request):
    h = pg_rollback
    h.set_role("admin")
    key = prepare(h)
    responses, records, proof = asyncio.run(simultaneous(h, "commit", "commit"))
    first, second = responses
    assert first.status_code == second.status_code == 200
    assert first.json() == {"id": h.batches[0], "status": "committed", "count": 2}
    after = h.snapshot()
    batch = assert_committed(h, after, key)
    assert second.json() == {"id": h.batches[0], "status": "committed", "result": batch["result"]}
    assert [(m["op"], m["count"]) for m in h.mutations] == [("update", 1), ("insert", 1)]
    assert h.completions == ["commit-batch", "audit"]
    assert_events(h, after, ["import.committed"])
    proven(h, capsys, request, records, proof)


def test_rollback_rollback_serializes_and_restores_once(pg_rollback, capsys, request):
    h = pg_rollback
    h.set_role("admin")
    prepare(h)
    before = h.snapshot()
    assert h.commit().status_code == 200
    h.mutations.clear()
    h.completions.clear()
    responses, records, proof = asyncio.run(simultaneous(h, "rollback", "rollback"))
    assert responses[0].status_code == 200 and responses[0].json() == {"id": h.batches[0], "status": "rolled_back"}
    assert responses[1].status_code == 409 and responses[1].json() == STATE_ERROR
    assert [(m["op"], m["count"]) for m in h.mutations] == [("delete", 1), ("update", 1)]
    assert h.completions == ["batch", "audit"]
    assert_restored(h, before, h.snapshot())
    proven(h, capsys, request, records, proof)


def test_commit_then_rollback_reads_new_committed_result_after_wait(pg_rollback, capsys, request):
    h = pg_rollback
    h.set_role("admin")
    prepare(h)
    before = h.snapshot()
    responses, records, proof = asyncio.run(simultaneous(h, "commit", "rollback"))
    assert responses[0].status_code == responses[1].status_code == 200
    assert responses[0].json()["count"] == 2
    assert responses[1].json() == {"id": h.batches[0], "status": "rolled_back"}
    assert [(m["op"], m["count"]) for m in h.mutations] == [("update", 1), ("insert", 1), ("delete", 1), ("update", 1)]
    assert h.completions == ["commit-batch", "audit", "batch", "audit"]
    assert_restored(h, before, h.snapshot(), rollback_actor=2)
    proven(h, capsys, request, records, proof)


def test_initial_staged_rollback_denial_releases_waiting_commit(pg_rollback, capsys, request):
    h = pg_rollback
    h.set_role("admin")
    key = prepare(h)
    responses, records, proof = asyncio.run(simultaneous(h, "rollback", "commit"))
    assert responses[0].status_code == 409 and responses[0].json() == STATE_ERROR
    assert responses[1].status_code == 200 and responses[1].json()["count"] == 2
    after = h.snapshot()
    assert_committed(h, after, key)
    assert [(m["op"], m["count"]) for m in h.mutations] == [("update", 1), ("insert", 1)]
    assert h.completions == ["commit-batch", "audit"]
    assert_events(h, after, ["import.committed"], actors=[h.users[2]])
    proven(h, capsys, request, records, proof)


def test_different_tenants_commit_independently_with_isolated_claims(pg_rollback, capsys, request):
    h = pg_rollback
    keys = [prepare(h, tenant) for tenant in (0, 1)]
    responses, records, proof = asyncio.run(simultaneous(h, "commit", "commit", independent=True))
    assert all(r.status_code == 200 and r.json()["count"] == 2 for r in responses)
    after = h.snapshot()
    batches = [assert_committed(h, after, keys[i], i) for i in (0, 1)]
    assert batches[0]["result"]["changes"][1]["id"] != batches[1]["result"]["changes"][1]["id"]
    assert len(h.mutations) == 4 and all(m["count"] == 1 for m in h.mutations)
    assert {m["state"]["uid"] for m in h.mutations} == {h.users[0], h.users[1]}
    assert h.completions.count("commit-batch") == h.completions.count("audit") == 2
    for tenant in (0, 1):
        assert_events(h, after, ["import.committed"], tenant)
    proven(h, capsys, request, records, proof)
