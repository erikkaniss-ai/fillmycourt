"""Offline regression for the hosted F1 successful-auth cache/revoke gap."""
import httpx
import pytest

from fmc.common import DomainError
from fmc.supabase_v1 import SupabaseAuth

USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"


@pytest.mark.parametrize("denial", [401, 403], ids=["revoked-or-expired", "banned"])
def test_previous_success_cannot_mask_next_authority_denial(denial):
    calls = []
    def authority(request):
        calls.append(request)
        return httpx.Response(200, json={"id": USER_A}) if len(calls) == 1 else httpx.Response(denial)
    with httpx.Client(transport=httpx.MockTransport(authority)) as http:
        # Even an old explicit positive TTL must not restore the bypass.
        auth = SupabaseAuth("https://auth.invalid", "fixture-key", http=http, ttl=3600)
        assert auth.verify("Bearer fictional-a").id == USER_A
        with pytest.raises(DomainError) as err:
            auth.verify("Bearer fictional-a")
        assert (err.value.code, err.value.status) == ("AUTH_INVALID", 401)
    assert len(calls) == 2
    assert all(str(r.url) == "https://auth.invalid/auth/v1/user" for r in calls)


@pytest.mark.parametrize("failure", [429, 500, 503, "timeout", "malformed", "missing-id", "bad-id", "bad-email"])
def test_outage_or_bad_response_never_reuses_previous_actor(failure):
    calls = []
    def authority(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(200, json={"id": USER_A})
        if failure == "timeout":
            raise httpx.ReadTimeout("fixture timeout", request=request)
        if failure == "malformed":
            return httpx.Response(200, text="not JSON")
        if failure == "missing-id":
            return httpx.Response(200, json={})
        if failure == "bad-id":
            return httpx.Response(200, json={"id": "not-a-user"})
        if failure == "bad-email":
            return httpx.Response(200, json={"id": USER_A, "email": []})
        return httpx.Response(failure)
    with httpx.Client(transport=httpx.MockTransport(authority)) as http:
        auth = SupabaseAuth("https://auth.invalid", "fixture-key", http=http)
        assert auth.verify("Bearer fictional-a").id == USER_A
        with pytest.raises(DomainError) as err:
            auth.verify("Bearer fictional-a")
        assert (err.value.code, err.value.status) == ("AUTH_UNAVAILABLE", 503)
    assert len(calls) == 2, "Exactly one authority call per attempt, no automatic retries"


def test_revoked_a_cannot_impersonate_or_invalidate_b_and_metadata_grants_no_role():
    revoked = False
    calls = []
    def authority(request):
        token = request.headers["authorization"]
        calls.append(token)
        assert request.headers["apikey"] == "fixture-key"
        if token == "Bearer fictional-a" and revoked:
            return httpx.Response(401)
        return httpx.Response(200, json={"id": USER_A if token.endswith("-a") else USER_B,
            "user_metadata": {"role": "owner", "organization_id": "foreign-org"}})
    with httpx.Client(transport=httpx.MockTransport(authority)) as http:
        auth = SupabaseAuth("https://auth.invalid", "fixture-key", http=http)
        assert auth.verify("Bearer fictional-a").id == USER_A
        assert auth.verify("Bearer fictional-b").id == USER_B
        revoked = True
        with pytest.raises(DomainError):
            auth.verify("Bearer fictional-a")
        actor = auth.verify("Bearer fictional-b")
        assert actor.id == USER_B
        assert not hasattr(actor, "role") and not hasattr(actor, "organization_id")
    assert len(calls) == 4


@pytest.mark.parametrize("authorization", [None, "", "Bearer ", "Basic fictional"])
def test_missing_bearer_does_not_contact_authority(authorization):
    def unexpected(_request):
        pytest.fail("Missing bearer must be rejected before network access")
    with httpx.Client(transport=httpx.MockTransport(unexpected)) as http:
        auth = SupabaseAuth("https://auth.invalid", "fixture-key", http=http)
        with pytest.raises(DomainError) as err:
            auth.verify(authorization)
        assert err.value.status == 401
