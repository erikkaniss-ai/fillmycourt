"""Parallel synthetic-only security lane for provider availability contracts.

This suite deliberately uses local fixtures and ``httpx.MockTransport`` only.
It does not provide provider credentials, create real slots, or make outbound
provider requests. A booking observation is occupancy evidence, never a basis
for inferring unobserved free time.
"""
from __future__ import annotations

from datetime import datetime, timezone
from time import time

import httpx
import pytest

from fmc.common import DomainError
from fmc.playtomic import Deferred, Playtomic, capabilities
from fmc.provider_read_gate import require_official_club_read
from fmc.provider_token_sessions import ProviderTokenSessions


ORG_A = "11111111-1111-4111-8111-111111111111"
ORG_B = "22222222-2222-4222-8222-222222222222"
NOW = datetime(2026, 10, 20, 20, 42, tzinfo=timezone.utc)


def approved_booking_connection(*, organization_id=ORG_A, tenant_id="fixture-club-a"):
    return {
        "provider": "playtomic",
        "status": "configured",
        "organization_id": organization_id,
        "capabilities": {"write_mode": "read_sync", "official_read_authorized": True},
        "config": {
            "tenant_id": tenant_id,
            "official_grant": {
                "provider": "playtomic",
                "status": "approved",
                "authority": "club_or_certified_partner",
                "organization_id": organization_id,
                "tenant_id": tenant_id,
                "agreement_ref": "fixture-agreement-01",
                "owner_approval_ref": "fixture-approval-01",
                "scopes": ["bookings.read"],
                "approved_at": "2026-10-19T00:00:00Z",
                "expires_at": "2026-11-19T00:00:00Z",
            },
        },
    }


def test_availability_is_denied_without_its_own_official_source_even_with_booking_grant():
    connection = approved_booking_connection()

    with pytest.raises(DomainError):
        require_official_club_read(connection, "bookings", env={}, now=NOW)
    with pytest.raises(DomainError):
        require_official_club_read(
            connection,
            "availability",
            env={"FMC_OFFICIAL_PROVIDER_READS_ENABLED": "true"},
            now=NOW,
        )

    booking_permit = require_official_club_read(
        connection,
        "bookings",
        env={"FMC_OFFICIAL_PROVIDER_READS_ENABLED": "true"},
        now=NOW,
    )
    assert booking_permit["availability_feed_authorized"] is False
    assert capabilities()["availability_read"] is False


def test_lisbon_dst_booking_instants_remain_distinct_and_cannot_create_free_slots():
    adapter = Playtomic("fixture-client", "fixture-secret", "fixture-club-a")
    records = [
        # Europe/Lisbon 01:30 occurs twice on 25 October 2026.
        ("fall-first", "2026-10-25T01:30:00+01:00", "2026-10-25T00:30:00+00:00"),
        ("fall-second", "2026-10-25T01:30:00+00:00", "2026-10-25T01:30:00+00:00"),
        # Spring transition uses offset-bearing source instants too.
        ("spring-before", "2026-03-29T00:30:00+00:00", "2026-03-29T00:30:00+00:00"),
        ("spring-after", "2026-03-29T02:30:00+01:00", "2026-03-29T01:30:00+00:00"),
    ]

    normalized = []
    for external_id, starts_at, expected_start in records:
        record = adapter.booking(
            {
                "tenant_id": "fixture-club-a",
                "booking_id": external_id,
                "resource_id": "fixture-court-a",
                "booking_start_date": starts_at,
                "booking_end_date": starts_at,
                "status": "PENDING",
                "price": "10.00 EUR",
            }
        )
        assert record["starts_at"] == expected_start
        assert set(record) == {
            "external_id",
            "court_external_id",
            "starts_at",
            "ends_at",
            "status",
            "total_minor",
            "currency",
        }
        normalized.append(record)

    assert normalized[0]["starts_at"] != normalized[1]["starts_at"]
    assert all("slot" not in key and "availability" not in key for row in normalized for key in row)
    assert capabilities()["availability_read"] is False


def test_429_retry_after_defers_one_synthetic_page_without_hidden_retry():
    calls = []

    def responder(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(429, headers={"Retry-After": "197"})

    adapter = Playtomic(
        "fixture-client",
        "fixture-secret",
        "fixture-club-a",
        http=httpx.Client(transport=httpx.MockTransport(responder)),
    )
    adapter.token = "synthetic-token"
    adapter.expires = time() + 600

    with pytest.raises(Deferred) as deferred:
        adapter.page(
            "bookings",
            "2026-10-25T00:00:00Z",
            "2026-10-26T00:00:00Z",
        )

    assert deferred.value.code == "PROVIDER_RATE"
    assert deferred.value.seconds == 197
    assert calls == [("GET", "/api/v1/bookings")]
    assert adapter.token == "synthetic-token"
    adapter.http.close()


def test_ephemeral_provider_sessions_are_bound_to_their_tenant_and_connection():
    created = []

    class SyntheticProvider:
        def __init__(self, client_id, secret, tenant):
            created.append((client_id, secret, tenant))
            self.token = None
            self.expires = 0

    sessions = ProviderTokenSessions(factory=SyntheticProvider)
    first = sessions.get(
        organization_id=ORG_A,
        connection_id="connection-fixture",
        client_id="client-fixture-a",
        secret="secret-fixture-a",
        tenant="fixture-club-a",
    )
    same_tenant = sessions.get(
        organization_id=ORG_A,
        connection_id="connection-fixture",
        client_id="client-fixture-a",
        secret="secret-fixture-a",
        tenant="fixture-club-a",
    )
    other_tenant = sessions.get(
        organization_id=ORG_B,
        connection_id="connection-fixture",
        client_id="client-fixture-b",
        secret="secret-fixture-b",
        tenant="fixture-club-b",
    )

    assert same_tenant is first
    assert other_tenant is not first
    assert len(created) == 2
    assert sessions.public_status() == {
        "mode": "memory_only",
        "sessions": 2,
        "persisted_tokens": 0,
        "cross_process_vault": False,
    }
