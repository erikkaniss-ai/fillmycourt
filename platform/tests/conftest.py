"""Synthetic records exist only in tests; no demo login route is deployed."""
import pytest,time,json
from sqlalchemy import insert,update,select
from types import SimpleNamespace
from datetime import datetime,timezone,timedelta
from fmc.db import Store
from fmc import db as d
from fmc.config import Settings
from fmc.auth import Auth
from fmc.booking import Booking
from fmc.operations import Operations
from fmc.reconciliation import Reconciliation
from fmc.jobs import Queue
from fmc.common import canonical

@pytest.fixture
def env(tmp_path):
    clock=[int(time.time())];now=lambda:clock[0]
    db=Store('sqlite:///'+str(tmp_path/'test.db'))
    settings=Settings(origin='http://testserver',database=db.engine.url.render_as_string(),booking_enabled=True,legal_name='TEST operator',legal_address='TEST address',privacy_email='privacy@example.test',terms_version='test-v1',legal_published=True,google_id='test-client',google_secret='test-secret')
    auth=Auth(db,settings,clock=now);ops=Operations(db,now);booking=Booking(db,now);recon=Reconciliation(db,now);queue=Queue(db,now)
    users={};tokens={}
    for name in ['owner','manager','staff','accountant','outsider','player','player2']:
        token=auth.establish('google',{'sub':name,'email':name+'@example.test','name':name,'email_verified':True})
        u=auth.user(token);auth.onboarding(u,{'display_name':name,'city':'Cascais','sports':['padel'],'skill_level':'intermediate','locale':'en','marketing_opt_in':False,'accept_terms':True,'terms_version':'test-v1'})
        tokens[name]=token;users[name]=auth.user(token)
    club=ops.create_club(users['owner'],{'organisation':'Test Sports','name':'Test Club (test fixture)','city':'Cascais','lat':38.7,'lon':-9.42,'indoor':True,'timezone':'Europe/Lisbon'})
    other=ops.create_club(users['outsider'],{'organisation':'Other Test Sports','name':'Other fixture','city':'Lisbon','lat':38.71,'lon':-9.1,'indoor':False,'timezone':'Europe/Lisbon'})
    with db.tx() as c:
        for name in ['manager','staff','accountant']:c.execute(insert(d.members).values(organisation_id=club['organisation_id'],player_id=users[name]['id'],role=name))
    who={k:auth.require_member(tokens[k],club['id']) for k in ['owner','manager','staff','accountant']}
    rules={'opening_minute':420,'closing_minute':1380,'step_minutes':30,'durations':[60,90,120],'booking_days':30,'cancellation_hours':12,'policy_version':'court-v1','peak_addon_minor':600,'peak_start':17,'peak_end':21}
    ct=ops.add_court(who['owner'],{'name':'Court 1','sport':'padel','hourly_minor':2000,'currency':'EUR','timezone':'Europe/Lisbon','rules':rules})
    external=ops.add_court(who['owner'],{'name':'Court 2','sport':'padel','hourly_minor':2000,'currency':'EUR','timezone':'Europe/Lisbon','rules':rules})
    with db.tx() as c:
        v=d.one(c,select(d.venues).filter_by(id=club['id']));data=json.loads(v['data']);data['admin_verified']=True;c.execute(update(d.venues).where(d.venues.c.id==club['id']).values(data=canonical(data)))
    ops.activate(who['owner'],ct['id'],{'confirmation':'I CONFIRM SINGLE BOOKING AUTHORITY','backup_ref':'test-evidence-backup','legacy_disabled_ref':'no-previous-system-test','recon_run_ids':{}})
    ops.map_court(who['owner'],'playtomic','external-court-2',external['id'])
    date=(datetime.fromtimestamp(now(),timezone.utc)+timedelta(days=3)).strftime('%Y-%m-%d')
    obj=SimpleNamespace(db=db,clock=clock,now=now,settings=settings,auth=auth,ops=ops,booking=booking,recon=recon,queue=queue,users=users,tokens=tokens,club=club,other=other,who=who,ct=ct,external=external,date=date)
    yield obj
    db.engine.dispose()

def snapshot(e,**changes):
    dt=datetime.fromisoformat(e.date).replace(tzinfo=timezone.utc)
    b={'window_start':datetime.fromtimestamp(e.now()-3600,timezone.utc).isoformat(),'window_end':datetime.fromtimestamp(e.now()+32*86400,timezone.utc).isoformat(),'observed_at':datetime.fromtimestamp(e.now(),timezone.utc).isoformat(),'complete':True,'source_ref':'test-authorized-export','records':[{'external_id':'source-booking-1','court_external_id':'external-court-2','starts_at':dt.replace(hour=10).isoformat(),'ends_at':dt.replace(hour=11).isoformat(),'status':'confirmed','total_minor':2000,'paid_minor':2000,'refunded_minor':0,'currency':'EUR'}]}
    b.update(changes);return b
