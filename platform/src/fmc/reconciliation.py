"""Evidence-based reconciliation: immutable snapshots, operational and monetary diffs.

Acknowledging a discrepancy is not reconciliation. Only fresh matching evidence
produces a matched result. No endpoint mutates a third-party booking or moves money.
"""
import json,time,csv,io,re
from sqlalchemy import select,insert,update,func
from . import db as d
from .common import DomainError,ident,digest,canonical,stamp,money
class Reconciliation:
    def __init__(self,db,clock=time.time):self.db,self.clock=db,clock
    def now(self):return int(self.clock())
    def ingest(self,who,provider,body):
        if not re.fullmatch(r'[a-z0-9_-]{1,40}',provider) or provider=='native':raise DomainError('PROVIDER','Invalid external provider.',422)
        if not all(k in body for k in ('window_start','window_end','observed_at','records')):raise DomainError('SOURCE_SCHEMA','Missing snapshot fields.',422)
        a,b,observed=stamp(body['window_start']),stamp(body['window_end']),stamp(body['observed_at'])
        if not 0<b-a<=365*86400 or observed>self.now()+300:raise DomainError('SNAPSHOT_WINDOW','Invalid observation window or future timestamp.',422)
        if not body.get('source_ref') or len(body['source_ref'])>2000:raise DomainError('SOURCE_REQUIRED','Include the source report/authorization reference.',422)
        if type(body.get('complete')) is not bool:raise DomainError('COMPLETENESS','Explicit snapshot completeness required.',422)
        raw=body['records']
        if not isinstance(raw,list) or len(raw)>5000:raise DomainError('SNAPSHOT_LIMIT','Maximum 5,000 records per snapshot.',413)
        result=[];seen=set()
        for r in raw:
            if not isinstance(r,dict) or not all(k in r for k in ('starts_at','ends_at')):raise DomainError('SOURCE_SCHEMA','Missing record fields.',422)
            ext=str(r.get('external_id',''));court=str(r.get('court_external_id',''))
            if not ext or len(ext)>120 or not court or len(court)>120 or ext in seen:raise DomainError('DUPLICATE_SOURCE','Invalid or duplicate booking identifier.',422)
            seen.add(ext);s,e=stamp(r['starts_at']),stamp(r['ends_at'])
            if e<=s or not a<=s<b:raise DomainError('SOURCE_WINDOW','Records must start inside the declared snapshot window.',422)
            status=r.get('status')
            if status not in ('confirmed','cancelled','completed','no_show','blocked'):raise DomainError('SOURCE_STATUS','Unrecognized source status; snapshot rejected.',422)
            out={'external_id':ext,'court_external_id':court,'starts_at':s,'ends_at':e,'status':status}
            for key in ('total_minor','paid_minor','refunded_minor'):
                if r.get(key) is not None:out[key]=money(r[key])
            if any(k in out for k in ('total_minor','paid_minor','refunded_minor')):
                currency=r.get('currency','')
                if currency not in ('EUR','GBP','USD','SEK','DKK','NOK','CHF','CZK','PLN'):raise DomainError('CURRENCY','Explicit supported currency is required for amounts.',422)
                out['currency']=currency
            result.append(out)
        result.sort(key=lambda x:x['external_id']);fp=digest(canonical([provider,a,b,observed,body['complete'],result]))
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=who['venue_id'])
            old=d.one(c,select(d.snapshots).filter_by(venue_id=who['venue_id'],provider=provider,fingerprint=fp))
            if old:return {'id':old['id'],'replayed':True}
            latest=c.execute(select(func.max(d.snapshots.c.observed_at)).where(d.snapshots.c.venue_id==who['venue_id'],d.snapshots.c.provider==provider)).scalar()
            if latest is not None and observed<latest:raise DomainError('STALE_SNAPSHOT','An older snapshot cannot replace newer evidence.',409)
            sid=ident('snapshot');c.execute(insert(d.snapshots).values(id=sid,venue_id=who['venue_id'],provider=provider,fingerprint=fp,observed_at=observed,window_start=a,window_end=b,complete=body['complete'],payload=canonical(result),source_ref=body['source_ref'],created=self.now()))
            self.db.emit(c,who['venue_id'],who['id'],'snapshot.ingested',sid,{'rows':len(result),'complete':body['complete']},self.now())
        return {'id':sid,'rows':len(result),'complete':body['complete']}
    def baseline(self,who,sid):
        """Explicit import into shadow calendar. Never enables native booking."""
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=who['venue_id']);s=d.one(c,select(d.snapshots).filter_by(id=sid,venue_id=who['venue_id']))
            if not s or not s['complete']:raise DomainError('BASELINE','A complete scoped snapshot is required.',409)
            source=json.loads(s['payload']);maps={r['external_id']:r['court_id'] for r in d.rows(c,select(d.mappings).filter_by(venue_id=who['venue_id'],provider=s['provider']))};n=0
            for r in source:
                cid=maps.get(r['court_external_id'])
                if not cid:raise DomainError('UNMAPPED_COURT','Map every source court before importing bookings.',409)
                ct=self.db.lock(c,d.courts,id=cid)
                if ct['authority']!='external' or ct['enabled']:raise DomainError('AUTHORITY','Baseline import only applies to shadow/external inventory.',409)
                old=d.one(c,select(d.bookings).filter_by(venue_id=who['venue_id'],provider=s['provider'],external_id=r['external_id']))
                if old:
                    if any(old[k]!=r[k] for k in ('starts_at','ends_at','status')):raise DomainError('BASELINE_EXISTS','Existing mirror differs; reconcile instead of overwriting.',409)
                    continue
                if r['status'] in ('confirmed','blocked'):
                    conflict=d.one(c,select(d.bookings.c.id).where(d.bookings.c.court_id==cid,d.bookings.c.starts_at<r['ends_at'],d.bookings.c.ends_at>r['starts_at'],d.bookings.c.status.in_(['confirmed','held','blocked'])).limit(1))
                    if conflict:raise DomainError('IMPORT_OVERLAP','Source bookings overlap existing inventory. Nothing imported.',409)
                bid=ident('booking');c.execute(insert(d.bookings).values(id=bid,venue_id=who['venue_id'],court_id=cid,player_id=None,starts_at=r['starts_at'],ends_at=r['ends_at'],status=r['status'],total_minor=r.get('total_minor',0),amount_known='total_minor' in r,currency=r.get('currency',ct['currency']),paid_minor=r.get('paid_minor',0),refunded_minor=r.get('refunded_minor',0),payment_known='paid_minor' in r,policy=ct['rules'],provider=s['provider'],external_id=r['external_id'],created=self.now()));n+=1
            self.db.emit(c,who['venue_id'],who['id'],'migration.baseline_imported',sid,{'imported':n},self.now())
            return {'imported':n,'native_booking_enabled':False}
    def run(self,venue,sid,run_key):
        rid='run_'+digest(run_key)[:32]
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=venue)
            old=d.one(c,select(d.recon_runs).filter_by(id=rid,venue_id=venue))
            if old:return {'id':rid,'replayed':True}
            s=d.one(c,select(d.snapshots).filter_by(id=sid,venue_id=venue))
            if not s:raise DomainError('NOT_FOUND','Snapshot not found.',404)
            latest=c.execute(select(func.max(d.snapshots.c.observed_at)).where(d.snapshots.c.venue_id==venue,d.snapshots.c.provider==s['provider'])).scalar()
            if s['observed_at']<latest:raise DomainError('STALE_SNAPSHOT','Use the latest provider snapshot.',409)
            source={r['external_id']:r for r in json.loads(s['payload'])}
            expected={r['external_id']:r for r in d.rows(c,select(d.bookings).where(d.bookings.c.venue_id==venue,d.bookings.c.provider==s['provider'],d.bookings.c.starts_at>=s['window_start'],d.bookings.c.starts_at<s['window_end']).limit(10001))}
            if len(expected)>10000:raise DomainError('RECON_LIMIT','Split reconciliation into smaller date windows.',413)
            maps={r['external_id']:r['court_id'] for r in d.rows(c,select(d.mappings).filter_by(venue_id=venue,provider=s['provider']))}
            found=[]
            def issue(ext,category,severity,left,right,bid=None):found.append(dict(id=ident('issue'),run_id=rid,venue_id=venue,external_id=ext,booking_id=bid,category=category,severity=severity,status='open',expected=canonical(left),observed=canonical(right),version=1,note=''))
            if not s['complete']:issue(None,'partial_snapshot','warning','complete snapshot','partial; missing records are not inferred')
            if self.now()-s['observed_at']>900:issue(None,'stale_evidence','warning','snapshot younger than 15 minutes',s['observed_at'])
            checked=0
            for ext,r in source.items():
                b=expected.get(ext);cid=maps.get(r['court_external_id'])
                if not cid:issue(ext,'unmapped_court','critical','mapped native identifier',r['court_external_id'])
                if not b:issue(ext,'missing_local','critical' if r['status']=='confirmed' else 'warning',None,r);continue
                checked+=1
                for field in ('starts_at','ends_at','status'):
                    if b[field]!=r[field]:issue(ext,'status_mismatch' if field=='status' else 'time_mismatch','critical',{field:b[field]},{field:r[field]},b['id'])
                if cid and b['court_id']!=cid:issue(ext,'court_mismatch','critical',b['court_id'],cid,b['id'])
                for field in ('total_minor','paid_minor','refunded_minor','currency'):
                    if field not in r:continue
                    known=b['amount_known'] if field=='total_minor' else b['payment_known'] if field in ('paid_minor','refunded_minor') else True
                    if not known:issue(ext,'missing_financial_evidence','warning',{field:'unknown'},{field:r[field]},b['id'])
                    elif b[field]!=r[field]:issue(ext,'financial_mismatch','critical',{field:b[field]},{field:r[field]},b['id'])
            if s['complete']:
                for ext,b in expected.items():
                    if ext not in source and b['status'] in ('confirmed','blocked'):issue(ext,'missing_provider','critical',b,None,b['id'])
            # Detect overlapping provider records without an O(n^2) comparison.
            group={}
            for r in source.values():
                if r['status'] in ('confirmed','blocked'):group.setdefault(r['court_external_id'],[]).append(r)
            for ct,rs in group.items():
                previous=None
                for r in sorted(rs,key=lambda x:x['starts_at']):
                    if previous and previous['ends_at']>r['starts_at']:issue(r['external_id'],'source_overlap','critical',previous,r)
                    if previous is None or r['ends_at']>previous['ends_at']:previous=r
            summary={'source_records':len(source),'local_records':len(expected),'compared':checked,'issues':len(found),'critical':sum(x['severity']=='critical' for x in found),'complete':s['complete'],'observed_at':s['observed_at'],'payments_scope':'Compare reported booking amounts; settlement reconciliation is separate.'}
            c.execute(insert(d.recon_runs).values(id=rid,venue_id=venue,snapshot_id=sid,status='matched' if not found else 'review',summary=canonical(summary),created=self.now()))
            if found:c.execute(insert(d.issues),found)
            self.db.emit(c,venue,'system','reconciliation.completed',rid,summary,self.now())
            return {'id':rid,'summary':summary}
    def runs(self,venue):
        with self.db.read() as c:rs=d.rows(c,select(d.recon_runs).where(d.recon_runs.c.venue_id==venue).order_by(d.recon_runs.c.created.desc(),d.recon_runs.c.id.desc()).limit(30))
        for r in rs:r['summary']=json.loads(r['summary'])
        return rs
    def issues(self,venue,run=None,after='',limit=100):
        q=select(d.issues).where(d.issues.c.venue_id==venue,d.issues.c.id>after)
        if run:q=q.where(d.issues.c.run_id==run)
        with self.db.read() as c:rs=d.rows(c,q.order_by(d.issues.c.id).limit(min(100,limit)+1))
        more=len(rs)>limit;rs=rs[:limit]
        for r in rs:r['expected']=json.loads(r['expected']);r['observed']=json.loads(r['observed'])
        return {'items':rs,'next_cursor':rs[-1]['id'] if more else None}
    def review(self,who,iid,version,action,note,assignee=None):
        if len(note.strip())<5:raise DomainError('NOTE','A meaningful review note is required.',422)
        with self.db.tx() as c:
            r=self.db.lock(c,d.issues,id=iid,venue_id=who['venue_id'])
            if not r:raise DomainError('NOT_FOUND','Issue not found.',404)
            if r['version']!=version:raise DomainError('VERSION','Another user updated this issue; reload it.',409)
            values={'version':version+1,'note':note[:2000]}
            if action=='acknowledge':values['status']='acknowledged'
            elif action=='assign':
                member=d.one(c,select(d.members).filter_by(organisation_id=who['organisation_id'],player_id=assignee))
                if not member:raise DomainError('ASSIGNEE','Assignee must be in this organisation.',422)
                values['assigned_to']=assignee
            elif action=='propose_accept':values.update(status='approval_pending',proposed_by=who['id'],approved_by=None)
            elif action=='approve':
                if r['status']!='approval_pending' or r['proposed_by']==who['id'] or who['role'] not in ('owner','accountant'):raise DomainError('FOUR_EYES','A different owner/accountant must approve.',403)
                values.update(status='accepted_with_exception',approved_by=who['id'])
            else:raise DomainError('ACTION','Unsupported review action.',422)
            c.execute(update(d.issues).where(d.issues.c.id==iid,d.issues.c.version==version).values(**values))
            self.db.emit(c,who['venue_id'],who['id'],'reconciliation.'+action,iid,{'before_status':r['status'],'after':values},self.now())
            # Never sets status=matched, modifies a booking, or initiates a refund.
            return {'id':iid,**values,'source_changed':False,'money_moved':False}
    def sync_issue(self,who,iid,version,approve,note):
        """Two-person repair of a shadow mirror using immutable provider evidence.

        Never change a native-authority booking. Never rewrite source snapshots,
        audit records or original runs. A fresh run proves whether repair matched.
        """
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=who['venue_id']);i=self.db.lock(c,d.issues,id=iid,venue_id=who['venue_id'])
            if not i:raise DomainError('NOT_FOUND','Issue not found.',404)
            if i['version']!=version:raise DomainError('VERSION_CONFLICT','Issue was changed. Reload before acting.',409)
            run=d.one(c,select(d.recon_runs).filter_by(id=i['run_id'],venue_id=who['venue_id']))
            src=d.one(c,select(d.snapshots).filter_by(id=run['snapshot_id']))
            latest=c.execute(select(func.max(d.snapshots.c.observed_at)).where(d.snapshots.c.venue_id==who['venue_id'],d.snapshots.c.provider==src['provider'])).scalar()
            if not src['complete'] or src['observed_at']!=latest or self.now()-src['observed_at']>900:raise DomainError('FRESH_EVIDENCE','Use a new complete provider snapshot and reconciliation run.',409)
            row=next((x for x in json.loads(src['payload']) if x['external_id']==i['external_id']),None)
            if not row or not i['booking_id']:raise DomainError('MANUAL_REVIEW','This issue cannot be repaired automatically; obtain explicit source records or baseline import.',409)
            b=d.one(c,select(d.bookings).filter_by(id=i['booking_id'],venue_id=who['venue_id'],provider=src['provider']))
            mapped=d.one(c,select(d.mappings).filter_by(venue_id=who['venue_id'],provider=src['provider'],external_id=row['court_external_id']))
            if not b or not mapped:raise DomainError('MAPPING','Booking and court mapping required.',409)
            for cid in sorted(set([b['court_id'],mapped['court_id']])):
                ct=self.db.lock(c,d.courts,id=cid,venue_id=who['venue_id'])
                if not ct or ct['authority']!='external':raise DomainError('NATIVE_AUTHORITY','Provider evidence cannot overwrite native inventory.',409)
            values={'version':version+1,'note':note}
            if not approve:
                if i['status'] not in ('open','acknowledged'):raise DomainError('REVIEW_STATE','Issue is not open for a source repair.',409)
                values.update(status='sync_proposed',proposed_by=who['id'])
            else:
                if who['role'] not in ('owner','accountant') or i['status']!='sync_proposed' or i['proposed_by']==who['id']:raise DomainError('FOUR_EYES','A different owner or accountant must approve the source repair.',403)
                if row['status'] in ('confirmed','blocked'):
                    collision=d.one(c,select(d.bookings.c.id).where(d.bookings.c.id!=b['id'],d.bookings.c.court_id==mapped['court_id'],d.bookings.c.starts_at<row['ends_at'],d.bookings.c.ends_at>row['starts_at'],d.bookings.c.status.in_(['held','confirmed','blocked'])).limit(1))
                    if collision:raise DomainError('IMPORT_OVERLAP','Source repair conflicts with another booking.',409)
                patch={k:row[k] for k in ('starts_at','ends_at','status','total_minor','paid_minor','refunded_minor','currency') if k in row}
                patch.update(court_id=mapped['court_id'],version=b['version']+1)
                if 'total_minor' in row:patch['amount_known']=True
                if 'paid_minor' in row:patch['payment_known']=True
                c.execute(update(d.bookings).where(d.bookings.c.id==b['id']).values(**patch))
                values.update(status='source_applied',approved_by=who['id'])
                self.db.emit(c,who['venue_id'],who['id'],'reconciliation.mirror_repaired',b['id'],{'snapshot_id':src['id'],'issue_id':iid,'before':{k:b[k] for k in patch},'after':patch,'external_writes':False},self.now())
            c.execute(update(d.issues).where(d.issues.c.id==iid).values(**values))
            self.db.emit(c,who['venue_id'],who['id'],'reconciliation.source_review',iid,{'status':values['status'],'note':note},self.now())
            return {'id':iid,'status':values['status'],'version':version+1,'rerun_required':True,'external_writes':False}
    def record_money(self,who,b):
        if b['kind'] not in ('capture','refund','fee','payout_expected','bank_credit'):raise DomainError('MONEY_TYPE','Unsupported observation type.',422)
        money(b['amount_minor'])
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=who['venue_id'])
            if b.get('booking_id') and not d.one(c,select(d.bookings.c.id).filter_by(id=b['booking_id'],venue_id=who['venue_id'])):raise DomainError('SCOPE','Booking is not in this club.',403)
            old=d.one(c,select(d.ledger).filter_by(venue_id=who['venue_id'],source=b['source'],external_id=b['external_id']))
            if old:
                if any(old[k]!=b.get(k) for k in ('amount_minor','currency','kind','booking_id','batch_ref','evidence_ref')):raise DomainError('EVENT_CONFLICT','Existing financial observation differs; use a correction event.',409)
                return {'id':old['id'],'replayed':True}
            eid=ident('money');c.execute(insert(d.ledger).values(id=eid,venue_id=who['venue_id'],actor=who['id'],created=self.now(),**b));self.db.emit(c,who['venue_id'],who['id'],'money.observed',eid,{'kind':b['kind'],'amount_minor':b['amount_minor'],'currency':b['currency']},self.now())
            return {'id':eid,'money_moved':False}
    def settlement(self,venue,batch):
        with self.db.read() as c:
            rs=d.rows(c,select(d.ledger.c.currency,d.ledger.c.kind,func.sum(d.ledger.c.amount_minor).label('amount')).where(d.ledger.c.venue_id==venue,d.ledger.c.batch_ref==batch).group_by(d.ledger.c.currency,d.ledger.c.kind))
        totals={}
        for r in rs:totals.setdefault(r['currency'],{})[r['kind']]=r['amount']
        output=[]
        for currency,x in totals.items():
            computed=x.get('capture',0)-x.get('refund',0)-x.get('fee',0);expected=x.get('payout_expected');bank=x.get('bank_credit')
            output.append({'currency':currency,'capture_minor':x.get('capture',0),'refund_minor':x.get('refund',0),'fee_minor':x.get('fee',0),'computed_net_minor':computed,'payout_expected_minor':expected,'bank_credit_minor':bank,'settlement_delta_minor':None if expected is None else computed-expected,'bank_delta_minor':None if expected is None or bank is None else bank-expected,'status':'missing_evidence' if expected is None or bank is None else 'matched' if computed==expected==bank else 'review'})
        return {'batch_ref':batch,'currencies':output,'source':'recorded observations, not live bank connectivity'}
    def csv(self,venue,run):
        # Formula-safe export; no cross-tenant resource identifiers are resolved.
        out=io.StringIO();w=csv.writer(out);w.writerow(['issue_id','category','severity','review_status','expected','observed','note'])
        cursor=''
        while True:
            result=self.issues(venue,run,cursor)
            for r in result['items']:
                vals=[r['id'],r['category'],r['severity'],r['status'],canonical(r['expected']),canonical(r['observed']),r['note']]
                w.writerow(["'"+v if v.lstrip().startswith(('=','+','-','@','\t','\r')) else v for v in vals])
            cursor=result['next_cursor']
            if not cursor:break
        return out.getvalue()
