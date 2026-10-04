"""Durable leased worker: at-least-once delivery, idempotent handlers, dead letters.

No API request waits for a paginated provider export. Checkpoints survive restarts.
"""
import csv,io,json,os,time
from sqlalchemy import select,insert,update,and_,or_
from . import db as d
from .common import DomainError,ident,canonical,require_key
from .playtomic import Playtomic,Deferred
from .reconciliation import Reconciliation
from .operations import Operations
class Queue:
    def __init__(self,db,clock=time.time):self.db,self.clock=db,clock
    def now(self):return int(self.clock())
    def enqueue(self,who,kind,key,payload):
        require_key(key)
        if kind not in ('reconcile','sync_bookings','sync_players','sync_payments'):raise DomainError('JOB_TYPE','Unsupported job.',422)
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=who['venue_id'])
            r=d.one(c,select(d.jobs).filter_by(venue_id=who['venue_id'],kind=kind,dedupe_key=key))
            if r:
                original=json.loads(r['payload']).get('request',json.loads(r['payload']))
                if original!=payload:raise DomainError('IDEMPOTENCY_CONFLICT','Job key has different parameters.',409)
                return {'id':r['id'],'status':r['status']}
            jid=ident('job');c.execute(insert(d.jobs).values(id=jid,venue_id=who['venue_id'],kind=kind,dedupe_key=key,payload=canonical({'request':payload,'progress':{'page':0,'records':[],'seen_cursors':[]}}),status='queued',due=self.now(),attempts=0,created=self.now()))
            self.db.emit(c,who['venue_id'],who['id'],'job.queued',jid,{'kind':kind},self.now())
            return {'id':jid,'status':'queued'}
    def claim(self, kinds=None):
        with self.db.tx() as c:
            q=select(d.jobs).where(or_(and_(d.jobs.c.status=='queued',d.jobs.c.due<=self.now()),and_(d.jobs.c.status=='running',d.jobs.c.lease_until<self.now()))).order_by(d.jobs.c.due,d.jobs.c.id).limit(1)
            if kinds:
                q=q.where(d.jobs.c.kind.in_(tuple(kinds)))
            if self.db.postgres:q=q.with_for_update(skip_locked=True)
            r=d.one(c,q)
            if not r:return None
            token=ident('lease');c.execute(update(d.jobs).where(d.jobs.c.id==r['id']).values(status='running',lease_token=token,lease_until=self.now()+120))
            r.update(status='running',lease_token=token);return r
    def finish(self,job,result=None,error=None,delay=None,progress=None):
        with self.db.tx() as c:
            r=self.db.lock(c,d.jobs,id=job['id'])
            if r['lease_token']!=job['lease_token'] or r['status']!='running':raise DomainError('LEASE_LOST','Job lease was replaced.',409)
            values={'lease_token':None,'lease_until':None}
            if progress is not None:
                values.update(status='queued',payload=canonical(progress),due=self.now()+int(delay or 60))
            elif error:
                count=r['attempts']+1;values.update(attempts=count,error=error,status='dead' if count>=5 else 'queued',due=self.now()+int(delay or min(900,2**count*5)))
            else:values.update(status='done',result=canonical(result),error=None)
            c.execute(update(d.jobs).where(d.jobs.c.id==job['id']).values(**values))
    def list(self,venue):
        with self.db.read() as c:
            return d.rows(c,select(d.jobs.c.id,d.jobs.c.kind,d.jobs.c.status,d.jobs.c.attempts,d.jobs.c.due,d.jobs.c.error,d.jobs.c.result).where(d.jobs.c.venue_id==venue).order_by(d.jobs.c.created.desc()).limit(100))
    def retry(self,who,jid):
        with self.db.tx() as c:
            r=self.db.lock(c,d.jobs,id=jid,venue_id=who['venue_id'])
            if not r or r['status']!='dead':raise DomainError('JOB_STATE','Only a dead-letter job can be replayed manually.',409)
            c.execute(update(d.jobs).where(d.jobs.c.id==jid).values(status='queued',due=self.now(),attempts=0,error=None));self.db.emit(c,who['venue_id'],who['id'],'job.replayed',jid,at=self.now())
        return {'ok':True}
class Worker:
    def __init__(self,db,clock=time.time,client_factory=None,kinds=None):
        self.db,self.clock=db,clock;self.q=Queue(db,clock);self.recon=Reconciliation(db,clock);self.ops=Operations(db,clock);self.factory=client_factory or self.client;self.clients={};self.kinds=set(kinds) if kinds else None
    def client(self,i):
        ref=i['credential_ref']
        if os.getenv(ref+'_FMC_VENUE_ID')!=i['venue_id'] or os.getenv(ref+'_TENANT_ID')!=i['tenant_id']:raise DomainError('CREDENTIAL_BINDING','Deployment credential binding does not match this club.',403)
        return Playtomic(os.getenv(ref+'_CLIENT_ID',''),os.getenv(ref+'_CLIENT_SECRET',''),i['tenant_id'])
    def step(self):
        job=self.q.claim(self.kinds)
        if not job:return False
        try:
            if int(self.clock())-job['created']>86400:raise DomainError('JOB_EXPIRED','Start a fresh export window after review.',409)
            payload=json.loads(job['payload']);req=payload['request'];who={'venue_id':job['venue_id'],'id':'system','role':'owner'}
            if job['kind']=='reconcile':result=self.recon.run(job['venue_id'],req['snapshot_id'],job['id'])
            else:
                with self.db.tx() as c:
                    i=self.db.lock(c,d.integrations,venue_id=job['venue_id'],provider='playtomic')
                    if not i:raise DomainError('PROVIDER_CONFIG','Integration not configured.',503)
                    if i['next_allowed']>int(self.clock()):raise Deferred('PROVIDER_RATE',i['next_allowed']-int(self.clock()))
                    c.execute(update(d.integrations).filter_by(venue_id=i['venue_id'],provider='playtomic').values(next_allowed=int(self.clock())+60))
                key=(i['venue_id'],i['credential_ref'],i['tenant_id'])
                if key not in self.clients:self.clients[key]=self.factory(i)
                client=self.clients[key]
                progress=payload['progress'];kind=job['kind'].removeprefix('sync_')
                page=client.page(kind,req['window_start'],req['window_end'],progress.get('cursor'),progress['page'])
                new_records=progress['records']+page['records']
                ids=[str(x['external_id']) for x in new_records]
                if len(ids)!=len(set(ids)):raise DomainError('PAGINATION_DRIFT','Duplicate source IDs across pages; restart snapshot after review.',502)
                if len(new_records)>5000 or progress['page']>=49:raise DomainError('SYNC_LIMIT','Narrow the export window or batch size.',413)
                if page['has_more']:
                    cursor=page['next_cursor'];seen=progress['seen_cursors']
                    if cursor and cursor in seen:raise DomainError('CURSOR_LOOP','Provider repeated a cursor.',502)
                    progress.update(records=new_records,page=progress['page']+1,cursor=cursor,seen_cursors=seen+([cursor] if cursor else []))
                    self.q.finish(job,delay=60,progress=payload);return True
                if kind=='bookings':
                    result=self.recon.ingest(who,'playtomic',{'window_start':req['window_start'],'window_end':req['window_end'],'observed_at':__import__('datetime').datetime.fromtimestamp(job['created'],__import__('datetime').timezone.utc).isoformat(),'complete':True,'source_ref':'authorized API job '+job['id'],'records':new_records})
                elif kind=='players':
                    out=io.StringIO();writer=csv.DictWriter(out,fieldnames=['external_id','name','email','phone','consent','consent_proof']);writer.writeheader();writer.writerows(new_records)
                    result=self.ops.stage_contacts(who,'playtomic',out.getvalue()) # staged, not auto-merged/marketed
                else:
                    with self.db.tx() as c:
                        self.db.lock(c,d.venues,id=who['venue_id'])
                        old=d.one(c,select(d.reports).where(d.reports.c.job_id==job['id']))
                        report=old['id'] if old else ident('report')
                        if not old:c.execute(insert(d.reports).values(id=report,venue_id=who['venue_id'],provider='playtomic',kind='payments',job_id=job['id'],data=canonical(new_records),complete=True,created=int(self.clock())))
                        result={'report_id':report,'rows':len(new_records),'status':'unlinked_payment_evidence','money_moved':False}
                with self.db.tx() as c:c.execute(update(d.integrations).filter_by(venue_id=i['venue_id'],provider='playtomic').values(last_success=int(self.clock()),last_error=None,status='synced'))
            self.q.finish(job,result=result)
        except Deferred as e:
            # 202 processing and rate deferral are not failed attempts; checkpoint stays.
            self.q.finish(job,delay=e.seconds,progress=json.loads(job['payload']))
        except DomainError as e:self.q.finish(job,error=e.code)
        except Exception:self.q.finish(job,error='INTERNAL_ERROR') # never log tokens, payloads or customer data
        return True

class Projector:
    """Idempotent internal event read model. Does not claim email delivery."""
    def __init__(self,db):self.db=db
    def step(self,limit=100):
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        with self.db.tx() as c:
            q=select(d.outbox).where(d.outbox.c.status=='pending').order_by(d.outbox.c.created,d.outbox.c.id).limit(min(100,limit))
            if self.db.postgres:q=q.with_for_update(skip_locked=True)
            pending=d.rows(c,q)
            make=pg_insert if self.db.postgres else sqlite_insert
            for out in pending:
                event=d.one(c,select(d.audit).where(d.audit.c.id==out['event_id']))
                c.execute(make(d.activity).values(event_id=event['id'],venue_id=event['venue_id'],topic=event['action'],entity_id=event['entity_id'],created=event['created']).on_conflict_do_nothing(index_elements=['event_id']))
                c.execute(update(d.outbox).where(d.outbox.c.id==out['id']).values(status='projected'))
            return len(pending)
