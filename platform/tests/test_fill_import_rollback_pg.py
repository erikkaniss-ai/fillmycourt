"""Actual import rollback transactions/RLS in the disposable CI PostgreSQL 16.

Never a hosted Supabase/Auth/UAT test. The CI auth.users(id) contract stub is
seeded only after target/server/schema checks. Auth is an explicit fake; route,
V1Store.user, SQL results, policies, commit/rollback and persisted reads are real.
No database connections are opened during import or offline gate tests.
"""
import json
import os
from types import SimpleNamespace
import uuid

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.pool import NullPool

from fmc import v1_app
from fmc.common import DomainError
from fmc.config import Settings
from fmc.fill_uat_guard import Guard
from fmc.supabase_v1 import Actor, V1Store


CI_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/fmc_test"
CONFLICT = {"error": "IMPORT_ROLLBACK_CONFLICT", "message": "Import rollback requires review."}
BEFORE = {"external_key": None, "full_name": "CI original fictional person",
          "email": None, "phone": None, "marketing_consent": False}


def ci_database_url(environ):
    """Validate before engine creation; query overrides/remote fallbacks forbidden."""
    if environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("Disposable GitHub CI required")
    try:
        url = make_url(environ.get("TEST_DATABASE_URL", ""))
    except (ArgumentError, ValueError):
        raise ValueError("Disposable CI database required") from None
    if (url.drivername != "postgresql+psycopg" or
            url.host not in {"localhost", "127.0.0.1"} or url.port != 5432 or
            url.database != "fmc_test" or url.username != "postgres" or
            url.password != "postgres" or url.query):
        raise ValueError("Disposable CI database required")
    return url


@pytest.mark.parametrize("flag", [None, "false", "True"])
def test_pg16_target_rejects_non_ci_before_any_engine(flag):
    with pytest.raises(ValueError, match="Disposable GitHub CI required"):
        ci_database_url({"GITHUB_ACTIONS": flag, "TEST_DATABASE_URL": CI_URL})


@pytest.mark.parametrize("url", [
    "", "not-a-url", CI_URL.replace("127.0.0.1", "db.example.test"),
    CI_URL.replace(":5432/", ":5433/"), CI_URL.replace("/fmc_test", "/postgres"),
    CI_URL.replace("postgres:postgres@", "other:postgres@"),
    CI_URL.replace("+psycopg", ""), CI_URL + "?hostaddr=203.0.113.1",
    CI_URL + "?dbname=other", CI_URL + "?options=-c%20role%3Dpostgres",
])
def test_pg16_target_rejects_unreviewed_database_before_any_engine(url):
    with pytest.raises(ValueError):
        ci_database_url({"GITHUB_ACTIONS": "true", "TEST_DATABASE_URL": url})


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1"])
def test_pg16_target_accepts_only_reviewed_ci_shape(host):
    assert ci_database_url({"GITHUB_ACTIONS": "true",
        "TEST_DATABASE_URL": CI_URL.replace("127.0.0.1", host)}).host == host


@pytest.fixture
def pg_rollback(monkeypatch, request, capsys):
    if os.environ.get("GITHUB_ACTIONS") != "true":
        pytest.skip("Actual rollback PostgreSQL proof runs only in disposable CI")
    url = ci_database_url(os.environ)  # Must precede BOTH engine constructors.
    options = {"options": "-c statement_timeout=5000 -c lock_timeout=1000", "connect_timeout": 2}
    store = V1Store.__new__(V1Store)
    store.engine = create_engine(url, pool_size=1, max_overflow=0, pool_timeout=2,
                                pool_pre_ping=True, connect_args=options)
    observer = create_engine(url, poolclass=NullPool, connect_args=options)
    users = [str(uuid.uuid4()) for _ in range(4)]
    orgs, batches = ([str(uuid.uuid4()) for _ in range(2)] for _ in range(2))
    people = [[str(uuid.uuid4()) for _ in range(3)] for _ in range(2)]
    h = SimpleNamespace(store=store, users=users, orgs=orgs, batches=batches,
                        people=people, mutations=[], completions=[], observer_pids=[])

    def snapshot():
        # NullPool forces a new physical connection, outside the route transaction.
        with observer.connect() as c:
            h.observer_pids.append(c.execute(text("select pg_backend_pid()")).scalar_one())
            return {table: [dict(row) for row in c.execute(text(
                f"select * from public.{table} where organization_id in "
                "(cast(:a as uuid),cast(:b as uuid)) order by id"),
                {"a": orgs[0], "b": orgs[1]}).mappings()] for table in (
                    "people", "import_batches", "audit_events", "domain_events")}

    def configure(changes, tenant=0, status="committed"):
        with observer.begin() as c:
            c.execute(text("""update public.import_batches set result=cast(:result as jsonb),status=:status
                              where id=cast(:batch as uuid)"""),
                      {"result": json.dumps({"changes": changes}), "status": status,
                       "batch": batches[tenant]})

    def set_role(role):
        with observer.begin() as c:
            c.execute(text("delete from public.organization_members where user_id=cast(:uid as uuid)"),
                      {"uid": users[2]})
            if role is not None:
                c.execute(text("""insert into public.organization_members(organization_id,user_id,role)
                    values(cast(:org as uuid),cast(:uid as uuid),cast(:role as public.fmc_member_role))"""),
                          {"org": orgs[0], "uid": users[2], "role": role})

    def proven():
        assert all(m["state"]["pid"] not in h.observer_pids for m in h.mutations)
        # A stable, non-secret execution receipt is visible despite pytest -qq.
        with capsys.disabled():
            print("FILL_ROLLBACK_PG16_PASS " + request.node.name, flush=True)

    def record(c, cursor, statement, parameters, context, executemany):
        sql = " ".join(statement.lower().split())
        if sql.startswith(("update public.people ", "delete from public.people ")):
            count = cursor.rowcount  # Actual driver result, never injected.
            state = dict(c.execute(text("""select pg_backend_pid() as pid,current_user as role,
                current_setting('request.jwt.claim.sub') as uid,
                (select rolbypassrls from pg_roles where rolname=current_user) as bypass""")).mappings().one())
            assert state["role"] == "authenticated" and state["bypass"] is False
            visible = [dict(r) for r in c.execute(text(
                "select id::text,organization_id::text,full_name from public.people order by id")).mappings()]
            h.mutations.append({"op": sql.split()[0], "count": count,
                                "state": state, "visible": visible})
        if "update public.import_batches set status='rolled_back'" in sql:
            h.completions.append("batch")
        if sql.startswith("select private.append_event("):
            h.completions.append("audit")

    try:
        with observer.begin() as c:
            assert 160000 <= int(c.execute(text("show server_version_num")).scalar_one()) < 170000
            assert c.execute(text("select current_database()")).scalar_one() == "fmc_test"
            assert c.execute(text("""select column_name from information_schema.columns
                where table_schema='auth' and table_name='users' order by ordinal_position""")).scalars().all() == ["id"]
            assert c.execute(text("""select bool_and(relrowsecurity) from pg_class
                where oid in ('public.people'::regclass,'public.import_batches'::regclass)""")).scalar_one() is True
            # ONLY the disposable CI auth contract table, never Supabase Auth.
            for uid in users:
                c.execute(text("insert into auth.users(id) values(cast(:uid as uuid))"), {"uid": uid})
            for i, org in enumerate(orgs):
                c.execute(text("""insert into public.organizations(id,slug,name)
                    values(cast(:org as uuid),:slug,'CI fictional rollback club')"""),
                          {"org": org, "slug": "ci-rollback-" + org})
                c.execute(text("""insert into public.organization_members(organization_id,user_id,role)
                    values(cast(:org as uuid),cast(:uid as uuid),cast(:role as public.fmc_member_role))"""),
                          {"org": org, "uid": users[i], "role": "owner" if i == 0 else "admin"})
                for j, person in enumerate(people[i]):
                    c.execute(text("""insert into public.people(id,organization_id,auth_user_id,
                        external_key,full_name,email,phone,marketing_consent,source)
                        values(cast(:id as uuid),cast(:org as uuid),cast(:uid as uuid),
                               :external,'CI imported fictional person','imported@example.test',
                               '+351000000000',true,'ci-import')"""),
                              {"id": person, "org": org, "uid": users[i] if j == 2 else None,
                               "external": "ci-key-" + person})
                c.execute(text("""insert into public.import_batches(id,organization_id,source,kind,
                    fingerprint,status,actor_user_id,committed_at)
                    values(cast(:id as uuid),cast(:org as uuid),'ci-import','people',:fp,
                           'committed',cast(:uid as uuid),now())"""),
                          {"id": batches[i], "org": org, "fp": batches[i], "uid": users[i]})

        class FictionalAuth:
            def verify(self, authorization):
                for i, uid in enumerate(users):
                    if authorization == "Bearer fictional-ci-" + str(i):
                        return Actor(uid)
                raise DomainError("AUTH_REQUIRED", "Sign in.", 401)

        event.listen(store.engine, "after_cursor_execute", record)
        monkeypatch.setattr(v1_app, "V1Store", lambda _: store)
        monkeypatch.setattr(v1_app, "fill_guard_from_environment", lambda *_: Guard())
        monkeypatch.setattr("fmc.fill_uat_server_validator.from_environment", lambda *_: None)
        app = v1_app.create_v1_app(Settings(origin="http://testserver", environment="test"),
                                   "operations", auth_override=FictionalAuth())
        with TestClient(app, raise_server_exceptions=False) as client:
            def rollback(tenant=0, actor=0, batch=None, org=None, authenticated=True):
                headers = {"Authorization": "Bearer fictional-ci-" + str(actor)} if authenticated else {}
                return client.post(f"/api/fmc/{org or orgs[tenant]}/imports/{batch or batches[tenant]}/rollback",
                                   headers=headers)
            h.snapshot, h.configure, h.set_role, h.proven, h.rollback = snapshot, configure, set_role, proven, rollback
            yield h
    finally:
        store.engine.dispose()
        observer.dispose()


def updated(person):
    return {"id": person, "created": False, "before": dict(BEFORE)}


def created(person):
    return {"id": person, "created": True}


def assert_conflict(h, response, before):
    assert response.status_code == 409, response.text
    assert response.json() == CONFLICT
    assert all(value not in response.text for value in h.orgs + sum(h.people, []))
    assert "example.test" not in response.text and "fictional person" not in response.text
    assert h.completions == []
    assert h.snapshot() == before, "Independent committed readback must show no partial rollback"


@pytest.mark.parametrize("tenant", [0, 1], ids=["owner", "admin"])
def test_pg16_route_success_restores_update_deletes_created_and_audits_once(pg_rollback, tenant):
    h = pg_rollback
    person, new, _ = h.people[tenant]
    h.configure([created(new), updated(person)], tenant)
    response = h.rollback(tenant=tenant, actor=tenant)
    assert response.status_code == 200, response.text
    assert response.json() == {"id": h.batches[tenant], "status": "rolled_back"}
    assert [(m["op"], m["count"]) for m in h.mutations] == [("update", 1), ("delete", 1)]
    assert all(m["state"]["uid"] == h.users[tenant] for m in h.mutations)
    assert all(r["organization_id"] == h.orgs[tenant] for m in h.mutations for r in m["visible"])
    after = h.snapshot()
    rows = {str(r["id"]): r for r in after["people"]}
    assert new not in rows
    assert {k: rows[person][k] for k in BEFORE} == BEFORE
    assert rows[person]["source"] == "fmc", "Existing source default preserved"
    batch = next(r for r in after["import_batches"] if str(r["id"]) == h.batches[tenant])
    assert batch["status"] == "rolled_back" and batch["rolled_back_at"] is not None
    for table, key in [("audit_events", "entity_id"), ("domain_events", "aggregate_id")]:
        assert len(after[table]) == 1
        row = after[table][0]
        assert row["event_type"] == "import.rolled_back" and str(row[key]) == h.batches[tenant]
        assert str(row["organization_id"]) == h.orgs[tenant]
    assert str(after["audit_events"][0]["actor_user_id"]) == h.users[tenant]
    assert after["audit_events"][0]["request_id"] == response.headers["x-request-id"]
    assert h.completions == ["batch", "audit"]
    h.proven()


@pytest.mark.parametrize("target", ["missing", "foreign"])
def test_pg16_route_zero_update_denies_without_persisted_completion(pg_rollback, target):
    h = pg_rollback
    person = str(uuid.uuid4()) if target == "missing" else h.people[1][0]
    h.configure([updated(person)])
    before = h.snapshot()
    assert_conflict(h, h.rollback(), before)
    assert [(m["op"], m["count"]) for m in h.mutations] == [("update", 0)]
    h.proven()


def test_pg16_route_protected_created_person_delete_denies_without_completion(pg_rollback):
    h = pg_rollback
    h.configure([created(h.people[0][2])])  # Linked to an auth-contract identity.
    before = h.snapshot()
    assert_conflict(h, h.rollback(), before)
    assert [(m["op"], m["count"]) for m in h.mutations] == [("delete", 0)]
    h.proven()


@pytest.mark.parametrize("first_op", ["update", "delete"])
@pytest.mark.parametrize("failure", ["missing-update", "foreign-update", "protected-delete"])
def test_pg16_route_mixed_failure_rolls_back_earlier_real_mutation(pg_rollback, first_op, failure):
    h = pg_rollback
    person = h.people[0][0 if first_op == "update" else 1]
    first = updated(person) if first_op == "update" else created(person)
    failed = (created(h.people[0][2]) if failure == "protected-delete" else
              updated(h.people[1][0] if failure == "foreign-update" else str(uuid.uuid4())))
    h.configure([failed, first])  # Real handler intentionally reverses import order.
    before = h.snapshot()
    assert_conflict(h, h.rollback(), before)
    assert [(m["op"], m["count"]) for m in h.mutations] == [
        (first_op, 1), ("delete" if failure == "protected-delete" else "update", 0)]
    inside = {r["id"]: r for r in h.mutations[0]["visible"]}
    if first_op == "update":
        assert inside[person]["full_name"] == BEFORE["full_name"]
    else:
        assert person not in inside
    assert all(m["state"]["uid"] == h.users[0] for m in h.mutations)
    h.proven()


def test_pg16_real_rls_hides_foreign_people_and_batch_without_route_predicates(pg_rollback):
    h = pg_rollback
    before = h.snapshot()
    with h.store.user(h.users[0]) as c:
        assert c.execute(text("select id::text from public.import_batches")).scalars().all() == [h.batches[0]]
        assert set(c.execute(text("select id::text from public.people")).scalars()) == set(h.people[0])
        assert c.execute(text("update public.people set full_name='CI foreign denied' where id=cast(:id as uuid)"),
                         {"id": h.people[1][0]}).rowcount == 0
        assert c.execute(text("delete from public.people where id=cast(:id as uuid)"),
                         {"id": h.people[1][1]}).rowcount == 0
    assert h.snapshot() == before
    assert [m["count"] for m in h.mutations] == [0, 0]
    h.proven()


@pytest.mark.parametrize("role", ["manager", "front_desk", "analyst", "support", None])
def test_pg16_route_denies_nonadmin_before_mutation(pg_rollback, role):
    h = pg_rollback
    h.set_role(role)
    h.configure([updated(h.people[0][0])])
    before = h.snapshot()
    assert h.rollback(actor=2).status_code == 403
    assert h.snapshot() == before and h.mutations == h.completions == []
    h.proven()


@pytest.mark.parametrize("denial", ["unauthenticated", "outsider", "foreign-org", "foreign-batch"])
def test_pg16_route_auth_and_tenant_fences_preserve_state(pg_rollback, denial):
    h = pg_rollback
    h.configure([updated(h.people[0][0])])
    before = h.snapshot()
    if denial == "unauthenticated":
        response, status = h.rollback(authenticated=False), 401
    elif denial == "outsider":
        response, status = h.rollback(actor=3), 403
    elif denial == "foreign-org":
        response, status = h.rollback(org=h.orgs[1], batch=h.batches[1]), 403
    else:
        response, status = h.rollback(batch=h.batches[1]), 409
        assert response.json()["error"] == "IMPORT_STATE"
    assert response.status_code == status, response.text
    assert h.snapshot() == before and h.mutations == h.completions == []
    h.proven()


@pytest.mark.parametrize("status", ["staged", "rolled_back", "failed"])
def test_pg16_route_batch_state_denial_has_no_success_audit(pg_rollback, status):
    h = pg_rollback
    h.configure([updated(h.people[0][0])], status=status)
    before = h.snapshot()
    response = h.rollback()
    assert response.status_code == 409, response.text
    assert response.json()["error"] == "IMPORT_STATE"
    assert h.snapshot() == before and h.mutations == h.completions == []
    h.proven()
