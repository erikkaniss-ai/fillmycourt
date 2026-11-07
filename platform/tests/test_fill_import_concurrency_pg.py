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


class PersonWatch(BatchWatch):
    """Different batches: hold A after its real person UPDATE, not its batch read."""
    def after(self, c, cursor, statement, parameters, context, executemany):
        if self.is_batch_lock(statement):
            self.by_connection[id(c)]["acquired"] = True
        elif " ".join(statement.lower().split()).startswith("update public.people "):
            record = self.by_connection[id(c)]
            if record["index"] == 0:
                assert cursor.rowcount == 1
                self.locked.set()
                assert self.release.wait(8), "A's test-owned person row-lock gate expired"

    def database_wait(self):
        first, second = self.records
        assert first["pid"] != second["pid"] and first["batch"] != second["batch"]
        deadline = time.monotonic() + 1.8
        while time.monotonic() < deadline:
            rows = self.observe("""select pg_blocking_pids(:pid) as blockers,a.state,a.wait_event_type,a.query,
                exists(select 1 from pg_locks l where l.pid=:pid and not l.granted) as pending_lock
                from pg_stat_activity a where a.pid=:pid""", {"pid": second["pid"]})
            if rows and first["pid"] in rows[0]["blockers"]:
                row = rows[0]
                assert row["state"] == "active" and row["wait_event_type"] == "Lock" and row["pending_lock"] is True
                sql = " ".join(row["query"].lower().split())
                if sql.startswith("select * from public.people ") and "for update" in sql:
                    row["phase"] = "matched_person_select"
                else:
                    assert sql.startswith("update public.people ")
                    row["phase"] = "person_update"
                assert first["acquired"] and second["acquired"], "Both independent batch locks already acquired"
                return row
            time.sleep(0.01)
        pytest.fail("B never demonstrated a physical wait on A's person row lock")


async def person_pair(h, sibling, *, independent_person=False):
    watch = PersonWatch(h)
    tasks = []
    watch.install()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=h.app), base_url="http://testserver") as left:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=h.app), base_url="http://testserver") as right:
                def commit(client, batch, actor):
                    return client.post(f"/api/fmc/{h.orgs[0]}/imports/{batch}/commit",
                                       headers={"Authorization": "Bearer fictional-ci-" + str(actor)})
                try:
                    tasks.append(asyncio.create_task(commit(left, h.batches[0], 0)))
                    await until(watch.locked.is_set, 2)
                    tasks.append(asyncio.create_task(commit(right, sibling, 2)))
                    await until(lambda: len(watch.records) == 2, 2)
                    assert not tasks[0].done()
                    if independent_person:
                        second = await asyncio.wait_for(asyncio.shield(tasks[1]), 2)
                        assert second.status_code == 200, second.text
                        assert not tasks[0].done() and not watch.release.is_set()
                        proof = {"phase": "unrelated_person_completed_while_A_locked"}
                    else:
                        proof = watch.database_wait()
                        assert not tasks[1].done()
                    watch.release.set()
                    responses = await asyncio.wait_for(asyncio.gather(*tasks), 6)
                finally:
                    watch.release.set()
                    if tasks:
                        await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 8)
                    assert all(t.done() for t in tasks)
    finally:
        watch.release.set()
        watch.remove()
    assert h.store.engine.pool.checkedout() == 0
    assert len(watch.records) == 2 and all(r["acquired"] for r in watch.records)
    pids = [r["pid"] for r in watch.records]
    assert len(set(pids)) == 2
    idle = watch.observe("""select pid,state,xact_start,pg_blocking_pids(pid) as blockers
        from pg_stat_activity where pid=any(:pids) and datname='fmc_test' and application_name=:name""",
                         {"pids": pids, "name": h.application_name})
    assert len(idle) == 2 and all(r["state"] == "idle" and r["xact_start"] is None and r["blockers"] == [] for r in idle)
    for i, record in enumerate(watch.records):
        assert (record["uid"], record["org"], record["batch"]) == (
            h.users[0 if i == 0 else 2], h.orgs[0], h.batches[0] if i == 0 else sibling)
        assert record["pid"] not in h.observer_pids
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    return responses, watch.records, proof


BUSINESS_FIELDS = ("external_key", "full_name", "email", "phone", "marketing_consent", "source")


def business(row):
    return {key: row[key] for key in BUSINESS_FIELDS}


def assert_sibling_events(h, snapshot, sibling, *, rolled_back=False):
    for table, column in [("audit_events", "entity_id"), ("domain_events", "aggregate_id")]:
        a = [r for r in snapshot[table] if str(r[column]) == h.batches[0]]
        b = [r for r in snapshot[table] if str(r[column]) == sibling]
        assert len(snapshot[table]) == (3 if rolled_back else 2)
        assert [r["event_type"] for r in a] == ["import.committed"]
        assert [r["event_type"] for r in b] == (["import.committed", "import.rolled_back"] if rolled_back else ["import.committed"])
        assert all(str(r["organization_id"]) == h.orgs[0] for r in a + b)
        if table == "audit_events":
            assert all(str(r["actor_user_id"]) == h.users[0] for r in a)
            assert all(str(r["actor_user_id"]) == h.users[2] for r in b)


@pytest.mark.parametrize("match", ["external", "email"])
def test_person_snapshot_preserves_preceding_commit(pg_rollback, capsys, request, match):
    h = pg_rollback
    h.set_role("admin")
    person = h.people[0][0]
    email = "snapshot-" + str(uuid.uuid4()) + "@example.test"
    a_key, b_key = "snapshot-A-" + str(uuid.uuid4()), "snapshot-B-" + str(uuid.uuid4())
    a = commit_item(person, name="CI snapshot A", phone="+351000000101", marketing_consent=False)
    b = (commit_item(person) if match == "external" else {"email": email.upper(), "external_id": ""})
    b.update(name="CI snapshot B", phone="+351000000202", marketing_consent=True)
    h.configure_commit([a, {"external_id": a_key, "name": "CI A created"}])
    sibling = h.configure_sibling([b, {"external_id": b_key, "name": "CI B created"}], person_email=email)
    before = h.snapshot()
    original = next(r for r in before["people"] if str(r["id"]) == person)
    expected_a = {**business(original), "full_name": "CI snapshot A", "phone": "+351000000101", "marketing_consent": False}
    responses, records, proof = asyncio.run(person_pair(h, sibling))
    assert all(r.json()["count"] == 2 for r in responses)
    committed = h.snapshot()
    batch_a = batch_row(h, committed)
    batch_b = next(r for r in committed["import_batches"] if str(r["id"]) == sibling)
    assert batch_a["status"] == batch_b["status"] == "committed"
    assert batch_a["result"]["count"] == batch_b["result"]["count"] == 2
    snapshot_a, snapshot_b = (batch["result"]["changes"][0]["before"] for batch in (batch_a, batch_b))
    assert business(snapshot_a) == business(original)
    assert all(batch["result"]["changes"][0]["id"] == person for batch in (batch_a, batch_b))
    assert [(m["op"], m["count"]) for m in h.mutations] == [("update", 1), ("insert", 1), ("update", 1), ("insert", 1)]
    for key in (a_key, b_key):
        assert len([r for r in committed["people"] if r["external_key"] == key]) == 1
    assert_sibling_events(h, committed, sibling)
    stale = business(snapshot_b) == business(original)
    # Honest diagnostic for tests-first CI: the unfixed route waits at UPDATE,
    # and stores pre-A data. A fixed PASS is emitted only after all later checks.
    with capsys.disabled():
        print(f"FILL_IMPORT_PERSON_SNAPSHOT_OBSERVED {request.node.name} phase={proof['phase']} stale_before={stale}", flush=True)
    assert business(snapshot_b) == expected_a, "B rollback-before snapshot must contain A's preceding committed fields"
    assert proof["phase"] == "matched_person_select", "Matched row must be locked before copying its snapshot"
    rolled = h.rollback(actor=2, batch=sibling)
    assert rolled.status_code == 200 and rolled.json() == {"id": sibling, "status": "rolled_back"}
    after = h.snapshot()
    final_person = next(r for r in after["people"] if str(r["id"]) == person)
    assert business(final_person) == expected_a  # No timestamp restoration claim.
    assert len([r for r in after["people"] if r["external_key"] == a_key]) == 1
    assert not any(r["external_key"] == b_key for r in after["people"])
    a_created = batch_a["result"]["changes"][1]
    b_created = batch_b["result"]["changes"][1]
    assert a_created["created"] is True and b_created["created"] is True and a_created["id"] != b_created["id"]
    ids = {str(r["id"]) for r in after["people"]}
    assert a_created["id"] in ids and b_created["id"] not in ids
    originals = {str(r["id"]): r for r in before["people"]}
    for row in after["people"]:
        if str(row["id"]) in originals and str(row["id"]) != person:
            assert row == originals[str(row["id"])], "Foreign tenant and unrelated people untouched"
    assert batch_row(h, after) == batch_a
    final_b = next(r for r in after["import_batches"] if str(r["id"]) == sibling)
    assert final_b["status"] == "rolled_back" and final_b["result"] == batch_b["result"]
    assert_sibling_events(h, after, sibling, rolled_back=True)
    assert h.store.engine.pool.checkedout() == 0
    with capsys.disabled():
        print("FILL_IMPORT_PERSON_SNAPSHOT_PG16_PASS " + request.node.name, flush=True)


def test_unrelated_person_in_same_tenant_is_not_serialized(pg_rollback, capsys, request):
    h = pg_rollback
    h.set_role("admin")
    h.configure_commit([commit_item(h.people[0][0], name="CI unrelated A")])
    sibling = h.configure_sibling([commit_item(h.people[0][1], name="CI unrelated B")])
    before = h.snapshot()
    responses, records, proof = asyncio.run(person_pair(h, sibling, independent_person=True))
    assert all(r.json()["count"] == 1 for r in responses)
    assert proof["phase"] == "unrelated_person_completed_while_A_locked"
    after = h.snapshot()
    for i, batch_id in enumerate((h.batches[0], sibling)):
        person = h.people[0][i]
        row = next(r for r in after["people"] if str(r["id"]) == person)
        original = next(r for r in before["people"] if str(r["id"]) == person)
        batch = next(r for r in after["import_batches"] if str(r["id"]) == batch_id)
        assert row["full_name"] == ("CI unrelated A" if i == 0 else "CI unrelated B")
        assert business(batch["result"]["changes"][0]["before"]) == business(original)
        assert batch["result"]["count"] == 1 and batch["status"] == "committed"
    assert len(h.mutations) == 2 and all(m["count"] == 1 for m in h.mutations)
    assert_sibling_events(h, after, sibling)
    with capsys.disabled():
        print("FILL_IMPORT_PERSON_CONTROL_PG16_PASS " + request.node.name, flush=True)


class DeleteWatch(BatchWatch):
    def __init__(self, h, victim):
        super().__init__(h)
        self.victim = victim

    def after(self, c, cursor, statement, parameters, context, executemany):
        if self.is_batch_lock(statement):
            self.by_connection[id(c)]["acquired"] = True
        elif (" ".join(statement.lower().split()).startswith("select * from public.people ") and
              "for update" in statement.lower() and parameters.get("external") == "ci-key-" + self.victim):
            self.locked.set()
            assert self.release.wait(8), "Matched-person gate expired"


async def serialized_delete(h, victim):
    # Exactly one owned observer thread; no blocked observer DELETE is run from
    # a paused route callback. It has fixed CI connect/statement/lock bounds.
    from threading import Thread
    watch, started, result = DeleteWatch(h, victim), Event(), {}
    task, worker = None, None

    def delete_worker():
        try:
            with h.observer.begin() as c:
                result["pid"] = c.execute(text("select pg_backend_pid()")).scalar_one()
                h.observer_pids.append(result["pid"])
                started.set()
                deleted = c.execute(text("""delete from public.people where id=cast(:id as uuid)
                    and organization_id=cast(:org as uuid) and auth_user_id is null"""),
                                    {"id": victim, "org": h.orgs[0]})
                result["count"] = deleted.rowcount
        except BaseException as error:
            result["error"] = error
            started.set()

    watch.install()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=h.app), base_url="http://testserver") as client:
            try:
                task = asyncio.create_task(client.post(f"/api/fmc/{h.orgs[0]}/imports/{h.batches[0]}/commit",
                    headers={"Authorization": "Bearer fictional-ci-0"}))
                await until(watch.locked.is_set, 2)
                worker = Thread(target=delete_worker, name="fill-ci-owned-delete", daemon=True)
                worker.start()
                await until(started.is_set, 2)
                assert "error" not in result, result.get("error")
                route = watch.records[0]
                assert result["pid"] != route["pid"]
                deadline = time.monotonic() + 1.8
                proof = None
                while time.monotonic() < deadline:
                    rows = watch.observe("""select pg_blocking_pids(:pid) as blockers,a.wait_event_type,a.query,
                        exists(select 1 from pg_locks l where l.pid=:pid and not l.granted) as pending_lock
                        from pg_stat_activity a where a.pid=:pid""", {"pid": result["pid"]})
                    if rows and route["pid"] in rows[0]["blockers"]:
                        proof = rows[0]
                        assert proof["wait_event_type"] == "Lock" and proof["pending_lock"] is True
                        assert "delete from public.people" in proof["query"].lower()
                        break
                    await asyncio.sleep(0.01)
                assert proof is not None and worker.is_alive() and not task.done()
                watch.release.set()
                response = await asyncio.wait_for(asyncio.shield(task), 6)
                await until(lambda: not worker.is_alive(), 6)
            finally:
                watch.release.set()
                if task is not None:
                    await asyncio.wait_for(asyncio.gather(task, return_exceptions=True), 8)
                if worker is not None:
                    worker.join(timeout=6)
                    assert not worker.is_alive(), "Owned DELETE thread must not escape cleanup"
    finally:
        watch.release.set()
        watch.remove()
    assert task.done() and h.store.engine.pool.checkedout() == 0
    assert "error" not in result, result.get("error")
    assert result["count"] == 1 and response.status_code == 200, response.text
    route = watch.records[0]
    assert (route["uid"], route["org"], route["batch"]) == (h.users[0], h.orgs[0], h.batches[0])
    deadline = time.monotonic() + 1.5
    while watch.observe("select pid from pg_stat_activity where pid=:pid", {"pid": result["pid"]}):
        assert time.monotonic() < deadline, "Observer backend must close after its committed DELETE"
        await asyncio.sleep(0.01)
    idle = watch.observe("select state,xact_start,pg_blocking_pids(pid) as blockers from pg_stat_activity where pid=:pid",
                         {"pid": route["pid"]})
    assert len(idle) == 1 and idle[0]["state"] == "idle" and idle[0]["xact_start"] is None and idle[0]["blockers"] == []
    return response, result


def run_serialized_delete_case(h, first_op=None):
    victim = h.people[0][1]
    payload = [commit_item(victim, name="CI committed before delete")]
    if first_op is not None:
        first = (commit_item(h.people[0][0], name="CI earlier committed change") if first_op == "update" else
                 {"external_id": "delete-control-" + str(uuid.uuid4()), "name": "CI earlier committed change"})
        payload.insert(0, first)
    h.configure_commit(payload)
    before = h.snapshot()
    response, deleted = asyncio.run(serialized_delete(h, victim))
    assert response.json() == {"id": h.batches[0], "status": "committed", "count": len(payload)}
    assert [(m["op"], m["count"]) for m in h.mutations] == (
        [("update", 1)] if first_op is None else [(first_op, 1), ("update", 1)])
    after = h.snapshot()
    assert not any(str(r["id"]) == victim for r in after["people"])
    batch = batch_row(h, after)
    assert batch["status"] == "committed" and batch["result"]["count"] == len(payload)
    changes = batch["result"]["changes"]
    assert changes[-1]["id"] == victim and changes[-1]["created"] is False
    original = next(r for r in before["people"] if str(r["id"]) == victim)
    assert business(changes[-1]["before"]) == business(original)
    if first_op is not None:
        first_id = changes[0]["id"]
        first = next(r for r in after["people"] if str(r["id"]) == first_id)
        assert first["full_name"] == "CI earlier committed change"
        assert changes[0]["created"] is (first_op == "insert")
    else:
        first_id = None
    originals = {str(r["id"]): r for r in before["people"]}
    for row in after["people"]:
        if str(row["id"]) in originals and str(row["id"]) != first_id:
            assert row == originals[str(row["id"])]
    assert h.completions == ["commit-batch", "audit"]
    assert_events(h, after, ["import.committed"])
    assert deleted["count"] == 1
