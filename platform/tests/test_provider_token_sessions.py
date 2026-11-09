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

def test_rotation_and_capacity_eviction_scrub_retained_token_references():
    # All tokens and clients are fictional: no network calls or real credentials.
    from time import time
    sessions = ProviderTokenSessions()
    original = sessions.get(**params())
    original.token = "synthetic-before-rotation"
    original.expires = time() + 3600
    other = sessions.get(**params(org="org-other"))
    other.token = "synthetic-unrelated"
    other.expires = time() + 3600

    rotated = sessions.get(**params(secret="new-fixture-secret"))
    assert rotated is not original
    assert original.token is None and original.expires == 0
    assert not original.token_usable()
    # Rotation is scoped: an unrelated club's cached token remains intact.
    assert other.token_usable()

    rotated.token = "synthetic-retained-token"
    rotated.expires = time() + 3600
    # 64 cache keys, then a new connection triggers a full capacity eviction.
    for i in range(62):
        sessions.get(**params(connection=f"pc-filler-{i}"))
    assert sessions.size() == 64
    sessions.get(**params(connection="pc-overflow"))
    assert sessions.size() == 1
    for retained in (rotated, other):
        assert retained.token is None and retained.expires == 0
        assert not retained.token_usable()
    assert sessions.get(**params(connection="pc-overflow")).token is None


def test_retired_club_client_cannot_reauthenticate_or_request_after_rotation_discard_or_capacity():
    """Local client retirement is permanent even for retained references."""
    from time import time
    from fmc.common import DomainError
    calls = []
    def respond(req):
        calls.append((req.method, req.url.path))
        return httpx.Response(200, json={"token": "fixture-token", "expires_in": 3600})
    def factory(client_id, secret, tenant):
        return Playtomic(client_id, secret, tenant,
                        http=httpx.Client(transport=httpx.MockTransport(respond)))
    sessions = ProviderTokenSessions(factory=factory)
    original = sessions.get(**params())
    original.token, original.expires = "fixture-cached", time() + 3600
    replacement = sessions.get(**params(secret="rotated-fixture-secret"))
    assert replacement is not original
    assert original.retired is True
    assert original.token is None and original.expires == 0
    assert not original.token_usable()
    assert replacement.retired is False
    # Even accidentally reinstating a bearer token on a retained reference is inert.
    original.token, original.expires = "synthetic-retained", time() + 3600
    for request in (lambda: original.get_token(force_refresh=True),
                    lambda: original.page("bookings", "2026-10-20T00:00:00Z",
                                          "2026-10-21T00:00:00Z")):
        with pytest.raises(DomainError) as exc:
            request()
        assert exc.value.code == "PROVIDER_SESSION_RETIRED"
    sessions.discard(connection_id="pc-1")
    assert replacement.retired is True
    with pytest.raises(DomainError, match="retired"):
        replacement.get_token(force_refresh=True)

    capacity = ProviderTokenSessions(factory=factory)
    first = capacity.get(**params())
    for index in range(63):
        capacity.get(**params(connection=f"overflow-{index}"))
    assert capacity.size() == 64
    capacity.get(**params(connection="overflow-last"))
    assert first.retired is True
    with pytest.raises(DomainError, match="retired"):
        first.get_token(force_refresh=True)
    assert calls == [], "Retired clients must never make a provider HTTP request"


def test_rotation_factory_failure_does_not_leave_unusable_client_cached():
    from fmc.common import DomainError
    calls = 0
    def factory(client_id, secret, tenant):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("Synthetic constructor failure")
        return Playtomic(client_id, secret, tenant,
                        http=httpx.Client(transport=httpx.MockTransport(
                            lambda req: httpx.Response(500))))
    sessions = ProviderTokenSessions(factory=factory)
    original = sessions.get(**params())
    with pytest.raises(RuntimeError, match="Synthetic constructor failure"):
        sessions.get(**params(secret="new-secret"))
    assert original.retired is True
    assert sessions.size() == 0, "Retired entry must not survive a failed replacement"
    recovered = sessions.get(**params())
    assert recovered is not original and not recovered.retired
    assert sessions.size() == 1


def test_retirement_during_oauth_response_prevents_token_repopulation():
    """Deterministically retire from MockTransport before token response is parsed."""
    from fmc.common import DomainError
    requests = []
    sessions = None
    def respond(req):
        requests.append(req.url.path)
        sessions.discard(connection_id="pc-1")
        return httpx.Response(200, json={"token": "fixture-arrived-late", "expires_in": 3600})
    sessions = ProviderTokenSessions(factory=lambda cid, secret, tenant:
        Playtomic(cid, secret, tenant,
                 http=httpx.Client(transport=httpx.MockTransport(respond))))
    previous = sessions.get(**params())
    with pytest.raises(DomainError) as exc:
        previous.get_token(force_refresh=True)
    assert exc.value.code == "PROVIDER_SESSION_RETIRED"
    assert previous.retired and previous.token is None and previous.expires == 0
    assert requests == ["/api/v1/oauth/token"]
    assert sessions.size() == 0


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


def test_worker_separates_token_http_and_page_http(monkeypatch):
    from contextlib import contextmanager
    from fmc import v1_workers
    from fmc.playtomic import Deferred
    from datetime import datetime,timezone
    from fmc.provider_token_sessions import ProviderTokenSessions
    class FakeConn:
        def execute(self,*args,**kwargs):return None
    class FakeDb:
        def __init__(self):
            self.reservations=0
            self.conn=FakeConn()
        def reserve_provider_request(self,pc):
            assert pc=="connection-synthetic"
            self.reservations+=1
            return 0
        @contextmanager
        def trusted(self):yield self.conn
    class FakeProvider:
        http_calls=[]
        def __init__(self,client_id,secret,tenant):
            assert client_id=="client-fixture"
            assert secret=="secret-fixture"
            assert tenant=="tenant-fixture"
            self.has_token=False
        def token_usable(self,min_remaining_seconds=120):
            return self.has_token
        def get_token(self,force_refresh=False):
            assert force_refresh is True
            self.http_calls.append("POST oauth")
            self.has_token=True
            return "test-token"
        def page(self,*args,**kwargs):
            self.http_calls.append("GET bookings")
            return {"records":[],"has_more":False,"next_cursor":None}
    grant={"provider":"playtomic","status":"approved","authority":"club_or_certified_partner",
           "organization_id":"11111111-1111-4111-8111-111111111111",
           "tenant_id":"tenant-fixture","agreement_ref":"agreement-fixture",
           "owner_approval_ref":"approved-fixture","scopes":["bookings.read"],
           "approved_at":"2026-01-01T00:00:00Z","expires_at":"2027-01-01T00:00:00Z"}
    connection={"provider":"playtomic","status":"configured",
                "organization_id":grant["organization_id"],
                "capabilities":{"write_mode":"read_sync","official_read_authorized":True},
                "config":{"tenant_id":"tenant-fixture","official_grant":grant}}
    monkeypatch.setattr(v1_workers,"_connection",lambda db,pc:connection)
    monkeypatch.setattr(v1_workers,"_credential",lambda conn:("client-fixture","secret-fixture","tenant-fixture"))
    monkeypatch.setenv("FMC_OFFICIAL_PROVIDER_READS_ENABLED","true")
    sessions=ProviderTokenSessions(factory=FakeProvider)
    job={"payload":{"provider_connection_id":"connection-synthetic","stream":"bookings",
                    "window_start":"2026-10-20T00:00:00Z",
                    "window_end":"2026-10-21T00:00:00Z"},
         "id":"job-fixture","lease_token":"lease-fixture"}
    db=FakeDb()
    with pytest.raises(Deferred) as auth:
        v1_workers._sync_playtomic(db,job,sessions=sessions)
    assert auth.value.code=="PROVIDER_AUTH_PACING"
    assert auth.value.seconds==60
    assert db.reservations==1
    assert FakeProvider.http_calls==["POST oauth"]
    second=v1_workers._sync_playtomic(db,job,sessions=sessions)
    assert second["records"]==0
    assert db.reservations==2
    assert FakeProvider.http_calls==["POST oauth","GET bookings"]
    assert "test-token" not in str(second)
    assert sessions.public_status()["persisted_tokens"]==0
    # A fresh process has no cached token and must NEVER request a page
    # in the same reservation as reauthentication.
    restarted=ProviderTokenSessions(factory=FakeProvider)
    with pytest.raises(Deferred) as restarted_auth:
        v1_workers._sync_playtomic(db,job,sessions=restarted)
    assert restarted_auth.value.code=="PROVIDER_AUTH_PACING"
    assert db.reservations==3
    assert FakeProvider.http_calls[-1]=="POST oauth"
    assert sessions.size()==1 and restarted.size()==1


@pytest.mark.parametrize("status",[202,429])
def test_provider_oauth_202_429_preserves_worker_retry_as_deferred(status):
    from fmc.playtomic import Deferred
    def responder(_req):
        return httpx.Response(status,headers={"Retry-After":"135"},
                              json={"status":"PROCESSING"})
    client=Playtomic("client","secret","venue",http=httpx.Client(
        transport=httpx.MockTransport(responder)))
    with pytest.raises(Deferred) as err:
        client.get_token(force_refresh=True)
    assert err.value.code in ("PROVIDER_PROCESSING","PROVIDER_RATE")
    assert err.value.seconds==135
    assert client.token is None
