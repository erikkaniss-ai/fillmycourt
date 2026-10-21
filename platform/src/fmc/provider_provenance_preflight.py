"""Scoped Operations prerequisites only: no provider IO, deployment or UAT GO."""
from datetime import datetime, timezone
import re
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .common import DomainError

CONTRACT = "provider-provenance-operations-preflight/v1"
SHA = re.compile(r"^[0-9a-f]{40}$")
ROUTES = (
    "/api/fmc/{org}/provider-provenance/connections",
    "/api/fmc/{org}/provider-provenance/preflight",
    "/api/fmc/{org}/provider-provenance/{connection_id}",
)
TABLES = ("organization_members", "provider_connections", "provider_observations", "bookings")
# Column resolution and SELECT privilege probes only: never fetch config,
# receipt payload, customer or booking values.
PROBES = (
    "select organization_id,user_id,role from public.organization_members limit 0",
    "select id,organization_id,provider,status,capabilities,config from public.provider_connections limit 0",
    "select id,organization_id,provider_connection_id,stream,external_id,fingerprint,"
    "observed_at,window_start,window_end,complete,payload from public.provider_observations limit 0",
    "select id,organization_id,source,external_reference,metadata from public.bookings limit 0",
)


def registered_get_routes(routes):
    for path in ROUTES:
        matches = [route for route in routes if getattr(route, "path", None) == path]
        if len(matches) != 1 or getattr(matches[0], "methods", None) != {"GET"}:
            return False
    return True


def preflight_result(*, expected_sha, runtime_sha, service, environment, provider_flag,
                     facts, now):
    """Fixed, redacted checks; metadata equality is not a signed build attestation."""
    if (not isinstance(expected_sha, str) or not SHA.fullmatch(expected_sha)
        or not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None):
        raise DomainError("PREFLIGHT_INPUT", "Exact Operations SHA and aware review time required.", 422)
    revision = runtime_sha if isinstance(runtime_sha, str) and SHA.fullmatch(runtime_sha) else None
    values = {
        "operations_service": service == "operations",
        "non_production_runtime": environment in ("staging", "test"),
        "runtime_revision_matches": revision is not None and revision == expected_sha,
        "provider_reads_disabled_in_this_api": provider_flag in (None, "false"),
        **{key: facts.get(key) is True for key in (
            "owner_admin_scope", "authenticated_rls_context", "repeatable_read_only",
            "schema_rls_select", "reader_columns_present", "get_routes_present")},
    }
    return {
        "mode": "read_only_operations_preflight", "contract_version": CONTRACT,
        "as_of": now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "operations_runtime_sha": revision,
        "runtime_identity_source": "railway_build_environment_not_independent_attestation",
        "status": "operations_checks_passed" if all(values.values()) else "blocked",
        "checks": {key: "pass" if value else "blocked" for key, value in values.items()},
        "not_assessed": ["external_runtime_identity", "protected_host", "two_org_hosted_uat",
                         "worker_provider_read_state", "fixture_provisioning", "owner_uat_go"],
        "hosted_uat_ready": False, "uat_accepted": False, "pilot_ready": False,
        "provider_requests_allowed": False, "can_display_available_slots": False,
        "deploy_allowed": False,
    }


def operations_provenance_preflight(db, *, user_id, organization_id, expected_sha,
                                   service, environment, env, routes, now):
    try:
        UUID(user_id)
        UUID(organization_id)
    except (ValueError, TypeError, AttributeError):
        raise DomainError("PREFLIGHT_INPUT", "Valid scoped preflight identifiers required.", 422) from None
    # Validate without querying or echoing untrusted metadata.
    preflight_result(expected_sha=expected_sha, runtime_sha=None, service=service,
        environment=environment, provider_flag=None, facts={}, now=now)
    facts = {}
    try:
        with db.user(user_id, readonly=True) as c:
            db.require_role(c, organization_id, user_id, {"owner", "admin"})
            facts["owner_admin_scope"] = True
            # Inspect the verified subject/role set by V1Store.user, the same
            # GUC source read by auth.uid(). Do not require USAGE on Auth schema
            # or grant extra privileges merely for this diagnostic.
            context = c.execute(text("""
                select current_user as role,
                       current_setting('request.jwt.claim.sub',true) as uid,
                       current_setting('request.jwt.claim.role',true) as claim_role,
                       current_setting('row_security') as row_security,
                       current_setting('transaction_read_only') as read_only,
                       current_setting('transaction_isolation') as isolation,
                       (select rolsuper or rolbypassrls from pg_catalog.pg_roles
                        where rolname=current_user) as privileged
            """)).mappings().one()
            facts["authenticated_rls_context"] = (
                context["role"] == "authenticated" and context["uid"] == user_id
                and context["claim_role"] == "authenticated"
                and context["row_security"] == "on" and context["privileged"] is False)
            facts["repeatable_read_only"] = (
                context["read_only"] == "on" and context["isolation"] == "repeatable read")
            catalog = c.execute(text("""
                select cls.relname,cls.relkind,cls.relrowsecurity,
                       pg_catalog.has_table_privilege(current_user,cls.oid,'SELECT') as selectable
                from pg_catalog.pg_class cls join pg_catalog.pg_namespace ns on ns.oid=cls.relnamespace
                where ns.nspname='public' and cls.relname in
                    ('organization_members','provider_connections','provider_observations','bookings')
            """)).mappings().all()
            facts["schema_rls_select"] = (
                {r["relname"] for r in catalog} == set(TABLES)
                and all(r["relkind"] == "r" and r["relrowsecurity"] is True
                        and r["selectable"] is True for r in catalog))
            facts["reader_columns_present"] = False
            if all(facts[key] for key in (
                    "authenticated_rls_context", "repeatable_read_only", "schema_rls_select")):
                for probe in PROBES:
                    c.execute(text(probe))
                facts["reader_columns_present"] = True
    except SQLAlchemyError:
        # No DSN, schema errors or original exception details in the response.
        # Never retry with trusted/admin fallback or mutate the schema.
        raise DomainError("PREFLIGHT_UNAVAILABLE", "Operations preflight is unavailable.", 503) from None
    facts["get_routes_present"] = registered_get_routes(routes)
    return preflight_result(
        expected_sha=expected_sha, runtime_sha=env.get("RAILWAY_GIT_COMMIT_SHA"), service=service,
        environment=environment, provider_flag=env.get("FMC_OFFICIAL_PROVIDER_READS_ENABLED"),
        facts=facts, now=now)
