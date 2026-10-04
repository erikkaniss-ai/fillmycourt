import json,pytest,time
from datetime import datetime,timezone
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import select,insert,update,func
from fastapi.testclient import TestClient
from fmc import db as d
from fmc.app import create_app
from fmc.common import DomainError,canonical
from fmc.config import Settings
from fmc.jobs import Worker
from conftest import snapshot

def count(e,t):
    with e.db.read() as c:return c.execute(select(func.count()).select_from(t)).scalar_one()
def hold(e,name='player',at='10:00',key='hold-key-0001'):
    return e.booking.hold(e.users[name]['id'],e.ct['id'],e.date,at,60,key)
def baseline(e):
    s=e.recon.ingest(e.who['owner'],'playtomic',snapshot(e));e.recon.baseline(e.who['owner'],s['id']);return s

def test_real_booking_flow_and_club_calendar(env):
    e=env;h=hold(e);b=e.booking.confirm(e.users['player']['id'],h['id'],4,'confirm-key-01',True)
    assert b['status']=='confirmed';assert b['total_minor']==2000
    assert any(r['id']==b['id'] for r in e.ops.calendar(e.who['owner'],e.date)['reservations'])
    assert e.booking.cancel(e.users['player']['id'],b['id'])['status']=='cancelled'
    assert hold(e,'player2',key='hold-key-0002')['status']=='held'

def test_same_slot_parallel_one_winner(env):
    e=env
    def f(i):
        try:return hold(e,'player' if i%2 else 'player2',key=f'parallel-{i:03}')['status']
        except DomainError as x:return x.code
    with ThreadPoolExecutor(max_workers=16) as pool:r=list(pool.map(f,range(16)))
    assert r.count('held')==1;assert len(r)==16

def test_idempotent_hold_and_confirm(env):
    e=env;h=hold(e);assert hold(e)['id']==h['id']
    assert count(e,d.bookings)==1
    a=e.booking.confirm(e.users['player']['id'],h['id'],4,'confirm-1',True)
    b=e.booking.confirm(e.users['player']['id'],h['id'],4,'confirm-1',True)
    assert a['id']==b['id'];assert count(e,d.bookings)==1

def test_changed_idempotency_payload(env):
    hold(env)
    with pytest.raises(DomainError,match='different'):hold(env,at='12:00')

def test_hold_expiry(env):
    h=hold(env);env.clock[0]+=601
    with pytest.raises(DomainError):env.booking.confirm(env.users['player']['id'],h['id'],4,'confirm-expired',True)
    assert hold(env,'player2',key='new-holder')['status']=='held'

def test_peak_price_server(env):
    assert env.booking.quote(env.ct['id'],env.date,'18:00',90)['price_minor']==3900

def test_overlapping_durations(env):
    e=env;e.booking.hold(e.users['player']['id'],e.ct['id'],e.date,'10:00',90,'hold-overlap')
    with pytest.raises(DomainError):e.booking.hold(e.users['player2']['id'],e.ct['id'],e.date,'11:00',60,'hold-other')

def test_ownership_isolation(env):
    e=env;h=hold(e)
    with pytest.raises(DomainError):e.booking.confirm(e.users['player2']['id'],h['id'],4,'other-confirm',True)
    with pytest.raises(DomainError):e.auth.require_member(e.tokens['outsider'],e.club['id'])
    with pytest.raises(DomainError):e.auth.require_member(e.tokens['staff'],e.club['id'],['owner'])

def test_maintenance_shared_with_search(env):
    e=env;b=e.ops.block(e.who['manager'],e.ct['id'],e.date,'10:00',60,'maintenance1')
    with pytest.raises(DomainError):hold(e)
    e.ops.unblock(e.who['manager'],b['id']);assert hold(e)['status']=='held'

def test_court_disabled_until_cutover(env):
    e=env
    with pytest.raises(DomainError):e.booking.quote(e.external['id'],e.date,'10:00',60)

def test_no_card_payment_without_processor(env):
    e=env;h=hold(e)
    with pytest.raises(DomainError):e.booking.confirm(e.users['player']['id'],h['id'],4,'card-confirm',True,'card')

def test_pause_stops_new_not_cancellation(env):
    e=env;h=hold(e);b=e.booking.confirm(e.users['player']['id'],h['id'],4,'pause-conf',True)
    e.ops.pause(e.who['owner'],e.ct['id'],'stop sales test')
    with pytest.raises(DomainError):hold(e,'player2',at='12:00',key='paused-new')
    assert e.booking.cancel(e.users['player']['id'],b['id'])['status']=='cancelled'

def test_search_bulk_respects_radius_time_and_occupied(env):
    e=env;hold(e)
    r=e.booking.search(sport='padel',date=e.date,time='10:00',end_time='12:00',duration=60,location='Cascais',radius=25)
    assert r['venues']
    assert not any(s['time']=='10:00' for v in r['venues'] for s in v['slots'] if s['court_id']==e.ct['id'])
    r=e.booking.search(sport='padel',date=e.date,lat=0,lon=0,radius=1)
    assert r['venues']==[]

def test_contact_stage_commit_rollback(env):
    e=env;csv='external_id,name,email,consent,consent_proof\np1,Alice,a@example.test,granted,venue consent record 123\n'
    b=e.ops.stage_contacts(e.who['owner'],'export',csv);assert b['status']=='staged';assert count(e,d.contacts)==0
    assert e.ops.commit_contacts(e.who['owner'],b['id'])['inserted']==1
    assert e.ops.commit_contacts(e.who['owner'],b['id'])['replayed']
    assert e.ops.contacts(e.who['owner'],'ali')['items'][0]['consent']=='granted'
    assert e.ops.rollback_contacts(e.who['owner'],b['id'])['removed']==1

def test_import_validation_no_consent_fabrication(env):
    b=env.ops.stage_contacts(env.who['owner'],'csv','external_id,name,consent\np1,Alice,granted\n')
    assert b['status']=='invalid'
    with pytest.raises(DomainError):env.ops.commit_contacts(env.who['owner'],b['id'])
    assert count(env,d.contacts)==0

def test_import_duplicate_email_atomic(env):
    e=env;b=e.ops.stage_contacts(e.who['owner'],'a','external_id,name,email\np1,Alice,a@example.test\n');e.ops.commit_contacts(e.who['owner'],b['id'])
    b=e.ops.stage_contacts(e.who['owner'],'b','external_id,name,email\np2,Bob,b@example.test\np3,Alice,a@example.test\n')
    with pytest.raises(DomainError):e.ops.commit_contacts(e.who['owner'],b['id'])
    assert count(e,d.contacts)==1

def test_import_tenant_scope_and_rollback_modified(env):
    e=env;b=e.ops.stage_contacts(e.who['owner'],'csv','external_id,name,email\np1,Alice,a@example.test\n');e.ops.commit_contacts(e.who['owner'],b['id'])
    assert e.ops.contacts({'venue_id':e.other['id']})['items']==[]
    with e.db.tx() as c:c.execute(update(d.contacts).values(name='Changed'))
    with pytest.raises(DomainError):e.ops.rollback_contacts(e.who['owner'],b['id'])
    assert count(e,d.contacts)==1

def test_snapshot_dedupe_and_schema(env):
    e=env;b=snapshot(e);s=e.recon.ingest(e.who['owner'],'playtomic',b)
    assert e.recon.ingest(e.who['owner'],'playtomic',b)['id']==s['id']
    b['records'].append(b['records'][0].copy())
    with pytest.raises(DomainError):e.recon.ingest(e.who['owner'],'playtomic',b)

def test_baseline_not_sales_and_matching_run(env):
    e=env;s=baseline(e);r=e.recon.run(e.club['id'],s['id'],'run-one')
    assert r['summary']['issues']==0;assert e.recon.runs(e.club['id'])[0]['status']=='matched'
    assert e.recon.run(e.club['id'],s['id'],'run-one')['replayed']
    with pytest.raises(DomainError):e.booking.quote(e.external['id'],e.date,'12:00',60)

def test_financial_mismatch_not_silent_fix(env):
    e=env;baseline(e);e.clock[0]+=1;b=snapshot(e);b['records'][0]['total_minor']=2700
    s=e.recon.ingest(e.who['owner'],'playtomic',b);r=e.recon.run(e.club['id'],s['id'],'money-run')
    issues=e.recon.issues(e.club['id'],r['id'])['items'];assert any(i['category']=='financial_mismatch' for i in issues)
    with e.db.read() as c:assert d.one(c,select(d.bookings).filter_by(external_id='source-booking-1'))['total_minor']==2000

def test_partial_snapshot_does_not_assert_missing(env):
    e=env;baseline(e);e.clock[0]+=1;s=e.recon.ingest(e.who['owner'],'playtomic',snapshot(e,records=[],complete=False));r=e.recon.run(e.club['id'],s['id'],'partial-run')
    cats=[i['category'] for i in e.recon.issues(e.club['id'],r['id'])['items']]
    assert 'partial_snapshot' in cats;assert 'missing_provider' not in cats

def test_full_snapshot_missing_and_stale(env):
    e=env;baseline(e);e.clock[0]+=1;s=e.recon.ingest(e.who['owner'],'playtomic',snapshot(e,records=[]));r=e.recon.run(e.club['id'],s['id'],'missing-run')
    assert any(i['category']=='missing_provider' for i in e.recon.issues(e.club['id'],r['id'])['items'])
    e.clock[0]+=901;r=e.recon.run(e.club['id'],s['id'],'stale-run')
    assert any(i['category']=='stale_evidence' for i in e.recon.issues(e.club['id'],r['id'])['items'])

def test_snapshot_scope_rejected(env):
    e=env;s=baseline(e)
    with pytest.raises(DomainError):e.recon.run(e.other['id'],s['id'],'wrong-run')

def test_review_four_eyes_and_optimistic_lock(env):
    e=env;s=e.recon.ingest(e.who['owner'],'playtomic',snapshot(e));r=e.recon.run(e.club['id'],s['id'],'review-run');i=e.recon.issues(e.club['id'],r['id'])['items'][0]
    e.recon.review(e.who['owner'],i['id'],1,'propose_accept','Documented exception rationale')
    with pytest.raises(DomainError):e.recon.review(e.who['owner'],i['id'],2,'approve','I approve my own exception')
    with pytest.raises(DomainError):e.recon.review(e.who['accountant'],i['id'],1,'approve','Stale version')
    e.recon.review(e.who['accountant'],i['id'],2,'approve','Independent review of evidence')
    assert e.recon.runs(e.club['id'])[0]['status']=='review';assert count(e,d.bookings)==0

def test_source_overlap_rejected_on_import(env):
    e=env;b=snapshot(e);second=b['records'][0].copy();second['external_id']='second';b['records'].append(second)
    s=e.recon.ingest(e.who['owner'],'playtomic',b)
    with pytest.raises(DomainError):e.recon.baseline(e.who['owner'],s['id'])
    assert count(e,d.bookings)==0

def test_money_match_separate_currencies_and_bank(env):
    e=env
    def add(kind,n,i,currency='EUR'):
        return e.recon.record_money(e.who['owner'],{'source':'statement','external_id':i,'kind':kind,'amount_minor':n,'currency':currency,'booking_id':None,'batch_ref':'payout-1','evidence_ref':'statement evidence'})
    add('capture',10000,'a');add('refund',1000,'b');add('fee',500,'c')
    assert e.recon.settlement(e.club['id'],'payout-1')['currencies'][0]['status']=='missing_evidence'
    add('payout_expected',8500,'d');add('bank_credit',8500,'e');add('capture',1000,'f','GBP')
    results={i['currency']:i for i in e.recon.settlement(e.club['id'],'payout-1')['currencies']}
    assert results['EUR']['status']=='matched';assert results['GBP']['status']=='missing_evidence'
    with pytest.raises(DomainError):add('capture',9999,'a')

def test_queue_claim_lease_and_idempotency(env):
    e=env;j=e.queue.enqueue(e.who['owner'],'reconcile','queue-key-1',{'snapshot_id':'x'})
    assert e.queue.enqueue(e.who['owner'],'reconcile','queue-key-1',{'snapshot_id':'x'})['id']==j['id']
    with pytest.raises(DomainError):e.queue.enqueue(e.who['owner'],'reconcile','queue-key-1',{'snapshot_id':'y'})
    a=e.queue.claim();assert e.queue.claim() is None;e.clock[0]+=121;b=e.queue.claim()
    with pytest.raises(DomainError):e.queue.finish(a,result={})
    e.queue.finish(b,result={'ok':True});assert e.queue.list(e.club['id'])[0]['status']=='done'

def test_queue_deadletter_replay(env):
    e=env;e.queue.enqueue(e.who['owner'],'reconcile','dead-key-01',{'snapshot_id':'missing'})
    w=Worker(e.db,e.now)
    for _ in range(5):assert w.step();e.clock[0]+=1000
    j=e.queue.list(e.club['id'])[0];assert j['status']=='dead'
    e.queue.retry(e.who['manager'],j['id']);assert e.queue.list(e.club['id'])[0]['status']=='queued'

def test_reconciliation_worker_real_flow(env):
    e=env;s=baseline(e);e.queue.enqueue(e.who['owner'],'reconcile','worker-run-1',{'snapshot_id':s['id']})
    assert Worker(e.db,e.now).step();assert e.queue.list(e.club['id'])[0]['status']=='done';assert e.recon.runs(e.club['id'])[0]['status']=='matched'

def test_cutover_fails_until_recent_matching_evidence(env):
    e=env
    with pytest.raises(DomainError):e.ops.activate(e.who['owner'],e.external['id'],{'confirmation':'I CONFIRM SINGLE BOOKING AUTHORITY','backup_ref':'backup123','legacy_disabled_ref':'disabled123','recon_run_ids':{}})
    s=baseline(e);r=e.recon.run(e.club['id'],s['id'],'cutover-run')
    e.ops.activate(e.who['owner'],e.external['id'],{'confirmation':'I CONFIRM SINGLE BOOKING AUTHORITY','backup_ref':'backup123','legacy_disabled_ref':'disabled123','recon_run_ids':{'playtomic':r['id']}})
    assert e.booking.quote(e.external['id'],e.date,'14:00',60)['price_minor']==2000

def test_http_no_demo_auth_and_error_no_booking(env):
    e=env;app=create_app(e.settings,e.db,clock=e.now);c=TestClient(app)
    assert c.get('/api/config').status_code==200
    assert c.post('/api/demo/login',headers={'X-GAC-Request':'1'}).status_code in (404,405)
    assert c.post('/api/holds',headers={'X-GAC-Request':'1','Idempotency-Key':'http-hold-01'},json={'court_id':e.ct['id'],'date':e.date,'time':'10:00','duration':60}).status_code==401
    assert count(e,d.bookings)==0
    c.cookies.set('gac_session',e.tokens['player'])
    body={'court_id':e.ct['id'],'date':e.date,'time':'10:00','duration':60}
    assert c.post('/api/holds',json=body).status_code==403
    assert c.post('/api/holds',headers={'X-GAC-Request':'1','Origin':'https://evil.example'},json=body).status_code==403
    assert c.post('/api/holds',headers={'X-GAC-Request':'1','Idempotency-Key':'http-hold-01'},json={**body,'price':1}).status_code==422
    assert count(e,d.bookings)==0

def test_http_player_to_staff_shared_database(env):
    e=env;c=TestClient(create_app(e.settings,e.db,clock=e.now));c.cookies.set('gac_session',e.tokens['player'])
    h=c.post('/api/holds',headers={'X-GAC-Request':'1','Idempotency-Key':'http-hold-02'},json={'court_id':e.ct['id'],'date':e.date,'time':'10:00','duration':60})
    assert h.status_code==201,h.text
    b=c.post('/api/bookings/'+h.json()['id']+'/confirm',headers={'X-GAC-Request':'1','Idempotency-Key':'http-conf-02'},json={'participants':4,'accept_policy':True,'payment':'venue'})
    assert b.status_code==200,b.text
    c.cookies.set('gac_session',e.tokens['manager']);r=c.get('/api/fmc/'+e.club['id']+'/calendar',params={'date':e.date})
    assert any(x['id']==h.json()['id'] for x in r.json()['reservations'])
    c.cookies.set('gac_session',e.tokens['outsider']);assert c.get('/api/fmc/'+e.club['id']+'/contacts').status_code==403

def test_integration_secrets_bound_to_tenant(env,monkeypatch):
    e=env;c=TestClient(create_app(e.settings,e.db,clock=e.now));c.cookies.set('gac_session',e.tokens['owner'])
    body={'tenant_id':'pt-tenant-1','credential_ref':'PLAYTOMIC_TEST','authorization_ref':'written contract approval'};url='/api/fmc/'+e.club['id']+'/integrations/playtomic';headers={'X-GAC-Request':'1'}
    assert c.put(url,json=body,headers=headers).status_code==403
    monkeypatch.setenv('PLAYTOMIC_TEST_FMC_VENUE_ID',e.club['id']);monkeypatch.setenv('PLAYTOMIC_TEST_TENANT_ID','pt-tenant-1')
    r=c.put(url,json=body,headers=headers);assert r.status_code==200;assert not r.json()['secrets_set']

def test_empty_app_and_missing_auth_do_not_fake(env):
    e=env;c=TestClient(create_app(Settings(database=e.settings.database),e.db,clock=e.now))
    assert not c.get('/api/config').json()['auth']['google']
    assert c.get('/api/auth/google/start',follow_redirects=False).status_code==503
    assert c.get('/api/availability',params={'sport':'padel','date':e.date}).json()['venues']==[]
    assert 'Try a demo' not in c.get('/').text;assert c.get('/fmc/').status_code==200

def test_production_requires_postgres_and_https():
    with pytest.raises(RuntimeError):Settings(environment='production').validate()

def test_staff_booking_for_imported_customer(env):
    e=env;bid=e.ops.stage_contacts(e.who['owner'],'csv','external_id,name\np1,Alice\n')['id'];e.ops.commit_contacts(e.who['owner'],bid);contact=e.ops.contacts(e.who['owner'])['items'][0]
    data={'court_id':e.ct['id'],'date':e.date,'time':'10:00','duration':60,'contact_id':contact['id'],'participants':4,'accept_policy':True}
    b=e.ops.reserve_for_contact(e.who['staff'],data,'staff-booking-1');assert b['status']=='confirmed';assert b['contact_id']==contact['id']
    assert e.ops.reserve_for_contact(e.who['staff'],data,'staff-booking-1')['id']==b['id']
    with pytest.raises(DomainError):hold(e)
    assert e.ops.cancel_booking(e.who['manager'],b['id'],'Customer requested cancellation')['status']=='cancelled'
    assert hold(e)['status']=='held'

def test_tariff_update_retains_booked_quote(env):
    e=env;h=hold(e)
    with e.db.read() as c:ct=d.one(c,select(d.courts).filter_by(id=e.ct['id']))
    e.ops.update_court(e.who['manager'],e.ct['id'],{'hourly_minor':5000,'rules':json.loads(ct['rules'])})
    assert e.booking.quote(e.ct['id'],e.date,'14:00',60)['price_minor']==5000
    assert e.booking.confirm(e.users['player']['id'],h['id'],4,'held-tariff-conf',True)['total_minor']==2000

def test_source_repair_requires_four_eyes_and_new_run(env):
    e=env;baseline(e);e.clock[0]+=1;b=snapshot(e);b['records'][0]['total_minor']=2500
    sid=e.recon.ingest(e.who['owner'],'playtomic',b)['id'];rid=e.recon.run(e.club['id'],sid,'repair-1')['id'];i=e.recon.issues(e.club['id'],rid)['items'][0]
    e.recon.sync_issue(e.who['manager'],i['id'],1,False,'Source export correction verified')
    with pytest.raises(DomainError):e.recon.sync_issue(e.who['manager'],i['id'],2,True,'Self approval should fail')
    result=e.recon.sync_issue(e.who['owner'],i['id'],2,True,'Owner independently checked source');assert result['status']=='source_applied';assert not result['external_writes']
    assert e.recon.runs(e.club['id'])[0]['status']=='review'
    new=e.recon.run(e.club['id'],sid,'repair-2');assert new['summary']['issues']==0

def test_source_repair_cannot_overwrite_native_authority(env):
    e=env;baseline(e);e.clock[0]+=1;b=snapshot(e);b['records'][0]['total_minor']=2500
    sid=e.recon.ingest(e.who['owner'],'playtomic',b)['id'];rid=e.recon.run(e.club['id'],sid,'repair-native')['id'];i=e.recon.issues(e.club['id'],rid)['items'][0]
    with e.db.tx() as c:c.execute(update(d.courts).where(d.courts.c.id==e.external['id']).values(authority='native'))
    with pytest.raises(DomainError):e.recon.sync_issue(e.who['manager'],i['id'],1,False,'Should not overwrite native')

def test_projector_idempotent_read_model(env):
    from fmc.jobs import Projector
    e=env;p=Projector(e.db);n=p.step();assert n>0;assert p.step()==0
    assert count(e,d.activity)==count(e,d.audit)
    with e.db.tx() as c:c.execute(update(d.outbox).values(status='pending'))
    p.step();assert count(e,d.activity)==count(e,d.audit)

def test_operator_service_has_auth_and_scoped_ops_not_search(env):
    c=TestClient(create_app(env.settings,env.db,clock=env.now,service='operations'))
    assert c.get('/api/auth/google/start',follow_redirects=False).status_code==303
    assert c.get('/api/availability',params={'sport':'padel','date':env.date}).status_code==404

def test_evidence_cannot_be_rewritten(env):
    from sqlalchemy.exc import IntegrityError
    e=env;baseline(e)
    with pytest.raises(IntegrityError):
        with e.db.tx() as c:c.execute(update(d.snapshots).values(source_ref='rewrite evidence'))
    with pytest.raises(IntegrityError):
        with e.db.tx() as c:c.execute(update(d.audit).values(action='erase audit'))
