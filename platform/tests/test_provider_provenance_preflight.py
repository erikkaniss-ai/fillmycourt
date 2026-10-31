"""Pure redacted readiness evaluation; no network, credentials or DB access."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from fmc.common import DomainError
from fmc.provider_provenance_preflight import preflight_result, registered_get_routes, ROUTES

NOW = datetime(2026, 10, 21, tzinfo=timezone.utc)
SHA = "a" * 40
FACTS = {key: True for key in ("owner_admin_scope", "authenticated_rls_context",
    "repeatable_read_only", "schema_rls_select", "reader_columns_present", "get_routes_present")}


def result(**kwargs):
    args = dict(expected_sha=SHA, runtime_sha=SHA, service="operations",
                environment="staging", provider_flag="false", facts=FACTS, now=NOW)
    return preflight_result(**{**args, **kwargs})


def test_checks_passed_never_means_hosted_uat_or_pilot_or_deploy_go():
    report = result()
    assert report["status"] == "operations_checks_passed"
    assert report["operations_runtime_sha"] == SHA
    for flag in ("hosted_uat_ready", "uat_accepted", "pilot_ready",
                 "provider_requests_allowed", "can_display_available_slots", "deploy_allowed"):
        assert report[flag] is False
    assert "protected_host" in report["not_assessed"]
    assert "worker_provider_read_state" in report["not_assessed"]


@pytest.mark.parametrize("fact", FACTS)
@pytest.mark.parametrize("bad", [False, None, 1, "true"])
def test_every_database_or_route_fact_requires_explicit_true(fact, bad):
    report = result(facts={**FACTS, fact: bad})
    assert report["status"] == "blocked"
    assert report["checks"][fact] == "blocked"


@pytest.mark.parametrize("runtime_sha", [None, "", "short", "b" * 40,
                                        "postgresql://never-disclose", "A" * 40])
def test_missing_invalid_or_wrong_runtime_revision_stays_blocked(runtime_sha):
    report = result(runtime_sha=runtime_sha)
    assert report["status"] == "blocked"
    if runtime_sha != "b" * 40:
        assert report["operations_runtime_sha"] is None
    assert "never-disclose" not in str(report)


@pytest.mark.parametrize("field,value", [
    ("service", "core"), ("service", "all"), ("environment", "production"),
    ("environment", "unknown"), ("provider_flag", "true"),
    ("provider_flag", "TRUE"), ("provider_flag", "invalid"),
])
def test_wrong_runtime_or_uncertain_provider_flag_stays_blocked(field, value):
    assert result(**{field: value})["status"] == "blocked"


def test_absent_provider_flag_is_off_but_never_authorizes_a_provider():
    assert result(provider_flag=None)["status"] == "operations_checks_passed"
    assert result(provider_flag=None)["provider_requests_allowed"] is False


@pytest.mark.parametrize("sha", [None, "", "short", "A" * 40])
def test_exact_expected_revision_is_mandatory(sha):
    with pytest.raises(DomainError) as rejected:
        result(expected_sha=sha)
    assert rejected.value.status == 422


def test_naive_clock_cannot_create_freshness_or_uat_evidence():
    with pytest.raises(DomainError):
        result(now=NOW.replace(tzinfo=None))


@pytest.mark.parametrize("fault", [None, "missing", "write", "duplicate"])
def test_registered_routes_must_be_unambiguous_and_get_only(fault):
    routes = [SimpleNamespace(path=path, methods={"GET"}) for path in ROUTES]
    if fault == "missing":
        routes.pop()
    elif fault == "write":
        routes[0].methods.add("POST")
    elif fault == "duplicate":
        routes.append(SimpleNamespace(path=ROUTES[0], methods={"POST"}))
    assert registered_get_routes(routes) is (fault is None)
