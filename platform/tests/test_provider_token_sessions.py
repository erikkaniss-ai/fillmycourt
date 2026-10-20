"""Playtomic club token sessions: private and memory-only, no external traffic."""
import pytest
import httpx
from fmc.playtomic import Playtomic
from fmc.provider_token_sessions import ProviderTokenSessions

def params(secret="fixture-secret",tenant="club-1",org="org-1",connection="pc-1"):
    return dict(organization_id=org,connection_id=connection,
                client_id="client-1",secret=secret,tenant=tenant)

def test_same_club_credential_and_connection_reuses_session():
    calls=[]
    def factory(client,secret,tenant):
        calls.append((client,secret,tenant))
        return Playtomic(client,secret,tenant,
             http=httpx.Client(transport=httpx.MockTransport(
                 lambda req: httpx.Response(403))))
    sessions=ProviderTokenSessions(factory=factory)
    first=sessions.get(**params())
    assert first is sessions.get(**params())
    assert len(calls)==1
    assert sessions.size()==1
    assert sessions.public_status()=={"mode":"memory_only","sessions":1,
                                      "persisted_tokens":0,"cross_process_vault":False}
    assert "fixture-secret" not in repr(sessions.public_status())

def test_secret_rotation_or_different_org_must_not_reuse_club_token():
    sessions=ProviderTokenSessions()
    original=sessions.get(**params())
    original.token="synthetic-token";original.expires=2_000_000_000
    rotated=sessions.get(**params(secret="rotated-secret"))
    assert rotated is not original
    assert rotated.token is None
    isolated=sessions.get(**params(org="org-2"))
    assert isolated is not rotated
    assert sessions.size()==2
    assert all(not hasattr(sessions,"export_tokens") for _ in [0])

def test_cache_is_in_memory_not_a_persistent_token_store():
    sessions=ProviderTokenSessions()
    old=sessions.get(**params())
    old.token="do-not-serialize"
    fresh=ProviderTokenSessions().get(**params())
    assert fresh.token is None
    assert sessions.public_status()["persisted_tokens"]==0

def test_playtomic_token_usable_requires_safety_margin_and_forced_refresh():
    ticks=[1_000_000]
    requests=[]
    def respond(req):
        requests.append((req.method,req.url.path))
        return httpx.Response(200,json={"token":"token-"+str(len(requests)),
                                        "expires_in":3600})
    import fmc.playtomic as mod
    prev=mod.time.time
    mod.time.time=lambda:ticks[0]
    try:
        client=Playtomic("id","secret","club",http=httpx.Client(
            transport=httpx.MockTransport(respond)))
        assert not client.token_usable(120)
        assert client.get_token()=="token-1"
        assert client.token_usable(120)
        assert client.get_token()=="token-1"
        assert len(requests)==1
        assert client.get_token(force_refresh=True)=="token-2"
        assert len(requests)==2
        ticks[0]+=3455
        assert not client.token_usable(120)
    finally:
        mod.time.time=prev

def test_short_lived_token_fails_closed_before_scheduling_page():
    def handle(req):
        return httpx.Response(200,json={"token":"fixture","expires_in":180})
    from fmc.common import DomainError
    client=Playtomic("id","secret","club",http=httpx.Client(
        transport=httpx.MockTransport(handle)))
    with pytest.raises(DomainError,match="lifetime"):
        client.get_token()
    assert client.token is None
