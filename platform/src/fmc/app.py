"""HTTP boundaries for the shared platform. Deploy as core, operations, or all.

No demo/session-login endpoints. Unknown integrations fail closed. No mutation
accepts a caller-selected tenant without checking authenticated membership.
"""
from pathlib import Path
import json,os,time,logging,re
from datetime import datetime,timezone
from urllib.parse import parse_qs
from fastapi import FastAPI,Request,Response,Query
from fastapi.responses import JSONResponse,FileResponse,RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel,ConfigDict,Field
from sqlalchemy import select,insert,update,func,text
from sqlalchemy.exc import IntegrityError,OperationalError
from .config import Settings
from . import db as d
from .common import DomainError,ident,canonical,stamp
from .auth import Auth
from .booking import Booking
from .operations import Operations
from .reconciliation import Reconciliation
from .jobs import Queue
ROOT=Path(__file__).resolve().parents[2]
class Input(BaseModel):model_config=ConfigDict(extra='forbid',strict=True)
class Hold(Input):
    court_id:str=Field(min_length=3,max_length=80)
    date:str=Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    time:str=Field(pattern=r'^\d{2}:\d{2}$')
    duration:int=Field(ge=15,le=180)
class Confirm(Input):
    participants:int=Field(ge=1,le=4)
    accept_policy:bool
    payment:str='venue'
class Profile(Input):
    display_name:str=Field(min_length=1,max_length=100)
    city:str=Field(min_length=1,max_length=100)
    sports:list[str]=Field(min_length=1,max_length=5)
    skill_level:str=Field(default='not_set',pattern='^(not_set|beginner|intermediate|advanced)$')
    locale:str=Field(default='en',pattern='^(en|pt)$')
    marketing_opt_in:bool=False
    accept_terms:bool
    terms_version:str=Field(min_length=1,max_length=80)
class Club(Input):
    organisation:str=Field(min_length=1,max_length=200)
    name:str=Field(min_length=1,max_length=200)
    city:str=Field(min_length=1,max_length=100)
    lat:float=Field(ge=-90,le=90,allow_inf_nan=False)
    lon:float=Field(ge=-180,le=180,allow_inf_nan=False)
    timezone:str=Field(default='Europe/Lisbon',max_length=80)
    indoor:bool=True
class Rules(Input):
    opening_minute:int=Field(ge=0,le=1439)
    closing_minute:int=Field(ge=1,le=1440)
    step_minutes:int
    durations:list[int]
    booking_days:int=Field(ge=1,le=365)
    cancellation_hours:int=Field(ge=0,le=168)
    policy_version:str=Field(min_length=1,max_length=80)
    peak_addon_minor:int=Field(default=0,ge=0,le=100000)
    peak_start:int=Field(default=17,ge=0,le=23)
    peak_end:int=Field(default=21,ge=1,le=24)
class Court(Input):
    name:str=Field(min_length=1,max_length=120)
    sport:str=Field(max_length=30)
    hourly_minor:int=Field(gt=0,le=1000000)
    currency:str=Field(default='EUR',pattern=r'^(EUR|GBP|USD|SEK|DKK|NOK|CHF|CZK|PLN)$')
    timezone:str=Field(default='Europe/Lisbon',max_length=80)
    rules:Rules
class CourtUpdate(Input):
    hourly_minor:int=Field(gt=0,le=1000000)
    rules:Rules
class StaffBooking(Hold):
    contact_id:str=Field(min_length=1,max_length=80)
    participants:int=Field(default=1,ge=1,le=4)
    accept_policy:bool
class SourceReview(Input):
    version:int=Field(gt=0)
    approve:bool=False
    note:str=Field(min_length=5,max_length=2000)
class Csv(Input):
    source:str=Field(min_length=1,max_length=40,pattern=r'^[a-z0-9_-]+$')
    content:str=Field(max_length=2_000_000)
class Mapping(Input):
    provider:str=Field(min_length=1,max_length=40,pattern=r'^[a-z0-9_-]+$')
    external_id:str=Field(min_length=1,max_length=120)
    court_id:str=Field(min_length=1,max_length=80)
class Snapshot(Input):
    window_start:str
    window_end:str
    observed_at:str
    complete:bool
    source_ref:str=Field(min_length=5,max_length=2000)
    records:list[dict]=Field(max_length=5000)
class Run(Input):snapshot_id:str=Field(max_length=80)
class Review(Input):
    version:int=Field(gt=0)
    action:str=Field(pattern=r'^(acknowledge|assign|propose_accept|approve)$')
    note:str=Field(min_length=5,max_length=2000)
    assignee:str|None=Field(default=None,max_length=80)
class Integration(Input):
    tenant_id:str=Field(min_length=1,max_length=120)
    credential_ref:str=Field(pattern=r'^PLAYTOMIC_[A-Z0-9_]{1,70}$')
    authorization_ref:str=Field(min_length=5,max_length=2000)
class Sync(Input):
    kind:str=Field(pattern='^(bookings|players|payments)$')
    window_start:str
    window_end:str
class Money(Input):
    source:str=Field(min_length=1,max_length=40)
    external_id:str=Field(min_length=1,max_length=120)
    kind:str
    amount_minor:int=Field(ge=0,le=100000000)
    currency:str=Field(pattern='^(EUR|GBP|USD|SEK|DKK|NOK|CHF|CZK|PLN)$')
    booking_id:str|None=None
    batch_ref:str|None=Field(default=None,max_length=120)
    evidence_ref:str=Field(min_length=5,max_length=2000)
class Cutover(Input):
    confirmation:str
    backup_ref:str=Field(min_length=5,max_length=2000)
    legacy_disabled_ref:str=Field(min_length=5,max_length=2000)
    recon_run_ids:dict[str,str]={}
class Note(Input):note:str=Field(min_length=5,max_length=2000)

def create_app(settings=None,db=None,http=None,clock=time.time,service=None):
    settings=settings or Settings.from_env();settings.validate();service=service or os.getenv('FMC_SERVICE','all')
    if service not in ('all','core','operations'):raise RuntimeError('Unknown service mode')
    # Only local development may create the legacy source schema.  Staging and
    # production point at the managed Supabase contract and must never mutate it
    # implicitly at application start.
    db=db or d.Store(settings.database,settings.environment in ('staging','production'),initialize=settings.environment=='development')
    auth=Auth(db,settings,http,clock);booking=Booking(db,clock);ops=Operations(db,clock);recon=Reconciliation(db,clock);queue=Queue(db,clock)
    app=FastAPI(title='FillMyCourt shared platform',version='0.4.0',docs_url=None,redoc_url=None,openapi_url=None)
    app.state.db=db;app.state.auth=auth;app.state.booking=booking;app.state.ops=ops;app.state.recon=recon;app.state.queue=queue
    @app.exception_handler(DomainError)
    async def domain(request,e):return JSONResponse({'error':e.code,'message':e.message},status_code=e.status)
    @app.exception_handler(IntegrityError)
    async def integrity(request,e):return JSONResponse({'error':'DATA_CONFLICT','message':'This operation conflicts with existing data. Reload before retrying.'},status_code=409)
    @app.exception_handler(OperationalError)
    async def busy(request,e):return JSONResponse({'error':'DATABASE_BUSY','message':'Storage temporarily unavailable; no success has been confirmed.'},status_code=503)
    @app.middleware('http')
    async def boundary(request:Request,call_next):
        request_id=ident('req');t=time.perf_counter();write=request.method not in ('GET','HEAD','OPTIONS')
        if write:
            try:length=int(request.headers.get('content-length','0'))
            except ValueError:return JSONResponse({'error':'BODY_LIMIT'},413)
            if length>3_000_000:return JSONResponse({'error':'BODY_LIMIT'},413)
            chunks=[];n=0
            async for chunk in request.stream():
                n+=len(chunk)
                if n>3_000_000:return JSONResponse({'error':'BODY_LIMIT'},413)
                chunks.append(chunk)
            request._body=b''.join(chunks)
            if request.url.path!='/api/auth/apple/callback':
                origin=request.headers.get('origin')
                if origin and origin.rstrip('/')!=settings.origin:return JSONResponse({'error':'ORIGIN'},403)
                if request.headers.get('x-gac-request')!='1':return JSONResponse({'error':'CSRF'},403)
        response=await call_next(request)
        response.headers.update({'X-Request-ID':request_id,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=(self)','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"})
        if request.url.path.startswith('/api/'):response.headers['Cache-Control']='no-store'
        if settings.environment!='production':response.headers['X-Robots-Tag']='noindex,nofollow'
        # No query strings, body, user IDs, token values or customer data in access logs.
        logging.getLogger('fmc.http').info(json.dumps({'request_id':request_id,'service':service,'status':response.status_code,'ms':round((time.perf_counter()-t)*1000,2)}))
        return response
    def token(r):return r.cookies.get('gac_session')
    def member(r,v,roles=None):return auth.require_member(token(r),v,roles)
    def ready():
        if not settings.booking_enabled:raise DomainError('BOOKING_UNAVAILABLE','Direct booking is not enabled on this deployment.',503)
    @app.get('/api/health')
    def health():return {'ok':True,'service':service,'version':'0.4.0'}
    @app.get('/health/ready')
    def readiness():
        with db.read() as c:c.execute(text('SELECT 1'))
        return {'ok':True}
    @app.get('/api/config')
    def config():return {'version':'0.4.0','auth':{p:settings.enabled(p) for p in ('google','apple')},'booking_enabled':settings.booking_enabled,'terms_version':settings.terms_version,'legal_ready':settings.legal_ready,'online_payments':False}
    @app.get('/api/me')
    def me(request:Request):return {'user':auth.user(token(request),required=False)}
    if service in ('core','operations','all'):
        @app.get('/api/auth/{provider}/start')
        def start(provider:str,request:Request):
            auth.rate_limit(request.client.host if request.client else 'unknown');url,browser=auth.begin(provider,request.cookies.get('gac_oauth'));r=RedirectResponse(url,303)
            r.set_cookie('gac_oauth',browser,httponly=True,secure=settings.secure,samesite='none' if settings.secure else 'lax',max_age=600,path='/api/auth');return r
        @app.api_route('/api/auth/{provider}/callback',methods=['GET','POST'])
        async def callback(provider:str,request:Request):
            if (provider=='google' and request.method!='GET') or (provider=='apple' and request.method!='POST') or provider not in ('google','apple'):return RedirectResponse('/?auth_error=invalid_callback',303)
            params=dict(request.query_params) if request.method=='GET' else {k:v[0] for k,v in parse_qs((await request.body()).decode('utf-8',errors='replace'),max_num_fields=15).items()}
            try:
                if params.get('error'):raise DomainError('LOGIN_CANCELLED','Sign-in cancelled')
                session=auth.complete(provider,params.get('state',''),request.cookies.get('gac_oauth',''),params.get('code',''))
                if token(request):auth.logout(token(request))
                r=RedirectResponse('/fmc/' if service=='operations' else '/?signed_in=1',303);r.set_cookie('gac_session',session,httponly=True,secure=settings.secure,samesite='lax',max_age=7*86400,path='/')
            except DomainError:r=RedirectResponse('/?auth_error=sign_in_failed',303)
            r.delete_cookie('gac_oauth',path='/api/auth',secure=settings.secure,samesite='none' if settings.secure else 'lax');return r
        @app.put('/api/me/profile')
        def profile(b:Profile,request:Request):return auth.onboarding(auth.user(token(request)),b.model_dump())
        @app.post('/api/auth/logout')
        def logout(request:Request,response:Response):auth.logout(token(request));response.delete_cookie('gac_session',path='/');return {'ok':True}
    if service in ('core','all'):
        @app.get('/api/availability')
        def availability(sport:str,date:str,time:str='07:00',end_time:str='23:00',duration:int=90,location:str='Cascais',radius:int=25,indoor:str='all',lat:float|None=None,lon:float|None=None,sort:str='time'):
            if not settings.booking_enabled:return {'venues':[],'status':'inventory_not_open'}
            return booking.search(sport=sport,date=date,time=time,end_time=end_time,duration=duration,location=location,radius=radius,indoor=indoor,lat=lat,lon=lon,sort=sort)
        @app.get('/api/quote')
        def quote(court_id:str,date:str,time:str,duration:int):ready();return booking.quote(court_id,date,time,duration)
        @app.post('/api/holds',status_code=201)
        def hold(b:Hold,request:Request):
            ready();actor=auth.player(token(request));auth.rate_limit(actor,'holds',60);return booking.hold(actor,b.court_id,b.date,b.time,b.duration,request.headers.get('idempotency-key',''))
        @app.post('/api/bookings/{bid}/confirm')
        def confirm(bid:str,b:Confirm,request:Request):ready();return booking.confirm(auth.player(token(request)),bid,b.participants,request.headers.get('idempotency-key',''),b.accept_policy,b.payment)
        @app.post('/api/bookings/{bid}/cancel')
        def cancel(bid:str,request:Request):return booking.cancel(auth.player(token(request)),bid)
        @app.get('/api/bookings')
        def my_bookings(request:Request,after:str='',limit:int=Query(50,ge=1,le=100)):return {'bookings':booking.list_for(auth.player(token(request)),after,limit)}
        @app.get('/api/bookings/{bid}/calendar.ics')
        def calendar_file(bid:str,request:Request):
            actor=auth.player(token(request))
            with db.read() as c:b=booking.owned(c,actor,bid)
            if b['status']!='confirmed':raise DomainError('STATE','Only confirmed bookings can be exported.',409)
            fmt=lambda t:datetime.fromtimestamp(t,timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//GetACourt//Booking//EN','BEGIN:VEVENT',f'UID:{bid}@getacourt.com',f'DTSTAMP:{fmt(clock())}',f"DTSTART:{fmt(b['starts_at'])}",f"DTEND:{fmt(b['ends_at'])}",'SUMMARY:Court booking','STATUS:CONFIRMED','END:VEVENT','END:VCALENDAR','']
            return Response('\r\n'.join(lines),media_type='text/calendar')
    if service in ('operations','all'):
        @app.get('/api/fmc/clubs')
        def clubs(request:Request):return {'items':auth.clubs(token(request))}
        @app.post('/api/fmc/clubs',status_code=201)
        def add_club(b:Club,request:Request):
            auth.player(token(request));return ops.create_club(auth.user(token(request)),b.model_dump())
        @app.get('/api/fmc/{venue}/gates')
        def gates(venue:str,request:Request):return ops.migration_gates(member(request,venue))
        @app.get('/api/fmc/{venue}/calendar')
        def calendar(venue:str,date:str,request:Request):return ops.calendar(member(request,venue),date)
        @app.post('/api/fmc/{venue}/courts',status_code=201)
        def court(venue:str,b:Court,request:Request):return ops.add_court(member(request,venue,['owner','manager']),b.model_dump())
        @app.put('/api/fmc/{venue}/courts/{cid}')
        def court_update(venue:str,cid:str,b:CourtUpdate,request:Request):return ops.update_court(member(request,venue,['owner','manager']),cid,b.model_dump())
        @app.post('/api/fmc/{venue}/reservations',status_code=201)
        def staff_booking(venue:str,b:StaffBooking,request:Request):return ops.reserve_for_contact(member(request,venue,['owner','manager','staff']),b.model_dump(),request.headers.get('idempotency-key',''))
        @app.post('/api/fmc/{venue}/reservations/{bid}/cancel')
        def staff_cancel(venue:str,bid:str,b:Note,request:Request):return ops.cancel_booking(member(request,venue,['owner','manager']),bid,b.note)
        @app.post('/api/fmc/{venue}/reconciliation/issues/{iid}/source-sync')
        def source_sync(venue:str,iid:str,b:SourceReview,request:Request):return recon.sync_issue(member(request,venue,['owner','manager','accountant']),iid,b.version,b.approve,b.note)
        @app.post('/api/fmc/{venue}/mappings')
        def mapping(venue:str,b:Mapping,request:Request):return ops.map_court(member(request,venue,['owner','manager']),b.provider,b.external_id,b.court_id)
        @app.post('/api/fmc/{venue}/blocks')
        def block(venue:str,b:Hold,request:Request):return ops.block(member(request,venue,['owner','manager','staff']),b.court_id,b.date,b.time,b.duration,request.headers.get('idempotency-key',''))
        @app.delete('/api/fmc/{venue}/blocks/{bid}')
        def unblock(venue:str,bid:str,request:Request):return ops.unblock(member(request,venue,['owner','manager','staff']),bid)
        @app.post('/api/fmc/{venue}/courts/{cid}/activate')
        def activate(venue:str,cid:str,b:Cutover,request:Request):return ops.activate(member(request,venue,['owner']),cid,b.model_dump())
        @app.post('/api/fmc/{venue}/courts/{cid}/pause')
        def pause(venue:str,cid:str,b:Note,request:Request):return ops.pause(member(request,venue,['owner','manager']),cid,b.note)
        @app.get('/api/fmc/{venue}/contacts')
        def contacts(venue:str,request:Request,q:str='',after:str='',limit:int=Query(50,ge=1,le=100)):return ops.contacts(member(request,venue),q,after,limit)
        @app.get('/api/fmc/{venue}/imports')
        def import_list(venue:str,request:Request):return {'items':ops.import_list(member(request,venue))}
        @app.post('/api/fmc/{venue}/imports')
        def stage(venue:str,b:Csv,request:Request):return ops.stage_contacts(member(request,venue,['owner','manager']),b.source,b.content)
        @app.post('/api/fmc/{venue}/imports/{bid}/commit')
        def commit(venue:str,bid:str,request:Request):return ops.commit_contacts(member(request,venue,['owner','manager']),bid)
        @app.post('/api/fmc/{venue}/imports/{bid}/rollback')
        def rollback(venue:str,bid:str,request:Request):return ops.rollback_contacts(member(request,venue,['owner']),bid)
        @app.get('/api/fmc/{venue}/snapshots')
        def snapshots(venue:str,request:Request):
            member(request,venue)
            with db.read() as c:return {'items':d.rows(c,select(d.snapshots.c.id,d.snapshots.c.provider,d.snapshots.c.complete,d.snapshots.c.observed_at,d.snapshots.c.source_ref).where(d.snapshots.c.venue_id==venue).order_by(d.snapshots.c.created.desc()).limit(50))}
        @app.post('/api/fmc/{venue}/snapshots/{provider}')
        def snapshot(venue:str,provider:str,b:Snapshot,request:Request):return recon.ingest(member(request,venue,['owner','manager','accountant']),provider,b.model_dump())
        @app.post('/api/fmc/{venue}/snapshots/{sid}/baseline')
        def baseline(venue:str,sid:str,request:Request):return recon.baseline(member(request,venue,['owner','manager']),sid)
        @app.post('/api/fmc/{venue}/reconciliation')
        def run(venue:str,b:Run,request:Request):
            who=member(request,venue,['owner','manager','accountant'])
            with db.read() as c:
                if not d.one(c,select(d.snapshots.c.id).filter_by(id=b.snapshot_id,venue_id=venue)):raise DomainError('NOT_FOUND','Snapshot not found.',404)
            return queue.enqueue(who,'reconcile',request.headers.get('idempotency-key',''),b.model_dump())
        @app.get('/api/fmc/{venue}/reconciliation')
        def runs(venue:str,request:Request):member(request,venue);return {'items':recon.runs(venue)}
        @app.get('/api/fmc/{venue}/issues')
        def issues(venue:str,request:Request,run:str|None=None,after:str='',limit:int=Query(100,ge=1,le=100)):member(request,venue);return recon.issues(venue,run,after,limit)
        @app.post('/api/fmc/{venue}/issues/{iid}/review')
        def review(venue:str,iid:str,b:Review,request:Request):return recon.review(member(request,venue,['owner','manager','accountant']),iid,b.version,b.action,b.note,b.assignee)
        @app.get('/api/fmc/{venue}/reconciliation/{rid}/export.csv')
        def export(venue:str,rid:str,request:Request):member(request,venue,['owner','manager','accountant']);return Response(recon.csv(venue,rid),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="reconciliation.csv"'})
        @app.post('/api/fmc/{venue}/money-events')
        def money_event(venue:str,b:Money,request:Request):return recon.record_money(member(request,venue,['owner','accountant']),b.model_dump())
        @app.get('/api/fmc/{venue}/settlement')
        def settlement(venue:str,batch:str,request:Request):member(request,venue,['owner','manager','accountant']);return recon.settlement(venue,batch)
        @app.get('/api/fmc/{venue}/payment-reports')
        def payment_reports(venue:str,request:Request):
            member(request,venue,['owner','manager','accountant'])
            with db.read() as c:return {'items':d.rows(c,select(d.reports.c.id,d.reports.c.created,d.reports.c.complete).where(d.reports.c.venue_id==venue).order_by(d.reports.c.created.desc()).limit(30))}
        @app.get('/api/fmc/{venue}/payment-reports/{rid}')
        def payment_report(venue:str,rid:str,request:Request):
            member(request,venue,['owner','manager','accountant'])
            with db.read() as c:r=d.one(c,select(d.reports).filter_by(id=rid,venue_id=venue))
            if not r:raise DomainError('NOT_FOUND','Report not found.',404)
            return {'id':rid,'records':json.loads(r['data']),'linking':'No booking-ID mapping is inferred.'}
        @app.get('/api/fmc/{venue}/jobs')
        def jobs(venue:str,request:Request):member(request,venue);return {'items':queue.list(venue)}
        @app.post('/api/fmc/{venue}/jobs/{jid}/retry')
        def retry(venue:str,jid:str,request:Request):return queue.retry(member(request,venue,['owner','manager']),jid)
        @app.put('/api/fmc/{venue}/integrations/playtomic')
        def configure(venue:str,b:Integration,request:Request):
            who=member(request,venue,['owner'])
            if os.getenv(b.credential_ref+'_FMC_VENUE_ID')!=venue or os.getenv(b.credential_ref+'_TENANT_ID')!=b.tenant_id:
                raise DomainError('CREDENTIAL_BINDING','A deployment administrator must bind these credentials to this FmC venue and provider tenant first.',403)
            with db.tx() as c:
                db.lock(c,d.venues,id=venue);old=d.one(c,select(d.integrations).filter_by(venue_id=venue,provider='playtomic'))
                if old:c.execute(update(d.integrations).filter_by(venue_id=venue,provider='playtomic').values(**b.model_dump(),status='configured',last_error=None))
                else:c.execute(insert(d.integrations).values(venue_id=venue,provider='playtomic',**b.model_dump(),status='configured',next_allowed=0))
                db.emit(c,venue,who['id'],'integration.configured',venue,{'provider':'playtomic'},int(clock()))
            return {'configured':True,'secrets_set':bool(os.getenv(b.credential_ref+'_CLIENT_ID') and os.getenv(b.credential_ref+'_CLIENT_SECRET')),'write_access':False}
        @app.get('/api/fmc/{venue}/integrations')
        def integration_list(venue:str,request:Request):
            member(request,venue)
            with db.read() as c:return {'items':d.rows(c,select(d.integrations).where(d.integrations.c.venue_id==venue))}
        @app.post('/api/fmc/{venue}/integrations/playtomic/sync')
        def sync(venue:str,b:Sync,request:Request):
            a,z=stamp(b.window_start),stamp(b.window_end)
            if not 0<z-a<=365*86400:raise DomainError('DATE_RANGE','Use a window up to 365 days.',422)
            return queue.enqueue(member(request,venue,['owner','manager','accountant']),'sync_'+b.kind,request.headers.get('idempotency-key',''),{'window_start':b.window_start,'window_end':b.window_end})
        @app.get('/api/fmc/{venue}/audit')
        def audit(venue:str,request:Request,after:str='',limit:int=Query(50,ge=1,le=100)):
            member(request,venue,['owner','manager','accountant'])
            with db.read() as c:return {'items':d.rows(c,select(d.audit).where(d.audit.c.venue_id==venue,d.audit.c.id>after).order_by(d.audit.c.id).limit(limit))}
    @app.get('/legal/{kind}')
    def legal(kind:str):
        if kind not in ('terms','privacy'):raise DomainError('NOT_FOUND','Page not found.',404)
        path=Path(os.getenv('FMC_LEGAL_DIR',str(ROOT/'legal')))/(kind+'.html')
        if not path.is_file():raise DomainError('LEGAL_NOT_CONFIGURED','The operator has not published this legal document yet.',503)
        return FileResponse(path,media_type='text/html')
    app.mount('/',StaticFiles(directory=ROOT/'public',html=True),name='web')
    return app
