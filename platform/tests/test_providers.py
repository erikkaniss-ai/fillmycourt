import json,time,pytest,httpx,jwt
from urllib.parse import urlparse,parse_qs
from dataclasses import replace
from cryptography.hazmat.primitives.asymmetric import rsa,ec
from cryptography.hazmat.primitives import serialization
from fmc.auth import Auth,PROVIDERS
from fmc.common import DomainError,canonical
from fmc.playtomic import Playtomic,Deferred,parse_money
from fmc.jobs import Worker
from fmc import db as d
from sqlalchemy import insert,select,update

@pytest.fixture(scope='module')
def rsa_key():return rsa.generate_private_key(public_exponent=65537,key_size=2048)

def claims(nonce_value,**changes):
    t=int(time.time());b={'iss':'https://accounts.google.com','aud':'test-client','sub':'external-sub','email':'verified@example.test','email_verified':True,'iat':t,'exp':t+300,'nonce':nonce_value};b.update(changes);return b

def oidc(e,rsa_key,overrides=None):
    jwk=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(rsa_key.public_key()));jwk.update(kid='rsa-test',use='sig',alg='RS256')
    current={};requests=[]
    def handle(req):
        requests.append(req)
        if 'certs' in req.url.path or req.url.path=='/auth/keys':return httpx.Response(200,json={'keys':[jwk]})
        if req.url.path=='/token' or req.url.path=='/auth/token':
            data=parse_qs(req.content.decode());assert data['code']==['valid-test-code']
            return httpx.Response(200,json={'id_token':jwt.encode(claims(current['nonce'],**(overrides or {})),rsa_key,algorithm='RS256',headers={'kid':'rsa-test'})})
        return httpx.Response(404)
    a=Auth(e.db,e.settings,httpx.Client(transport=httpx.MockTransport(handle)),e.now)
    url,browser=a.begin('google');params={k:v[0] for k,v in parse_qs(urlparse(url).query).items()};current['nonce']=params['nonce']
    return a,browser,params,requests

def test_google_oidc_code_pkce_and_identity(env,rsa_key):
    a,b,p,req=oidc(env,rsa_key);assert p['code_challenge_method']=='S256'
    token=a.complete('google',p['state'],b,'valid-test-code');assert a.user(token)['email']=='verified@example.test'
    assert not a.user(token)['onboarded'];assert any(b'code_verifier=' in r.content for r in req)
    with pytest.raises(DomainError):a.complete('google',p['state'],b,'valid-test-code')

@pytest.mark.parametrize('bad',[{'iss':'https://attacker.invalid'},{'aud':'wrong-client'},{'nonce':'wrong'},{'exp':1},{'email_verified':False},{'azp':'other-app'},{'aud':['test-client','other-app']}])
def test_oidc_rejects_invalid_claims(env,rsa_key,bad):
    a,b,p,_=oidc(env,rsa_key,bad)
    with pytest.raises(DomainError):a.complete('google',p['state'],b,'valid-test-code')

def test_oauth_browser_binding_and_expiry(env,rsa_key):
    a,b,p,_=oidc(env,rsa_key)
    with pytest.raises(DomainError):a.consume('google',p['state'],'different-browser')
    env.clock[0]+=601
    with pytest.raises(DomainError):a.consume('google',p['state'],b)

def test_no_email_autolink_across_providers(env):
    a=env.auth;one=a.establish('google',{'sub':'separate-1','email':'same@example.test'});two=a.establish('apple',{'sub':'separate-2','email':'same@example.test'})
    assert a.user(one)['id']!=a.user(two)['id']

def test_apple_client_secret_and_signed_identity(env,rsa_key):
    key=ec.generate_private_key(ec.SECP256R1());pem=key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode()
    settings=replace(env.settings,origin='https://getacourt.test',apple_id='com.test.web',apple_team='TESTTEAM',apple_key_id='TESTKEY',apple_private_key=pem)
    a=Auth(env.db,settings,clock=env.now);url,browser=a.begin('apple');p=parse_qs(urlparse(url).query)
    assert p['response_mode']==['form_post'];secret=a._apple_secret();verified=jwt.decode(secret,key.public_key(),algorithms=['ES256'],audience='https://appleid.apple.com');assert verified['sub']=='com.test.web'
    jwk=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(rsa_key.public_key()));jwk.update(kid='apple-key',use='sig');a._keys['apple']=([jwk],time.time()+300)
    signed=jwt.encode(claims(p['nonce'][0],iss='https://appleid.apple.com',aud='com.test.web',email='private@privaterelay.appleid.com',email_verified='true'),rsa_key,algorithm='RS256',headers={'kid':'apple-key'})
    assert a.validate_token('apple',signed,p['nonce'][0])['email'].endswith('privaterelay.appleid.com')

def test_rate_counter_shared(env):
    a=env.auth
    for _ in range(12):a.rate_limit('test-client-ip')
    with pytest.raises(DomainError):Auth(env.db,env.settings,clock=env.now).rate_limit('test-client-ip')

@pytest.mark.parametrize('value,expected',[('22.10 EUR',(2210,'EUR')),('-1.25 GBP',(-125,'GBP')),('0.00 EUR',(0,'EUR'))])
def test_provider_exact_money(value,expected):assert parse_money(value)==expected
@pytest.mark.parametrize('value',['NaN EUR','1.234 EUR','22 KWD','invalid',None,'100000000 EUR'])
def test_provider_money_rejects(value):
    with pytest.raises(DomainError):parse_money(value)

def client(responder):
    requests=[]
    def handle(req):
        requests.append(req)
        if req.method=='POST':
            assert json.loads(req.content)=={'client_id':'id','secret':'secret'}
            return httpx.Response(200,json={'token':'provider-token','token_type':'BEARER','expires_in':3600})
        assert req.headers['Authorization']=='Bearer provider-token'
        return responder(req)
    return Playtomic('id','secret','venue-source',httpx.Client(transport=httpx.MockTransport(handle))),requests

def test_playtomic_bookings_contract():
    data=[{'booking_id':'b1','tenant_id':'venue-source','resource_id':'c1','booking_start_date':'2026-10-07T10:00:00','booking_end_date':'2026-10-07T11:00:00','price':'20.00 EUR','status':'PENDING','is_canceled':False}]
    p,requests=client(lambda req:httpx.Response(200,json=data));r=p.page('bookings','2026-10-01T00:00:00Z','2026-10-09T00:00:00Z')
    assert r['records'][0]['total_minor']==2000;assert 'paid_minor' not in r['records'][0]
    assert requests[-1].url.path=='/api/v1/bookings';assert requests[-1].url.params['size']=='200'

def test_playtomic_players_cursor_and_consent():
    p,rs=client(lambda req:httpx.Response(200,json={'data':[{'player_id':'p1','name':'Synthetic player','email':'p1@example.test','phone':None,'accepts_commercial_communications':True}],'has_more':True,'next_cursor_id':'next-id'}));r=p.page('players','a','z')
    assert rs[-1].url.path=='/api/v1/venues/venue-source/players';assert r['next_cursor']=='next-id';assert r['records'][0]['consent']=='granted';assert 'accepted=true' in r['records'][0]['consent_proof']

@pytest.mark.parametrize('status',[202,429])
def test_playtomic_processing_retry_after(status):
    p,_=client(lambda req:httpx.Response(status,headers={'Retry-After':'120'},json={'status':'PROCESSING'}))
    with pytest.raises(Deferred) as err:p.page('payments','2026-10-01T00:00:00Z','2026-10-09T00:00:00Z')
    assert err.value.seconds==120

def test_payment_reporting_not_fuzzy_booked():
    p,_=client(lambda req:httpx.Response(200,json={'data':[{'club_payment_id':'pc1','payment_id':'p1','payment_info':{'status':'PAID','total':'20.00 EUR','net_transfer_amount':'18.00 EUR','b2b_commission_info':{'amount':'2.00 EUR'}},'payout_info':{'payout_id':'batch1'}}],'has_more':False,'next_cursor_id':None}))
    r=p.page('payments','2026-10-01T00:00:00Z','2026-10-09T00:00:00Z')['records'][0]
    assert r['gross_minor']==2000;assert r['net_minor']==1800;assert r['fee_minor']==200;assert r['booking_id'] is None;assert r['link_status']=='unlinked'

def test_malformed_or_cross_scope_provider_errors():
    p,_=client(lambda req:httpx.Response(200,json={'data':[],'has_more':True,'next_cursor_id':None}))
    with pytest.raises(DomainError):p.page('players','a','z')

def integrate(e):
    with e.db.tx() as c:c.execute(insert(d.integrations).values(venue_id=e.club['id'],provider='playtomic',tenant_id='venue-source',credential_ref='PLAYTOMIC_TEST',authorization_ref='authorization test',next_allowed=0))

def test_worker_pages_checkpoint_then_staged_import(env):
    e=env;integrate(e)
    class Fake:
        def page(self,kind,a,b,cursor=None,page=0):
            return {'records':[{'external_id':str(page),'name':'Test '+str(page),'email':f'p{page}@example.test','phone':'','consent':'unknown','consent_proof':''}],'has_more':page==0,'next_cursor':'cursor-1' if not page else None}
    e.queue.enqueue(e.who['owner'],'sync_players','sync-test-1',{'window_start':'2026-10-01T00:00:00Z','window_end':'2026-10-09T00:00:00Z'})
    w=Worker(e.db,e.now,client_factory=lambda i:Fake());assert w.step();assert e.queue.list(e.club['id'])[0]['status']=='queued'
    e.clock[0]+=61;w=Worker(e.db,e.now,client_factory=lambda i:Fake());assert w.step();assert e.queue.list(e.club['id'])[0]['status']=='done'
    b=e.ops.import_list(e.who['owner'])[0];assert b['row_count']==2;assert b['status']=='staged';assert e.ops.contacts(e.who['owner'])['items']==[]

def test_worker_202_retains_progress_without_failed_attempt(env):
    e=env;integrate(e)
    class Fake:
        def page(self,*args):raise Deferred('PROVIDER_PROCESSING',120)
    e.queue.enqueue(e.who['owner'],'sync_payments','defer-key-1',{'window_start':'2026-10-01T00:00:00Z','window_end':'2026-10-09T00:00:00Z'})
    Worker(e.db,e.now,client_factory=lambda i:Fake()).step();j=e.queue.list(e.club['id'])[0]
    assert j['status']=='queued';assert j['attempts']==0;assert j['due']==e.now()+120
