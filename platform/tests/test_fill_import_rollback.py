"""Actual rollback route with fictional state and injected transaction results.

No engine, external HTTP/Auth or database is created. Snapshot restoration below
is simulated evidence, not PostgreSQL rollback, hosted persistence or RLS proof.
"""
from contextlib import contextmanager
from copy import deepcopy
from types import SimpleNamespace

import pytest

from fmc.common import DomainError
from fmc.supabase_v1 import V1Store
from test_fill_import_preview import route, Result, TOKEN, ORG, USER, FOREIGN


BATCH = "44444444-4444-4444-8444-444444444444"
PERSON_A = "55555555-5555-4555-8555-555555555555"
PERSON_B = "66666666-6666-4666-8666-666666666666"
CONFLICT = {"error": "IMPORT_ROLLBACK_CONFLICT", "message": "Import rollback requires review."}


class Outcome(Result):
    def __init__(self, row=None, rowcount=1):
        super().__init__(row)
        self.rowcount = rowcount


@pytest.fixture
def rollback_route(route, monkeypatch):
    client, store = route
    store.members[(ORG, USER)] = "admin"
    store.batch = {"status": "committed", "result": {"changes": [{"id": PERSON_A, "created": True}]}}
    store.people = {PERSON_A: {"full_name": "Fictional imported person"}}
    store.counts = {PERSON_A: 1}
    store.delete_attempts = []
    store.update_counts = {PERSON_A: 1}
    store.update_attempts = []
    store.person_attempts = []
    store.committed = store.aborted = 0
    store.last_error = None
    base_execute = store.execute

    def execute(statement, params):
        sql = str(statement)
        if "from public.organization_members" in sql or "select private.append_event" in sql:
            return base_execute(statement, params)
        store.statements.append((sql, params))
        if "select * from public.import_batches" in sql:
            assert params["org"] == ORG
            return Outcome(store.batch if params["id"] == BATCH else None)
        if "delete from public.people" in sql:
            assert params["org"] == ORG
            store.delete_attempts.append(params["id"])
            store.person_attempts.append(("delete", params["id"]))
            count = store.counts[params["id"]]
            if type(count) is int and count == 1:
                store.people.pop(params["id"])
            return Outcome(rowcount=count)
        if "update public.people set external_key" in sql:
            assert params["org"] == ORG
            store.update_attempts.append(params["id"])
            store.person_attempts.append(("update", params["id"]))
            count = store.update_counts[params["id"]]
            if type(count) is int and count == 1:
                store.people[params["id"]] = deepcopy(params)
            return Outcome(rowcount=count)
        if "update public.import_batches set status='rolled_back'" in sql:
            store.batch["status"] = "rolled_back"
            return Outcome()
        pytest.fail("Unexpected SQL in fictional rollback fixture")

    @contextmanager
    def user(uid, **kwargs):
        assert uid == USER
        store.entered += 1
        snapshot = deepcopy((store.people, store.batch, store.events))
        try:
            yield store
        except BaseException as error:
            store.people, store.batch, store.events = snapshot
            store.aborted += 1
            store.last_error = error
            raise
        else:
            store.committed += 1

    monkeypatch.setattr(store, "execute", execute)
    monkeypatch.setattr(store, "user", user)
    return client, store


def rollback(route, org=ORG, batch=BATCH, headers=TOKEN):
    return route[0].post(f"/api/fmc/{org}/imports/{batch}/rollback", headers=headers)


def assert_no_completion(store):
    assert not any("set status='rolled_back'" in sql for sql, _ in store.statements)
    assert store.events == []
    assert store.committed == 0


@pytest.mark.parametrize("count", [0, -1, None, 2, True, 1.0, "1"],
                         ids=["zero", "unknown-minus-one", "unknown-none", "unexpected-two",
                              "boolean", "float", "string"])
def test_unconfirmed_delete_denies_without_completion_or_audit(rollback_route, count):
    store = rollback_route[1]
    store.counts[PERSON_A] = count
    response = rollback(rollback_route)
    assert response.status_code == 409, response.text
    assert response.json() == CONFLICT
    assert PERSON_A not in response.text and ORG not in response.text
    assert store.delete_attempts == [PERSON_A], "No retry or fallback"
    assert store.batch["status"] == "committed" and PERSON_A in store.people
    assert store.aborted == 1 and isinstance(store.last_error, DomainError)
    assert_no_completion(store)


@pytest.mark.parametrize("member_role", ["owner", "admin"])
def test_exact_one_row_retains_success_for_admin_roles(rollback_route, member_role):
    store = rollback_route[1]
    store.members[(ORG, USER)] = member_role
    response = rollback(rollback_route)
    assert response.status_code == 200, response.text
    assert response.json() == {"id": BATCH, "status": "rolled_back"}
    assert store.people == {} and store.batch["status"] == "rolled_back"
    assert store.committed == 1 and store.aborted == 0
    assert store.events[0]["event_type"] == "import.rolled_back"


def test_later_blocked_delete_propagates_and_aborts_fake_transaction(rollback_route):
    store = rollback_route[1]
    store.batch["result"]["changes"] = [
        {"id": PERSON_B, "created": True}, {"id": PERSON_A, "created": True}]
    store.people[PERSON_B] = {"full_name": "Fictional protected person"}
    store.counts[PERSON_B] = 0
    before = deepcopy(store.people)
    response = rollback(rollback_route)
    assert response.status_code == 409, response.text
    assert response.json() == CONFLICT
    assert store.delete_attempts == [PERSON_A, PERSON_B], "Existing reversed change order"
    assert store.people == before and store.batch["status"] == "committed"
    assert store.aborted == 1 and isinstance(store.last_error, DomainError)
    assert_no_completion(store)


@pytest.mark.parametrize("member_role", ["owner", "admin"])
@pytest.mark.parametrize("source", ["fictional-export", None, "absent"])
def test_exact_one_update_restores_values_and_source_defaults(rollback_route, member_role, source):
    store = rollback_route[1]
    store.members[(ORG, USER)] = member_role
    before = {"external_key": "fixture-key", "full_name": "Original fictional name",
              "email": "fixture@example.test", "phone": None, "marketing_consent": False,
              "source": source}
    if source == "absent":
        del before["source"]
    store.batch["result"]["changes"] = [{"id": PERSON_A, "created": False, "before": before}]
    response = rollback(rollback_route)
    assert response.status_code == 200, response.text
    assert store.delete_attempts == []
    assert store.people[PERSON_A] == {"external": "fixture-key", "name": "Original fictional name",
        "email": "fixture@example.test", "phone": None, "consent": False,
        "source": "fmc" if source == "absent" else source, "id": PERSON_A, "org": ORG}
    assert store.update_attempts == [PERSON_A]
    assert store.committed == 1 and store.aborted == 0
    assert store.batch["status"] == "rolled_back"
    assert len(store.events) == 1 and store.events[0]["event_type"] == "import.rolled_back"


@pytest.mark.parametrize("count", [0, -1, None, 2, True, 1.0, "1"],
                         ids=["zero", "unknown-minus-one", "unknown-none", "unexpected-two",
                              "boolean", "float", "string"])
def test_unconfirmed_update_denies_without_completion_or_audit(rollback_route, count):
    store = rollback_route[1]
    store.batch["result"]["changes"] = [{"id": PERSON_A, "created": False, "before": {
        "full_name": "PRIVATE_FICTIONAL_NAME", "email": "private-fixture@example.test"}}]
    store.update_counts[PERSON_A] = count
    original = deepcopy(store.people)
    response = rollback(rollback_route)
    assert response.status_code == 409, response.text
    assert response.json() == CONFLICT
    assert all(value not in response.text for value in (
        PERSON_A, ORG, "PRIVATE_FICTIONAL_NAME", "private-fixture@example.test"))
    assert store.update_attempts == [PERSON_A] and store.delete_attempts == [], "No retry or fallback"
    assert store.people == original and store.batch["status"] == "committed"
    assert store.aborted == 1 and isinstance(store.last_error, DomainError)
    assert_no_completion(store)


@pytest.mark.parametrize("first_created,second_created", [(True, False), (False, False), (False, True)])
def test_later_conflict_aborts_mixed_changes_in_simulated_transaction(
        rollback_route, first_created, second_created):
    store = rollback_route[1]
    first = {"id": PERSON_A, "created": first_created, "before": {"full_name": "First restored"}}
    second = {"id": PERSON_B, "created": second_created, "before": {"full_name": "Second restored"}}
    store.batch["result"]["changes"] = [second, first]
    store.people[PERSON_B] = {"full_name": "Second imported"}
    store.update_counts.update({PERSON_A: 1, PERSON_B: 0})
    store.counts[PERSON_B] = 0
    original = deepcopy(store.people)
    response = rollback(rollback_route)
    assert response.status_code == 409, response.text
    assert response.json() == CONFLICT
    assert store.person_attempts == [
        ("delete" if first_created else "update", PERSON_A),
        ("delete" if second_created else "update", PERSON_B)]
    assert store.people == original and store.batch["status"] == "committed"
    assert store.aborted == 1 and isinstance(store.last_error, DomainError)
    assert_no_completion(store)


@pytest.mark.parametrize("member_role", ["manager", "front_desk", "analyst", "support", None])
def test_nonadmin_cannot_rollback(rollback_route, member_role):
    store = rollback_route[1]
    store.members = {(ORG, USER): member_role} if member_role else {}
    assert rollback(rollback_route).status_code == 403
    assert store.delete_attempts == []
    assert_no_completion(store)


def test_missing_auth_and_foreign_org_remain_denied(rollback_route):
    store = rollback_route[1]
    assert rollback(rollback_route, headers={}).status_code == 401
    assert store.entered == 0
    assert rollback(rollback_route, org=FOREIGN).status_code == 403
    assert store.delete_attempts == []
    assert_no_completion(store)


@pytest.mark.parametrize("status", [None, "staged", "rolled_back"])
def test_missing_or_not_committed_batch_retains_state_denial(rollback_route, status):
    store = rollback_route[1]
    if status is None:
        store.batch = None
    else:
        store.batch["status"] = status
    response = rollback(rollback_route)
    assert response.status_code == 409
    assert response.json() == {"error": "IMPORT_STATE", "message": "Only a committed import can be rolled back."}
    assert store.delete_attempts == []
    assert_no_completion(store)


def test_real_v1_user_context_passes_conflict_to_engine_transaction_exit():
    # Exercise the actual existing V1Store.user context manager, with an engine
    # boundary double. This proves exception propagation, not a database rollback.
    conflict = DomainError("IMPORT_ROLLBACK_CONFLICT", "Import rollback requires review.", 409)
    exits = []

    class Transaction:
        def __enter__(self):
            return SimpleNamespace(execute=lambda *args, **kwargs: None)

        def __exit__(self, error_type, error, traceback):
            exits.append((error_type, error))
            return False

    store = V1Store.__new__(V1Store)
    store.engine = SimpleNamespace(begin=Transaction)
    with pytest.raises(DomainError) as exc:
        with store.user(USER):
            raise conflict
    assert exc.value is conflict
    assert exits == [(DomainError, conflict)]
