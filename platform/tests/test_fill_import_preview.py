"""Fictional, offline people-import regressions through the existing API route."""
from contextlib import contextmanager
import csv
import hashlib
import json

from fastapi.testclient import TestClient
import pytest

from fmc.common import DomainError
from fmc.config import Settings
from fmc.fill_uat_guard import Guard
from fmc.fill_import_preview import parse_people_csv
from fmc.supabase_v1 import Actor, V1Store
from fmc import v1_app


USER = "11111111-1111-4111-8111-111111111111"
ORG = "22222222-2222-4222-8222-222222222222"
FOREIGN = "33333333-3333-4333-8333-333333333333"
TOKEN = {"Authorization": "Bearer fictional-import"}


class Result:
    def __init__(self, row=None):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class MemoryStore(V1Store):
    """No engine or IO; retain the real require_role/role/emit implementation."""
    def __init__(self):
        self.engine = object()
        self.members = {(ORG, USER): "manager"}
        self.entered = 0
        self.statements = []
        self.batches = []
        self.events = []

    @contextmanager
    def user(self, user_id, **kwargs):
        assert user_id == USER
        self.entered += 1
        yield self

    def execute(self, statement, params):
        sql = str(statement)
        self.statements.append((sql, params))
        if "from public.organization_members" in sql:
            role = self.members.get((params["org"], params["uid"]))
            return Result({"role": role} if role else None)
        if "from public.import_batches" in sql:
            batch = next((b for b in self.batches if all(
                b[k] == params[k] for k in ("org", "source", "fp"))), None)
            return Result({"id": batch["id"], "status": "staged",
                           "errors": json.loads(batch["errors"])} if batch else None)
        if "insert into public.import_batches" in sql:
            batch = {**params, "id": "44444444-4444-4444-8444-444444444444"}
            self.batches.append(batch)
            return Result({"id": batch["id"], "status": "staged", "created_at": None})
        if "select private.append_event" in sql:
            self.events.append(params)
            return Result()
        pytest.fail("Unexpected SQL in offline import fixture")


@pytest.fixture
def route(monkeypatch):
    store = MemoryStore()

    class Auth:
        def verify(self, authorization):
            if authorization != TOKEN["Authorization"]:
                raise DomainError("AUTH_REQUIRED", "Sign in.", 401)
            return Actor(USER)

    monkeypatch.setattr(v1_app, "V1Store", lambda _: store)
    monkeypatch.setattr(v1_app, "fill_guard_from_environment", lambda *_: Guard())
    monkeypatch.setattr("fmc.fill_uat_server_validator.from_environment", lambda *_: None)
    settings = Settings(origin="http://testserver", environment="test")
    app = v1_app.create_v1_app(settings, "operations", auth_override=Auth())
    return TestClient(app, raise_server_exceptions=False), store


def submit(route, raw, org=ORG, headers=TOKEN):
    return route[0].post(f"/api/fmc/{org}/imports", headers=headers,
                         json={"source": "fictional-export", "csv": raw})


def test_optional_email_header_is_supported(route):
    response = submit(route, "phone,name\n+351000000000,Fictional\n,No identity\n")
    assert response.status_code == 201, response.text
    assert response.json()["rows"] == 1
    assert response.json()["errors"] == [{"line": 3, "error": "missing_identity"}]
    assert json.loads(route[1].batches[0]["payload"])[0]["phone"] == "+351000000000"


@pytest.mark.parametrize("raw,code", [
    ("email\nvalid@example.test\nsentinel@example.test,EXTRA_SENTINEL\n", "CSV"),
    ("email,name\nvalid@example.test,Valid\nsentinel@example.test\n", "CSV"),
    ('email\nvalid@example.test\n"UNTERMINATED_SENTINEL', "CSV"),
    ("email,email\nSENTINEL_A,SENTINEL_B\n", "CSV_HEADERS"),
])
def test_structural_rejection_precedes_all_persistence(route, raw, code):
    response = submit(route, raw)
    assert response.status_code == 422, response.text
    assert response.json()["error"] == code
    assert "SENTINEL" not in response.text and "@example.test" not in response.text
    store = route[1]
    assert store.entered == 0
    assert store.statements == store.batches == store.events == []


@pytest.mark.parametrize("role,expected", [
    ("owner", 201), ("admin", 201), ("manager", 201),
    ("front_desk", 403), ("analyst", 403), ("support", 403), (None, 403),
])
def test_existing_role_fence_before_staging_or_audit(route, role, expected):
    store = route[1]
    store.members = {(ORG, USER): role} if role else {}
    response = submit(route, "email\nfixture@example.test\n")
    assert response.status_code == expected, response.text
    assert len(store.batches) == len(store.events) == int(expected == 201)


def test_authentication_and_foreign_org_cannot_stage(route):
    assert submit(route, "email\nfixture@example.test\n", headers={}).status_code == 401
    assert route[1].entered == 0
    assert submit(route, "email\nfixture@example.test\n", org=FOREIGN).status_code == 403
    assert route[1].batches == route[1].events == []


def test_partial_errors_fingerprint_duplicate_and_audit_stay_scoped(route):
    raw = "email\n Fixture@example.test \nfixture@example.test\n"
    response = submit(route, raw)
    assert response.status_code == 201, response.text
    assert response.json()["errors"] == [{"line": 3, "error": "duplicate_in_file"}]
    batch = route[1].batches[0]
    assert (batch["org"], batch["uid"], batch["fp"]) == (ORG, USER, hashlib.sha256(raw.encode()).hexdigest())
    assert json.loads(batch["payload"]) == [{"email": "Fixture@example.test", "marketing_consent": None}]
    assert route[1].events[0]["event_type"] == "import.staged"
    duplicate = submit(route, raw)
    assert duplicate.status_code == 201 and duplicate.json()["duplicate"] is True
    assert len(route[1].batches) == len(route[1].events) == 1


@pytest.mark.parametrize("raw,expected", [
    ("external_id\n  fixture-id  \n", [{"external_id": "fixture-id", "marketing_consent": None}]),
    ("email\n Case@Example.test \n", [{"email": "Case@Example.test", "marketing_consent": None}]),
    ("phone\n +351000000000 \n", [{"phone": "+351000000000", "marketing_consent": None}]),
    ("name\nFictional\n", []),
    ("email,name\n\n , \n", []),
    ("email\n", []),
    ('name,email\r\n"Fictional, O""Neil\r\nSecond line",fixture@example.test\r\n',
     [{"name": 'Fictional, O"Neil\r\nSecond line', "email": "fixture@example.test", "marketing_consent": None}]),
    ("name,phone\nJoão 🎾,+351000000000\n", [{"name": "João 🎾", "phone": "+351000000000", "marketing_consent": None}]),
])
def test_supported_header_subsets_order_whitespace_and_unicode(raw, expected):
    staged, errors = parse_people_csv(raw)
    assert staged == expected
    assert errors == ([{"line": 2, "error": "missing_identity"}] if raw.startswith("name\n") else [])


def test_identity_precedence_and_case_sensitive_external_ids():
    raw = ("external_id,email,phone\n"
           "ID,one@example.test,+100\n"
           "ID,two@example.test,+200\n"
           "id,one@example.test,+100\n"
           ",One@Example.test,+100\n"
           ",one@example.test,+200\n"
           ",,+100\n"
           ",,+100\n")
    staged, errors = parse_people_csv(raw)
    assert [r["external_id"] for r in staged] == ["ID", "id", "", ""]
    assert staged[2]["email"] == "One@Example.test"
    assert errors == [{"line": n, "error": "duplicate_in_file"} for n in (3, 6, 8)]


def test_consent_partial_errors_and_seen_reservation_are_preserved():
    staged, errors = parse_people_csv(
        "email,marketing_consent\n"
        "invalid@example.test,SENTINEL_INVALID\n"
        "INVALID@example.test,true\n"
        "true@example.test, TRUE \n"
        "false@example.test,false\n"
        "unknown@example.test,Unknown\n"
        "blank@example.test,\n"
        ",false\n")
    assert [r["marketing_consent"] for r in staged] == [True, False, None, None]
    assert errors == [{"line": 2, "error": "invalid_marketing_consent"},
                      {"line": 3, "error": "duplicate_in_file"},
                      {"line": 8, "error": "missing_identity"}]
    assert "SENTINEL" not in json.dumps(errors)


def test_error_numbers_are_logical_records_including_whitespace_rows():
    staged, errors = parse_people_csv('email,name\n\n,"Fictional\nmultiline"\n , \n,Missing\n')
    assert staged == []
    assert errors == [{"line": 2, "error": "missing_identity"},
                      {"line": 4, "error": "missing_identity"}]


@pytest.mark.parametrize("raw,code", [
    ("\n", "CSV_HEADERS"),
    (",email\nSENTINEL,fixture@example.test\n", "CSV_HEADERS"),
    ("email,unknown_SENTINEL\nfixture@example.test,value\n", "CSV_HEADERS"),
    (" email\nSENTINEL\n", "CSV_HEADERS"),
    ("\ufeffemail\nSENTINEL\n", "CSV_HEADERS"),
    ("email,email\nSENTINEL,SENTINEL\n", "CSV_HEADERS"),
    ('"HEADER_SENTINEL', "CSV"),
    ('email\n"SENTINEL"junk\n', "CSV"),
    ("email,name\nSENTINEL\n", "CSV"),
    ("email\nSENTINEL,extra\n", "CSV"),
    ("email\n\ud800SENTINEL\n", "CSV"),
])
def test_structural_errors_are_fixed_and_redacted(raw, code):
    with pytest.raises(DomainError) as exc:
        parse_people_csv(raw)
    error = exc.value
    assert (error.code, error.status) == (code, 422)
    assert error.message == ("Malformed CSV." if code == "CSV" else
                             "Use external_id,name,email,phone,marketing_consent headers.")
    assert "SENTINEL" not in str(error)
    assert error.__cause__ is None


@pytest.mark.parametrize("raw", [None, 42, b"email\n", "", "x" * 2_500_001],
                         ids=["none", "number", "bytes", "empty", "over-character-cap"])
def test_direct_helper_input_bound_matches_import_model(raw):
    with pytest.raises(DomainError) as exc:
        parse_people_csv(raw)
    assert (exc.value.code, exc.value.status) == ("CSV", 422)


def test_character_cap_is_not_a_byte_cap_or_a_new_row_cap():
    # Large but legal file, each field below the inherited CSV field limit.
    prefix = "name\n" + "🎾\n" * 70_000
    raw = prefix + "\n" * (2_500_000 - len(prefix))
    staged, errors = parse_people_csv(raw)
    assert staged == [] and len(errors) == 70_000
    assert len(raw.encode()) > len(raw)
    assert v1_app.ImportIn(source="fictional", csv=raw).csv == raw


def test_csv_field_limit_is_not_raised_and_failure_is_redacted():
    limit = csv.field_size_limit()
    with pytest.raises(DomainError) as exc:
        parse_people_csv("email\nSENTINEL" + "x" * limit)
    assert (exc.value.code, exc.value.message, exc.value.status) == ("CSV", "Malformed CSV.", 422)
    assert csv.field_size_limit() == limit


@pytest.mark.parametrize("raw", ["", "x" * 2_500_001], ids=["empty", "over-character-cap"])
def test_route_model_bound_rejects_before_database(route, raw):
    assert submit(route, raw).status_code == 422
    assert route[1].entered == 0


def test_parser_is_repeatable_without_file_network_or_database_io(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Pure CSV helper attempted IO")

    with monkeypatch.context() as scoped:
        scoped.setattr("builtins.open", forbidden)
        scoped.setattr("socket.create_connection", forbidden)
        scoped.setattr("sqlalchemy.create_engine", forbidden)
        first = parse_people_csv("phone\n+351000000000\n")
        second = parse_people_csv("phone\n+351000000000\n")
    assert first == second
    first[0][0]["phone"] = "mutated"
    assert second[0][0]["phone"] == "+351000000000"
