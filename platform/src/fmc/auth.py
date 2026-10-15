"""Server-side Google / Apple OpenID Connect and persistent player onboarding.

No anonymous booking identity, test-role selection, or email-based auto-linking.
OAuth transactions are browser-bound and single-use. ID tokens are validated
against provider JWKS, issuer, audience, expiry and the transaction nonce.
"""
from __future__ import annotations
import base64,hashlib,hmac,json,secrets,time
from urllib.parse import urlencode
import httpx,jwt
from .common import DomainError,canonical as json_text,SPORTS,ident
from sqlalchemy import select,insert,update,delete
from .db import players,identities,sessions,oauth,rates,members,venues,one,rows
from .config import Settings

PROVIDERS={
 'google':{'authorize':'https://accounts.google.com/o/oauth2/v2/auth','token':'https://oauth2.googleapis.com/token','jwks':'https://www.googleapis.com/oauth2/v3/certs','issuers':['https://accounts.google.com','accounts.google.com']},
 'apple':{'authorize':'https://appleid.apple.com/auth/authorize','token':'https://appleid.apple.com/auth/token','jwks':'https://appleid.apple.com/auth/keys','issuers':['https://appleid.apple.com']}}
def hashed(value):return hashlib.sha256(value.encode()).hexdigest()

class Auth:
    def __init__(self,db,settings:Settings,http=None,clock=time.time):
        self.db,self.settings,self.clock=db,settings,clock
        self.http=http or httpx.Client(timeout=15,follow_redirects=False)
        self._keys={}
    def now(self):return int(self.clock())
    def rate_limit(self,ip,bucket='login',limit=12):
        key=hashed(bucket+':'+ip);now=self.now()
        # Upsert creates the lock row without a race between service instances.
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        with self.db.tx() as c:
            make=pg_insert if self.db.postgres else sqlite_insert
            c.execute(make(rates).values(key=key,started=now,count=0).on_conflict_do_nothing(index_elements=['key']))
            r=self.db.lock(c,rates,key=key)
            count=r['count'] if now-r['started']<600 else 0
            if count>=limit:raise DomainError('RATE_LIMIT','Too many attempts. Try again later.',429)
            c.execute(update(rates).where(rates.c.key==key).values(count=count+1,started=r['started'] if now-r['started']<600 else now))
    def begin(self,provider,browser_token=None):
        if not self.settings.enabled(provider):raise DomainError('LOGIN_UNAVAILABLE','This sign-in provider is not configured yet.',503)
        browser=browser_token or secrets.token_urlsafe(32)
        state,nonce,verifier=[secrets.token_urlsafe(32) for _ in range(3)]
        with self.db.tx() as c:
            c.execute(delete(oauth).where(oauth.c.expires<self.now()))
            c.execute(insert(oauth).values(state_hash=hashed(state),provider=provider,browser_hash=hashed(browser),nonce=nonce,verifier=verifier,expires=self.now()+600))
        client=self.settings.google_id if provider=='google' else self.settings.apple_id
        args={'client_id':client,'redirect_uri':self.settings.origin+'/api/auth/'+provider+'/callback','response_type':'code','scope':'openid email profile' if provider=='google' else 'name email','state':state,'nonce':nonce}
        if provider=='google':args.update(code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='),code_challenge_method='S256',prompt='select_account')
        else:args['response_mode']='form_post'
        return PROVIDERS[provider]['authorize']+'?'+urlencode(args),browser
    def consume(self,provider,state,browser):
        if not state or not browser:raise DomainError('OAUTH_STATE','Sign-in expired. Please start again.',400)
        with self.db.tx() as c:
            r=c.execute(delete(oauth).where(oauth.c.state_hash==hashed(state),oauth.c.provider==provider,oauth.c.browser_hash==hashed(browser),oauth.c.expires>self.now()).returning(oauth)).mappings().first()
            if not r:raise DomainError('OAUTH_STATE','Invalid or already-used sign-in state.',400)
            return dict(r)
    def _apple_secret(self):
        return jwt.encode({'iss':self.settings.apple_team,'iat':self.now(),'exp':self.now()+300,'aud':'https://appleid.apple.com','sub':self.settings.apple_id},self.settings.apple_private_key,algorithm='ES256',headers={'kid':self.settings.apple_key_id})
    def validate_token(self,provider,token,nonce):
        try:
            hdr=jwt.get_unverified_header(token)
            if hdr.get('alg')!='RS256' or not hdr.get('kid'):raise ValueError('Invalid algorithm')
            keys,expiry=self._keys.get(provider,([],0))
            if expiry<time.time() or not any(k.get('kid')==hdr['kid'] for k in keys):
                r=self.http.get(PROVIDERS[provider]['jwks']);r.raise_for_status();keys=r.json()['keys']
                self._keys[provider]=(keys,time.time()+300)
            key=next(k for k in keys if k.get('kid')==hdr['kid'])
            if key.get('kty')!='RSA' or key.get('use','sig')!='sig':raise ValueError('Invalid key')
            client=self.settings.google_id if provider=='google' else self.settings.apple_id
            claims=jwt.decode(token,jwt.PyJWK.from_dict(key).key,algorithms=['RS256'],audience=client,issuer=PROVIDERS[provider]['issuers'],options={'require':['exp','iat','iss','aud','sub','nonce']},leeway=30)
            if not isinstance(claims['sub'],str) or not claims['sub'] or len(claims['sub'])>255:raise ValueError('Subject')
            if not isinstance(claims['nonce'],str) or not hmac.compare_digest(claims['nonce'],nonce):raise ValueError('Nonce')
            if claims.get('azp',client)!=client:raise ValueError('Authorized party')
            if isinstance(claims['aud'],list) and len(claims['aud'])>1 and claims.get('azp')!=client:raise ValueError('Authorized party required')
            if claims.get('email_verified') not in (True,'true'):raise ValueError('Email is not verified')
            if not isinstance(claims.get('email'),str) or '@' not in claims['email'] or len(claims['email'])>320:raise ValueError('Email')
            return claims
        except (jwt.PyJWTError,ValueError,StopIteration,KeyError,TypeError,httpx.HTTPError):
            raise DomainError('INVALID_IDENTITY','The identity provider response could not be verified.',401) from None
    def complete(self,provider,state,browser,code):
        transaction=self.consume(provider,state,browser)
        if not code or len(code)>4096:raise DomainError('OAUTH_CODE','No valid sign-in code was returned.',400)
        if not self.settings.enabled(provider):raise DomainError('LOGIN_UNAVAILABLE','Sign-in is unavailable.',503)
        client=self.settings.google_id if provider=='google' else self.settings.apple_id
        data={'grant_type':'authorization_code','client_id':client,'client_secret':self.settings.google_secret if provider=='google' else self._apple_secret(),'code':code,'redirect_uri':self.settings.origin+'/api/auth/'+provider+'/callback'}
        if provider=='google':data['code_verifier']=transaction['verifier']
        try:
            r=self.http.post(PROVIDERS[provider]['token'],data=data);r.raise_for_status();token=r.json()['id_token']
        except (httpx.HTTPError,ValueError,KeyError):raise DomainError('OAUTH_EXCHANGE','Sign-in could not be completed. Please try again.',502) from None
        claims=self.validate_token(provider,token,transaction['nonce'])
        return self.establish(provider,claims)
    def establish(self,provider,claims):
        # Called only after cryptographic ID-token verification (no public route).
        with self.db.tx() as c:
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            from sqlalchemy.dialects.sqlite import insert as sqlite_insert
            make=pg_insert if self.db.postgres else sqlite_insert
            pid=ident('player')
            c.execute(insert(players).values(id=pid,email=claims['email'],display_name=str(claims.get('name',''))[:100],created=self.now(),updated=self.now(),profile='{}',onboarded=False))
            r=c.execute(make(identities).values(provider=provider,subject=claims['sub'],player_id=pid).on_conflict_do_nothing(index_elements=['provider','subject']).returning(identities.c.player_id)).first()
            if not r:
                c.execute(delete(players).where(players.c.id==pid))
                pid=one(c,select(identities).where(identities.c.provider==provider,identities.c.subject==claims['sub']))['player_id']
            token=secrets.token_urlsafe(32)
            c.execute(insert(sessions).values(token_hash=hashed(token),player_id=pid,expires=self.now()+7*86400))
        return token
    def user(self,token,required=True):
        with self.db.read() as c:
            r=one(c,select(players).join(sessions,sessions.c.player_id==players.c.id).where(sessions.c.token_hash==hashed(token or ''),sessions.c.expires>self.now()))
        if not r:
            if required:raise DomainError('AUTH_REQUIRED','Sign in to continue.',401)
            return None
        r['profile']=json.loads(r['profile']);return r
    def onboarding(self,user,profile):
        if not self.settings.legal_ready:raise DomainError('ONBOARDING_UNAVAILABLE','Registration is not configured.',503)
        if profile.get('accept_terms') is not True or profile.get('terms_version')!=self.settings.terms_version:raise DomainError('TERMS_REQUIRED','Accept the current terms.',422)
        name=profile['display_name'].strip();sports=profile.get('sports',[])
        if not name or not sports or any(s not in SPORTS for s in sports):raise DomainError('PROFILE','Enter your name and supported sports.',422)
        data={k:v for k,v in profile.items() if k not in ('display_name','accept_terms')}
        data.update(terms_accepted_at=self.now(),marketing_opt_in=profile.get('marketing_opt_in') is True)
        with self.db.tx() as c:
            c.execute(update(players).where(players.c.id==user['id']).values(display_name=name,profile=json_text(data),onboarded=True,updated=self.now()))
            self.db.emit(c,None,user['id'],'player.onboarded',user['id'],{'marketing_opt_in':data['marketing_opt_in']},self.now())
        return {'ok':True}
    def player(self,token):
        u=self.user(token)
        if not u['onboarded']:raise DomainError('ONBOARDING_REQUIRED','Complete your player profile.',403)
        return u['id']
    def require_member(self,token,venue,roles=None):
        u=self.user(token)
        with self.db.read() as c:
            row=one(c,select(members).join(venues,venues.c.organisation_id==members.c.organisation_id).where(venues.c.id==venue,members.c.player_id==u['id']))
        if not row or (roles and row['role'] not in roles):raise DomainError('FORBIDDEN','You do not have permission for this club.',403)
        return {'id':u['id'],'role':row['role'],'venue_id':venue,'organisation_id':row['organisation_id']}
    def clubs(self,token):
        u=self.user(token)
        with self.db.read() as c:return rows(c,select(venues.c.id,venues.c.name,members.c.role).join(members,members.c.organisation_id==venues.c.organisation_id).where(members.c.player_id==u['id']).limit(100))
    def logout(self,token):
        with self.db.tx() as c:c.execute(delete(sessions).where(sessions.c.token_hash==hashed(token or '')))
