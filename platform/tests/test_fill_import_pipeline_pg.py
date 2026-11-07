"""Real CSV -> stage -> commit -> rollback in existing disposable CI PG16.

All pipeline batch IDs come from actual stage201 responses. No pipeline payload
or batch is seeded directly. Auth alone is the existing explicit fictional stub;
routes/parser/SQL/RLS/events/transactions and fresh physical readbacks are real.
The borrowed TestClient and engines retain their original fixture-owned cleanup.
"""
import csv
import hashlib
import io
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy import event, text

from test_fill_import_rollback_pg import pg_rollback


FIELDS = ("external_key", "full_name", "email", "phone", "marketing_consent", "source")


def csv_text(headers, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return stream.getvalue()


@pytest.fixture
def pipeline(pg_rollback, request, capsys):
    h = pg_rollback  # Strict target/schema/server gates precede both engines.
    state = SimpleNamespace(h=h, claims=[], passed=False)

    def inspect(c, cursor, statement, parameters, context, executemany):
        sql = " ".join(statement.lower().split())
        if any(name in sql for name in ("public.organization_members", "public.import_batches",
                                        "public.people", "private.append_event")):
            claim = dict(c.execute(text("""select pg_backend_pid() as pid,current_user as role,
                current_setting('request.jwt.claim.sub') as uid,
                (select rolbypassrls from pg_roles where rolname=current_user) as bypass""")).mappings().one())
            assert claim["role"] == "authenticated" and claim["bypass"] is False
            assert claim["uid"] in h.users
            state.claims.append(claim)

    event.listen(h.store.engine, "after_cursor_execute", inspect)
    try:
        yield state
    finally:
        event.remove(h.store.engine, "after_cursor_execute", inspect)
        assert not event.contains(h.store.engine, "after_cursor_execute", inspect)
        assert h.store.engine.pool.checkedout() == 0
        # A fully returned connection must have no transaction-local role/UID.
        with h.store.engine.connect() as c:
            reset = c.execute(text("""select pg_backend_pid() as pid,current_user as role,
                current_setting('request.jwt.claim.sub',true) as uid,
                current_setting('request.jwt.claim.role',true) as claim_role""")).mappings().one()
            assert reset["role"] == "postgres" and reset["uid"] in (None, "")
            assert reset["claim_role"] in (None, "")
            assert reset["pid"] not in h.observer_pids
        assert h.store.engine.pool.checkedout() == 0
        assert all(claim["pid"] not in h.observer_pids for claim in state.claims)
        if state.passed:
            with capsys.disabled():
                print("FILL_IMPORT_PIPELINE_PG16_PASS " + request.node.name, flush=True)


def batch(snapshot, batch_id):
    return next(row for row in snapshot["import_batches"] if str(row["id"]) == batch_id)


def person(snapshot, person_id):
    return next(row for row in snapshot["people"] if str(row["id"]) == person_id)


def business(row):
    return {field: row[field] for field in FIELDS}


def assert_seeded_batches_unchanged(before, after):
    for original in before["import_batches"]:
        assert batch(after, str(original["id"])) == original


def events(h, snapshot, batch_id, actor, tenant, expected):
    for table, key in [("audit_events", "entity_id"), ("domain_events", "aggregate_id")]:
        rows = [r for r in snapshot[table] if str(r[key]) == batch_id]
        assert [r["event_type"] for r in rows] == expected
        assert all(str(r["organization_id"]) == h.orgs[tenant] for r in rows)
        if table == "audit_events":
            assert all(str(r["actor_user_id"]) == h.users[actor] for r in rows)
    return [r for r in snapshot["audit_events"] if r["entity_id"] == batch_id]


def stage_checked(h, raw, *, actor=0, tenant=0, source="ci-import", expected_rows=1, expected_errors=None):
    response = h.stage(raw, source=source, actor=actor, tenant=tenant)
    assert response.status_code == 201, response.text
    data = response.json()
    assert set(data) == {"id", "status", "created_at", "rows", "errors"}, "No raw CSV/payload echo"
    assert data["status"] == "staged" and data["rows"] == expected_rows
    assert data["errors"] == (expected_errors or []) and not data.get("duplicate")
    batch_id = data["id"]
    assert str(uuid.UUID(batch_id)) == batch_id and batch_id not in h.batches
    row = batch(h.snapshot(), batch_id)
    assert (str(row["organization_id"]), str(row["actor_user_id"]), row["source"], row["kind"]) == (
        h.orgs[tenant], h.users[actor], source, "people")
    assert row["fingerprint"] == hashlib.sha256(raw.encode("utf-8")).hexdigest()
    assert row["status"] == "staged" and row["committed_at"] is None and row["rolled_back_at"] is None
    assert row["errors"] == (expected_errors or [])
    audit = events(h, h.snapshot(), batch_id, actor, tenant, ["import.staged"])
    assert audit[0]["request_id"] == response.headers["x-request-id"]
    assert audit[0]["after_state"] == {"rows": expected_rows, "errors": len(expected_errors or []), "source": source}
    return batch_id


def duplicate_unchanged(h, raw, batch_id, status, *, tenant=0, actor=0, source="ci-import", errors=None):
    before = h.snapshot()
    response = h.stage(raw, tenant=tenant, actor=actor, source=source)
    assert response.status_code == 201, response.text
    assert response.json() == {"id": batch_id, "status": status, "errors": errors or [], "duplicate": True}
    assert h.snapshot() == before, "Duplicate fingerprint must not write people/batches/audit/domain"


@pytest.mark.parametrize("tenant", [0, 1], ids=["owner-org0", "admin-org1"])
@pytest.mark.parametrize("consent", ["false", "unknown"])
def test_pipeline_csv_roundtrip_fingerprint_and_idempotence(pipeline, tenant, consent):
    p, h = pipeline, pipeline.h
    old_id = h.people[tenant][0]
    new_key = "pipeline-" + str(uuid.uuid4())
    new_email = new_key + "@example.test"
    old_name, new_name = 'João, "A" 🎾', 'Ana, "B"\nSegunda linha 🎾'
    raw = csv_text(["external_id", "name", "email", "phone", "marketing_consent"], [
        [" ci-key-" + old_id + " ", old_name, "", "", consent],
        [new_key, new_name, new_email, "", "unknown"]])
    before = h.snapshot()
    original = person(before, old_id)
    batch_id = stage_checked(h, raw, tenant=tenant, actor=tenant, expected_rows=2)
    staged = h.snapshot()
    expected_payload = [
        {"external_id": "ci-key-" + old_id, "name": old_name, "email": "", "phone": "",
         "marketing_consent": False if consent == "false" else None},
        {"external_id": new_key, "name": new_name, "email": new_email, "phone": "", "marketing_consent": None}]
    assert batch(staged, batch_id)["payload"] == expected_payload
    assert staged["people"] == before["people"] and h.mutations == []
    assert len(staged["audit_events"]) == len(staged["domain_events"]) == 1
    assert_seeded_batches_unchanged(before, staged)
    duplicate_unchanged(h, raw, batch_id, "staged", tenant=tenant, actor=tenant)

    committed = h.commit(tenant=tenant, actor=tenant, batch=batch_id)
    assert committed.status_code == 200 and committed.json() == {"id": batch_id, "status": "committed", "count": 2}
    after = h.snapshot()
    row = batch(after, batch_id)
    changes = row["result"]["changes"]
    assert row["status"] == "committed" and row["result"]["count"] == 2
    assert row["payload"] == expected_payload and row["errors"] == []
    assert changes[0]["id"] == old_id and changes[0]["created"] is False
    assert business(changes[0]["before"]) == business(original)
    assert changes[1]["created"] is True
    new_id = changes[1]["id"]
    assert new_id not in {str(r["id"]) for r in before["people"]}
    updated, added = person(after, old_id), person(after, new_id)
    assert updated["full_name"] == old_name and updated["marketing_consent"] is (consent != "false")
    assert updated["email"] == original["email"] and updated["phone"] == original["phone"]
    assert updated["external_key"] == original["external_key"] and updated["source"] == "ci-import"
    assert (added["external_key"], added["full_name"], added["email"], added["phone"], added["marketing_consent"]) == (
        new_key, new_name, new_email, None, None)
    assert str(added["organization_id"]) == h.orgs[tenant] and added["source"] == "ci-import"
    assert updated["source_updated_at"] is not None and added["source_updated_at"] is not None
    assert [(m["op"], m["count"]) for m in h.mutations] == [("update", 1), ("insert", 1)]
    events(h, after, batch_id, tenant, tenant, ["import.staged", "import.committed"])
    second = h.commit(tenant=tenant, actor=tenant, batch=batch_id)
    assert second.status_code == 200 and second.json() == {"id": batch_id, "status": "committed", "result": row["result"]}
    assert h.snapshot() == after
    duplicate_unchanged(h, raw, batch_id, "committed", tenant=tenant, actor=tenant)

    rolled = h.rollback(tenant=tenant, actor=tenant, batch=batch_id)
    assert rolled.status_code == 200 and rolled.json() == {"id": batch_id, "status": "rolled_back"}
    final = h.snapshot()
    assert business(person(final, old_id)) == business(original)  # Existing timestamp semantics preserved.
    assert {str(r["id"]) for r in final["people"]} == {str(r["id"]) for r in before["people"]}
    for original_row in before["people"]:
        if str(original_row["id"]) != old_id:
            assert person(final, str(original_row["id"])) == original_row
    assert batch(final, batch_id)["result"] == row["result"]
    assert batch(final, batch_id)["status"] == "rolled_back"
    assert batch(final, batch_id)["payload"] == expected_payload
    assert_seeded_batches_unchanged(before, final)
    events(h, final, batch_id, tenant, tenant, ["import.staged", "import.committed", "import.rolled_back"])
    assert len(final["audit_events"]) == len(final["domain_events"]) == 3
    assert [(m["op"], m["count"]) for m in h.mutations] == [("update", 1), ("insert", 1), ("delete", 1), ("update", 1)]
    duplicate_unchanged(h, raw, batch_id, "rolled_back", tenant=tenant, actor=tenant)
    denied = h.commit(tenant=tenant, actor=tenant, batch=batch_id)
    assert denied.status_code == 409 and denied.json() == {"error": "IMPORT_STATE", "message": "Import is not staged."}
    assert h.snapshot() == final
    assert p.claims and {r["uid"] for r in p.claims} == {h.users[tenant]}
    p.passed = True


def test_pipeline_fingerprint_scope_and_foreign_access(pipeline):
    p, h = pipeline, pipeline.h
    raw = csv_text(["external_id", "name"], [["shared-key", "Fictional shared CSV 🎾"]])
    before = h.snapshot()
    a = stage_checked(h, raw, source="ci-scope", tenant=0, actor=0)
    b = stage_checked(h, raw, source="ci-scope", tenant=1, actor=1)
    other_source = stage_checked(h, raw, source="ci-other", tenant=0, actor=0)
    assert len({a, b, other_source}) == 3
    after = h.snapshot()
    assert len(after["import_batches"]) == len(before["import_batches"]) + 3
    assert len({batch(after, key)["fingerprint"] for key in (a, b, other_source)}) == 1
    assert after["people"] == before["people"] and h.mutations == []
    duplicate_unchanged(h, raw, a, "staged", source="ci-scope")
    duplicate_unchanged(h, raw, b, "staged", tenant=1, actor=1, source="ci-scope")
    duplicate_unchanged(h, raw, other_source, "staged", source="ci-other")
    assert len(after["audit_events"]) == len(after["domain_events"]) == 3
    with h.store.user(h.users[0]) as c:
        assert set(c.execute(text("select id::text from public.import_batches")).scalars()) == {h.batches[0], a, other_source}
    with h.store.user(h.users[1]) as c:
        assert set(c.execute(text("select id::text from public.import_batches")).scalars()) == {h.batches[1], b}
    forbidden = h.stage(raw, source="ci-scope", org=h.orgs[1], actor=0)
    assert forbidden.status_code == 403
    foreign = h.commit(batch=b, actor=0)
    assert foreign.status_code == 404 and foreign.json() == {"error": "IMPORT_NOT_FOUND", "message": "Import not found."}
    denied_rollback = h.rollback(batch=b, actor=0)
    assert denied_rollback.status_code == 409 and denied_rollback.json()["error"] == "IMPORT_STATE"
    for response in (forbidden, foreign, denied_rollback):
        assert "shared-key" not in response.text and "Fictional shared" not in response.text and b not in response.text
    assert h.snapshot() == after
    assert_seeded_batches_unchanged(before, after)
    p.passed = True


def test_pipeline_manager_can_stage_commit_but_cannot_rollback(pipeline):
    p, h = pipeline, pipeline.h
    h.set_role("manager")
    raw = csv_text(["external_id", "name", "marketing_consent"], [["manager-key", "Manager fixture", "false"]])
    batch_id = stage_checked(h, raw, actor=2)
    committed = h.commit(actor=2, batch=batch_id)
    assert committed.status_code == 200 and committed.json()["count"] == 1
    after = h.snapshot()
    assert batch(after, batch_id)["result"]["changes"][0]["created"] is True
    assert h.rollback(actor=2, batch=batch_id).status_code == 403
    assert h.snapshot() == after
    events(h, after, batch_id, 2, 0, ["import.staged", "import.committed"])
    assert len(after["audit_events"]) == len(after["domain_events"]) == 2
    assert {r["uid"] for r in p.claims} == {h.users[2]}
    p.passed = True


@pytest.mark.parametrize("denial", ["front_desk", "analyst", "support", "no-membership", "outsider", "missing-auth"])
def test_pipeline_stage_denial_has_no_persistence(pipeline, denial):
    p, h = pipeline, pipeline.h
    actor, authenticated = 2, True
    if denial == "outsider":
        actor = 3
    elif denial == "missing-auth":
        actor, authenticated = 0, False
    else:
        h.set_role(None if denial == "no-membership" else denial)
    raw = "email,name\nprivate-fixture@example.test,PRIVATE_CSV_VALUE\n"
    before = h.snapshot()
    response = h.stage(raw, actor=actor, authenticated=authenticated)
    assert response.status_code == (401 if denial == "missing-auth" else 403)
    assert "PRIVATE_CSV_VALUE" not in response.text and "private-fixture@example.test" not in response.text
    assert h.snapshot() == before and h.mutations == []
    if denial == "missing-auth":
        assert p.claims == []
    p.passed = True


@pytest.mark.parametrize("raw,code", [
    ('email,name\nvalid@example.test,Valid\n"UNTERMINATED_PRIVATE', "CSV"),
    ("email,email\nPRIVATE_A,PRIVATE_B\n", "CSV_HEADERS"),
    ("email\nprivate@example.test,PRIVATE_EXTRA\n", "CSV"),
    ("email,name\nprivate@example.test\n", "CSV"),
], ids=["unterminated", "duplicate-headers", "extra-cell", "missing-cell"])
def test_pipeline_structural_csv_error_is_atomic_redacted_422(pipeline, raw, code):
    p, h = pipeline, pipeline.h
    before = h.snapshot()
    response = h.stage(raw)
    assert response.status_code == 422 and response.json()["error"] == code
    assert "PRIVATE" not in response.text and "example.test" not in response.text
    assert h.snapshot() == before and h.mutations == [] and p.claims == []
    p.passed = True


def test_pipeline_semantic_partial_errors_stage_only_valid_rows(pipeline):
    p, h = pipeline, pipeline.h
    suffix = str(uuid.uuid4())
    valid, bad, unknown, blank = [f"{label}-{suffix}@example.test" for label in ("valid", "bad", "unknown", "blank")]
    raw = csv_text(["email", "name", "marketing_consent"], [
        [valid, "Valid João 🎾", "true"], [valid.upper(), "PRIVATE_DUPLICATE", "false"],
        ["", "PRIVATE_MISSING", "false"], [bad, "PRIVATE_BAD", "PRIVATE_INVALID"],
        [unknown, "Valid unknown", "unknown"], [blank, "Valid blank", ""]])
    errors = [{"line": 3, "error": "duplicate_in_file"}, {"line": 4, "error": "missing_identity"},
              {"line": 5, "error": "invalid_marketing_consent"}]
    before = h.snapshot()
    batch_id = stage_checked(h, raw, expected_rows=3, expected_errors=errors)
    staged = h.snapshot()
    payload = batch(staged, batch_id)["payload"]
    assert payload == [{"email": valid, "name": "Valid João 🎾", "marketing_consent": True},
                       {"email": unknown, "name": "Valid unknown", "marketing_consent": None},
                       {"email": blank, "name": "Valid blank", "marketing_consent": None}]
    assert staged["people"] == before["people"]
    duplicate_unchanged(h, raw, batch_id, "staged", errors=errors)
    response = h.commit(batch=batch_id)
    assert response.status_code == 200 and response.json()["count"] == 3
    after = h.snapshot()
    changes = batch(after, batch_id)["result"]["changes"]
    assert len(changes) == 3 and all(ch["created"] for ch in changes)
    added = [person(after, ch["id"]) for ch in changes]
    assert [row["email"] for row in added] == [valid, unknown, blank]
    assert [row["marketing_consent"] for row in added] == [True, None, None]
    assert bad not in [row["email"] for row in after["people"]]
    assert all("PRIVATE" not in row["full_name"] for row in added)
    assert h.rollback(batch=batch_id).status_code == 200
    final = h.snapshot()
    assert final["people"] == before["people"] and batch(final, batch_id)["errors"] == errors
    assert batch(final, batch_id)["payload"] == payload
    events(h, final, batch_id, 0, 0, ["import.staged", "import.committed", "import.rolled_back"])
    assert len(final["audit_events"]) == len(final["domain_events"]) == 3
    assert_seeded_batches_unchanged(before, final)
    p.passed = True
