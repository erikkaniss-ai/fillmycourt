"""Actual commit route with fictional results; transaction restoration is simulated.

No HTTP/Auth provider or database connection. Real PostgreSQL evidence lives in
the separately CI-gated test_fill_import_rollback_pg module.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import json

import pytest

from fmc.common import DomainError
from test_fill_import_preview import route, Result, TOKEN, ORG, USER, FOREIGN


BATCH = "44444444-4444-4444-8444-444444444444"
PERSON = "55555555-5555-4555-8555-555555555555"
NEW_PERSON = "66666666-6666-4666-8666-666666666666"
CONFLICT = {"error": "IMPORT_COMMIT_CONFLICT", "message": "Import commit requires review."}


class Outcome(Result):
    def __init__(self, row=None, rowcount=1):
        super().__init__(row)
        self.rowcount = rowcount


@pytest.fixture
def commit_route(route, monkeypatch):
    client, store = route
    store.batch = {"status": "staged", "source": "fictional-export", "result": {},
                   "payload": [{"external_id": "original-key", "name": "Imported fictional name"}]}
    store.people = {PERSON: {"id": PERSON, "organization_id": ORG, "external_key": "original-key",
        "full_name": "Original fictional person", "email": "fixture@example.test", "phone": None,
        "marketing_consent": True, "source": "fictional-export",
        "updated_at": datetime(2026, 1, 1, tzinfo=timezone.utc)}}
    store.counts = {PERSON: 1, NEW_PERSON: 1}
    store.mutations = []
    store.committed = store.aborted = 0
    store.last_error = None
    base_execute = store.execute

    def execute(statement, params):
        sql = str(statement)
        if "from public.organization_members" in sql or "select private.append_event" in sql:
            return base_execute(statement, params)
        store.statements.append((sql, params))
        if "select * from public.import_batches" in sql:
            return Outcome(deepcopy(store.batch) if params == {"id": BATCH, "org": ORG} else None)
        if "select * from public.people" in sql:
            assert params["org"] == ORG
            for person in store.people.values():
                if person["organization_id"] != params["org"]:
                    continue
                if ("external" in params and person["source"] == params["source"] and
                        person["external_key"] == params["external"]):
                    return Outcome(deepcopy(person))
                if ("email" in params and (person["email"] or "").lower() == params["email"].lower()):
                    return Outcome(deepcopy(person))
            return Outcome()
        if "update public.people set" in sql:
            store.mutations.append(("update", params["id"]))
            count = store.counts[params["id"]]
            if type(count) is int and count == 1:
                person = store.people[params["id"]]
                for param, column in [("external", "external_key"), ("name", "full_name"),
                                      ("email", "email"), ("phone", "phone")]:
                    if params[param] not in (None, ""):
                        person[column] = params[param]
                if params["consent"] is not None:
                    person["marketing_consent"] = params["consent"]
                person["source"] = params["source"]
            return Outcome(rowcount=count)
        if "insert into public.people" in sql:
            assert params["org"] == ORG
            store.mutations.append(("insert", NEW_PERSON))
            store.people[NEW_PERSON] = {"id": NEW_PERSON, "organization_id": ORG,
                "external_key": params["external"] or None, "full_name": params["name"] or None,
                "email": params["email"] or None, "phone": params["phone"] or None,
                "marketing_consent": params["consent"], "source": params["source"]}
            return Outcome({"id": NEW_PERSON})
        if "set status='committed'" in sql:
            store.batch.update(status="committed", result=json.loads(params["result"]))
            return Outcome()
        pytest.fail("Unexpected SQL in fictional import commit fixture")

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


def commit(route, org=ORG, batch=BATCH, headers=TOKEN):
    return route[0].post(f"/api/fmc/{org}/imports/{batch}/commit", headers=headers)


def assert_no_completion(store):
    assert not any("set status='committed'" in sql for sql, _ in store.statements)
    assert store.events == [] and store.committed == 0


@pytest.mark.parametrize("count", [0, -1, None, 2, True, 1.0, "1"],
                         ids=["zero", "unknown-minus-one", "unknown-none", "unexpected-two",
                              "boolean", "float", "string"])
def test_unconfirmed_update_denies_before_commit_result_and_audit(commit_route, count):
    store = commit_route[1]
    store.counts[PERSON] = count
    before = deepcopy((store.people, store.batch))
    response = commit(commit_route)
    assert response.status_code == 409, response.text
    assert response.json() == CONFLICT
    assert all(value not in response.text for value in (
        PERSON, ORG, "Imported fictional name", "fixture@example.test"))
    assert store.mutations == [("update", PERSON)], "No retry or fallback"
    assert (store.people, store.batch) == before
    assert store.aborted == 1 and isinstance(store.last_error, DomainError)
    assert_no_completion(store)


@pytest.mark.parametrize("create_first", [False, True], ids=["earlier-update", "earlier-create"])
def test_later_update_conflict_aborts_simulated_earlier_mutation(commit_route, create_first):
    store = commit_route[1]
    if create_first:
        first = {"external_id": "new-key", "name": "New fictional person"}
        first_id, first_op = NEW_PERSON, "insert"
    else:
        store.people[NEW_PERSON] = {**deepcopy(store.people[PERSON]),
                                  "id": NEW_PERSON, "external_key": "first-key"}
        first = {"external_id": "first-key", "name": "First fictional update"}
        first_id, first_op = NEW_PERSON, "update"
    store.batch["payload"].insert(0, first)
    store.counts[PERSON] = 0
    before = deepcopy((store.people, store.batch))
    response = commit(commit_route)
    assert response.status_code == 409, response.text
    assert response.json() == CONFLICT
    assert store.mutations == [(first_op, first_id), ("update", PERSON)]
    assert (store.people, store.batch) == before
    assert store.aborted == 1 and isinstance(store.last_error, DomainError)
    assert_no_completion(store)


@pytest.mark.parametrize("member_role", ["owner", "admin", "manager"])
@pytest.mark.parametrize("match", ["external-none", "email-blank-false"])
def test_exact_one_update_preserves_coalesce_values_and_before_state(commit_route, member_role, match):
    store = commit_route[1]
    store.members[(ORG, USER)] = member_role
    original = deepcopy(store.people[PERSON])
    store.batch["payload"] = ([{"external_id": "original-key", "name": None, "email": None,
                               "phone": None, "marketing_consent": None}] if match == "external-none" else
                             [{"external_id": "", "name": "", "email": "FIXTURE@example.test",
                               "phone": "", "marketing_consent": False}])
    response = commit(commit_route)
    assert response.status_code == 200, response.text
    assert response.json() == {"id": BATCH, "status": "committed", "count": 1}
    person = store.people[PERSON]
    assert person["full_name"] == original["full_name"] and person["phone"] is None
    assert person["external_key"] == original["external_key"]
    assert person["marketing_consent"] is (match == "external-none")
    assert person["email"] == (original["email"] if match == "external-none" else "FIXTURE@example.test")
    change = store.batch["result"]["changes"][0]
    assert change == {"id": PERSON, "created": False,
                      "before": {**original, "updated_at": str(original["updated_at"])}}
    assert store.committed == 1 and store.aborted == 0
    assert len(store.events) == 1 and store.events[0]["event_type"] == "import.committed"


def test_create_branch_and_idempotent_second_commit_are_preserved(commit_route):
    store = commit_route[1]
    store.batch["payload"] = [{"external_id": "new-key", "name": "New fictional person",
                               "marketing_consent": False}]
    response = commit(commit_route)
    assert response.status_code == 200, response.text
    assert response.json()["count"] == 1
    assert store.people[NEW_PERSON]["marketing_consent"] is False
    assert store.batch["result"] == {"changes": [{"id": NEW_PERSON, "created": True}], "count": 1}
    second = commit(commit_route)
    assert second.status_code == 200, second.text
    assert second.json() == {"id": BATCH, "status": "committed", "result": store.batch["result"]}
    assert store.mutations == [("insert", NEW_PERSON)] and len(store.events) == 1


@pytest.mark.parametrize("member_role", ["front_desk", "analyst", "support", None])
def test_nonmanager_cannot_commit(commit_route, member_role):
    store = commit_route[1]
    store.members = {(ORG, USER): member_role} if member_role else {}
    assert commit(commit_route).status_code == 403
    assert store.mutations == []
    assert_no_completion(store)


@pytest.mark.parametrize("denial", ["auth", "org", "batch"])
def test_auth_foreign_org_and_missing_batch_remain_denied(commit_route, denial):
    store = commit_route[1]
    if denial == "auth":
        response, status = commit(commit_route, headers={}), 401
        assert store.entered == 0
    elif denial == "org":
        response, status = commit(commit_route, org=FOREIGN), 403
    else:
        response, status = commit(commit_route, batch=FOREIGN), 404
        assert response.json() == {"error": "IMPORT_NOT_FOUND", "message": "Import not found."}
    assert response.status_code == status
    assert store.mutations == []
    assert_no_completion(store)


@pytest.mark.parametrize("status", ["rolled_back", "failed"])
def test_nonstaged_batch_cannot_commit(commit_route, status):
    store = commit_route[1]
    store.batch["status"] = status
    response = commit(commit_route)
    assert response.status_code == 409
    assert response.json() == {"error": "IMPORT_STATE", "message": "Import is not staged."}
    assert store.mutations == []
    assert_no_completion(store)
