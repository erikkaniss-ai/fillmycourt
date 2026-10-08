"""Club migration, indexed contacts and inventory administration.

Imports are staged and atomic, provenance is retained, and imported contacts are
NOT login accounts. Neither a CSV nor an API connection enables public booking.
"""
import csv,io,json,math,re,time
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from sqlalchemy import select,insert,update,delete,func,and_,or_
from . import db as d
from .common import DomainError,ident,digest,canonical,stamp,money,SPORTS
from .booking import Booking
class Operations:
    def __init__(self,db,clock=time.time):self.db,self.clock=db,clock;self.booking=Booking(db,clock)
    def now(self):return int(self.clock())
    def audit(self,c,who,event,eid,data=None):self.db.emit(c,who['venue_id'],who['id'],event,eid,data,self.now())
    def create_club(self,user,body):
        data={k:body[k] for k in ('city','lat','lon','indoor','timezone')};data.update(admin_verified=False,amenities=[])
        try:ZoneInfo(data['timezone'])
        except ZoneInfoNotFoundError:raise DomainError('TIMEZONE','Unknown timezone.',422)
        org,vid=ident('org'),ident('venue')
        with self.db.tx() as c:
            self.db.lock(c,d.players,id=user['id'])
            n=c.execute(select(func.count()).select_from(d.members).where(d.members.c.player_id==user['id'],d.members.c.role=='owner')).scalar_one()
            if n>=10:raise DomainError('CLUB_LIMIT','Contact support for additional organisations.',409)
            c.execute(insert(d.organisations).values(id=org,name=body['organisation'],created=self.now()))
            c.execute(insert(d.members).values(organisation_id=org,player_id=user['id'],role='owner'))
            c.execute(insert(d.venues).values(id=vid,organisation_id=org,name=body['name'],latitude=data['lat'],longitude=data['lon'],data=canonical(data),created=self.now()))
            self.db.emit(c,vid,user['id'],'club.created',vid,{'public_booking':False},self.now())
        return {'id':vid,'organisation_id':org,'name':body['name'],'status':'draft'}
    def add_court(self,who,b):
        try:ZoneInfo(b['timezone'])
        except ZoneInfoNotFoundError:raise DomainError('TIMEZONE','Unknown timezone.',422)
        if b['sport'] not in SPORTS:raise DomainError('SPORT','Unsupported sport.',422)
        r=b['rules']
        if not (0<=r['opening_minute']<r['closing_minute']<=1440 and r['step_minutes'] in (15,30,60) and 1<=r['booking_days']<=365 and 0<=r['cancellation_hours']<=168):raise DomainError('RULES','Invalid booking rules.',422)
        if not r['durations'] or any(type(x) is not int or x not in (30,45,60,90,120) for x in r['durations']):raise DomainError('DURATION','Invalid durations.',422)
        cid=ident('court')
        with self.db.tx() as c:
            c.execute(insert(d.courts).values(id=cid,venue_id=who['venue_id'],name=b['name'],sport=b['sport'],hourly_minor=money(b['hourly_minor']),currency=b['currency'],timezone=b['timezone'],rules=canonical(r),authority='external',enabled=False,authorization_ref=''))
            self.audit(c,who,'court.created',cid)
        return {'id':cid,'enabled':False,'authority':'external'}
    def map_court(self,who,provider,external,cid):
        with self.db.tx() as c:
            ct=d.one(c,select(d.courts).filter_by(id=cid,venue_id=who['venue_id']))
            if not ct:raise DomainError('SCOPE','The mapped court belongs to another club or does not exist.',403)
            self.db.lock(c,d.venues,id=who['venue_id'])
            old=d.one(c,select(d.mappings).filter_by(venue_id=who['venue_id'],provider=provider,external_id=external))
            if old and old['court_id']!=cid:raise DomainError('MAPPING_CONFLICT','An existing mapping cannot be silently reassigned.',409)
            if not old:c.execute(insert(d.mappings).values(venue_id=who['venue_id'],provider=provider,external_id=external,court_id=cid))
            self.audit(c,who,'court.mapped',cid,{'provider':provider,'external_id':external})
        return {'ok':True}
    def contacts(self,who,q='',after='',limit=50):
        limit=min(100,max(1,limit));prefix=q.strip().casefold()
        if len(prefix)>100:raise DomainError('QUERY','Search is too long.',422)
        # Prefix is escaped, not executable SQL; tenant is mandatory in every query.
        escaped=prefix.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
        query=select(d.contacts).where(d.contacts.c.venue_id==who['venue_id'],d.contacts.c.id>after)
        if prefix:query=query.where(or_(d.contacts.c.name_key.like(escaped+'%',escape='\\'),d.contacts.c.email.like(escaped+'%',escape='\\')))
        with self.db.read() as c:rs=d.rows(c,query.order_by(d.contacts.c.id).limit(limit+1))
        return {'items':rs[:limit],'next_cursor':rs[limit-1]['id'] if len(rs)>limit else None}
    def stage_contacts(self,who,source,content):
        if len(content.encode())>2_000_000:raise DomainError('IMPORT_LIMIT','Maximum CSV size is 2 MB.',413)
        try:
            reader=csv.DictReader(io.StringIO(content.lstrip('\ufeff')))
            required={'external_id','name'}
            if not required.issubset(reader.fieldnames or []):raise DomainError('CSV_HEADERS','Required headers: external_id,name. Optional: email,phone,consent,consent_proof.',422)
            if len(reader.fieldnames)!=len(set(reader.fieldnames)):raise DomainError('CSV_HEADERS','Duplicate column names.',422)
            source_rows=[]
            for i,row in enumerate(reader):
                if i>=5000:raise DomainError('IMPORT_LIMIT','Use batches of at most 5,000 rows.',413)
                source_rows.append(row)
        except csv.Error:raise DomainError('CSV','Malformed CSV.',422) from None
        payload=[];errors=[];seen=set();emails=set()
        for number,r in enumerate(source_rows,2):
            ext=(r.get('external_id') or '').strip();name=(r.get('name') or '').strip();email=(r.get('email') or '').strip().casefold();phone=(r.get('phone') or '').strip();consent=(r.get('consent') or 'unknown').strip().lower();proof=(r.get('consent_proof') or '').strip()
            reasons=[]
            if not ext or len(ext)>120:reasons.append('external_id required, max 120 characters')
            if not name or len(name)>200:reasons.append('name required, max 200 characters')
            if email and (not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) or len(email)>320):reasons.append('invalid email')
            if len(phone)>40:reasons.append('phone too long')
            if consent not in ('unknown','granted','withdrawn'):reasons.append('invalid consent status')
            if consent=='granted' and not proof:reasons.append('consent evidence is required')
            if len(proof)>2000:reasons.append('consent evidence too long')
            if ext in seen:reasons.append('duplicate source id')
            if email and email in emails:reasons.append('duplicate email requires review; accounts are not auto-merged')
            seen.add(ext)
            if email:emails.add(email)
            if reasons:errors.append({'row':number,'errors':reasons})
            payload.append({'external_id':ext,'name':name,'name_key':name.casefold(),'email':email,'phone':phone,'consent':consent,'consent_proof':proof})
        if not payload:errors.append({'row':1,'errors':['empty import']})
        fp=digest(canonical(payload))
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=who['venue_id'])
            prior=d.one(c,select(d.imports).filter_by(venue_id=who['venue_id'],source=source,kind='contacts',fingerprint=fp))
            if prior:return self.batch(prior)
            bid=ident('import');b=dict(id=bid,venue_id=who['venue_id'],source=source,kind='contacts',fingerprint=fp,payload=canonical(payload),errors=canonical(errors),status='invalid' if errors else 'staged',actor=who['id'],created=self.now())
            c.execute(insert(d.imports).values(**b));self.audit(c,who,'import.staged',bid,{'rows':len(payload),'errors':len(errors)})
            return self.batch(b)
    @staticmethod
    def batch(b):
        return {**{k:v for k,v in b.items() if k not in ('payload','errors')},'row_count':len(json.loads(b['payload'])),'errors':json.loads(b['errors'])}
    def import_list(self,who):
        with self.db.read() as c:return [self.batch(b) for b in d.rows(c,select(d.imports).where(d.imports.c.venue_id==who['venue_id']).order_by(d.imports.c.created.desc()).limit(100))]
    def commit_contacts(self,who,bid):
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=who['venue_id']);b=self.db.lock(c,d.imports,id=bid,venue_id=who['venue_id'])
            if not b:raise DomainError('NOT_FOUND','Import not found.',404)
            if b['status']=='committed':return {'id':bid,'status':'committed','replayed':True}
            if b['status']!='staged':raise DomainError('IMPORT_STATE','Only a valid staged import can be committed.',409)
            n=0
            for r in json.loads(b['payload']):
                old=d.one(c,select(d.contacts).filter_by(venue_id=who['venue_id'],source=b['source'],external_id=r['external_id']))
                if old:
                    if any(old[k]!=r[k] for k in r):raise DomainError('IMPORT_CONFLICT','Existing contact differs. No changes committed; review the source.',409)
                    continue
                if r['email'] and d.one(c,select(d.contacts.c.id).where(d.contacts.c.venue_id==who['venue_id'],d.contacts.c.email==r['email'])):raise DomainError('DUPLICATE_CONTACT','Email matches another contact. Review before merging.',409)
                cid='contact_'+digest(bid+':'+r['external_id'])[:32]
                c.execute(insert(d.contacts).values(id=cid,venue_id=who['venue_id'],source=b['source'],updated=self.now(),**r));n+=1
            c.execute(update(d.imports).where(d.imports.c.id==bid).values(status='committed'));self.audit(c,who,'import.committed',bid,{'inserted':n})
            return {'id':bid,'status':'committed','inserted':n}
    def rollback_contacts(self,who,bid):
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=who['venue_id']);b=self.db.lock(c,d.imports,id=bid,venue_id=who['venue_id'])
            if not b or b['status']!='committed':raise DomainError('IMPORT_STATE','Import is not committed.',409)
            removed=0
            for source in json.loads(b['payload']):
                cid='contact_'+digest(bid+':'+source['external_id'])[:32];r=d.one(c,select(d.contacts).filter_by(id=cid,venue_id=who['venue_id']))
                if not r:continue # existing contact skipped by commit, not owned by this batch
                if any(r[k]!=source[k] for k in source) or d.one(c,select(d.bookings.c.id).where(d.bookings.c.contact_id==cid).limit(1)):raise DomainError('ROLLBACK_CONFLICT','A contact changed or is referenced; manual review required.',409)
                c.execute(delete(d.contacts).where(d.contacts.c.id==cid,d.contacts.c.venue_id==who['venue_id']));removed+=1
            c.execute(update(d.imports).where(d.imports.c.id==bid).values(status='rolled_back'));self.audit(c,who,'import.rolled_back',bid,{'removed':removed})
            return {'removed':removed}
    def calendar(self,who,date):
        with self.db.read() as c:
            v=d.one(c,select(d.venues).where(d.venues.c.id==who['venue_id']));tz=ZoneInfo(json.loads(v['data'])['timezone'])
            try:dt=datetime.strptime(date,'%Y-%m-%d').replace(tzinfo=tz)
            except ValueError:raise DomainError('DATE','Invalid calendar date.',422)
            cs=d.rows(c,select(d.courts).where(d.courts.c.venue_id==who['venue_id']))
            rs=d.rows(c,select(d.bookings).where(d.bookings.c.venue_id==who['venue_id'],d.bookings.c.starts_at<int((dt+timedelta(days=1)).timestamp()),d.bookings.c.ends_at>int(dt.timestamp()),d.bookings.c.status.in_(['held','confirmed','blocked'])).order_by(d.bookings.c.starts_at).limit(2000))
            return {'courts':cs,'reservations':[self.booking.serialize(c,r) for r in rs],'timezone':str(tz)}
    def block(self,who,cid,date,at,duration,key):
        from .common import require_key
        require_key(key)
        with self.db.tx() as c:
            self.db.lock(c,d.players,id=who['id']);ct=self.booking.court(c,cid,write=True)
            if ct['venue_id']!=who['venue_id']:raise DomainError('SCOPE','Court outside club.',403)
            prior=self.booking.prior(c,who['id'],'block',key,[cid,date,at,duration])
            if prior:return prior
            self.booking.expire(c,cid);s,e=self.booking.interval(ct,date,at,duration)
            if self.booking.conflict(c,cid,s,e):raise DomainError('CONFLICT','An existing booking or hold occupies this time.',409)
            bid=ident('block');c.execute(insert(d.bookings).values(id=bid,venue_id=who['venue_id'],court_id=cid,player_id=who['id'],starts_at=s,ends_at=e,status='blocked',total_minor=0,currency=ct['currency'],policy=canonical(ct['rules']),created=self.now()))
            self.booking.remember(c,who['id'],'block',key,[cid,date,at,duration],bid);self.audit(c,who,'inventory.blocked',bid)
            return {'id':bid,'status':'blocked'}
    def unblock(self,who,bid):
        with self.db.tx() as c:
            r=d.one(c,select(d.bookings).filter_by(id=bid,venue_id=who['venue_id']))
            if not r:raise DomainError('NOT_FOUND','Block not found.',404)
            self.booking.court(c,r['court_id'],write=True,require_enabled=False)
            if r['status'] not in ('blocked','cancelled'):raise DomainError('STATE','This endpoint only releases maintenance blocks.',409)
            c.execute(update(d.bookings).where(d.bookings.c.id==bid).values(status='cancelled',version=d.bookings.c.version+1));self.audit(c,who,'inventory.unblocked',bid)
        return {'ok':True}
    def migration_gates(self,who):
        with self.db.read() as c:
            v=d.one(c,select(d.venues).where(d.venues.c.id==who['venue_id']));cs=d.rows(c,select(d.courts).filter_by(venue_id=who['venue_id']))
            invalid=c.execute(select(func.count()).select_from(d.imports).where(d.imports.c.venue_id==who['venue_id'],d.imports.c.status=='invalid')).scalar_one()
            return {'venue_verified':bool(json.loads(v['data']).get('admin_verified')),'courts':len(cs),'native_courts':sum(bool(r['enabled']) and r['authority']=='native' for r in cs),'imports_requiring_review':invalid,'requirements':['Verified club authority','Backup evidence','Old writer disabled or segregated inventory','Fresh matched reconciliation for every external source','Explicit owner activation per court'],'public_booking_automatically_enabled':False}
    def activate(self,who,cid,b):
        if who['role']!='owner':raise DomainError('ROLE','Only a club owner can approve cutover.',403)
        if b.get('confirmation')!='I CONFIRM SINGLE BOOKING AUTHORITY' or not b.get('backup_ref') or not b.get('legacy_disabled_ref'):raise DomainError('CUTOVER_ATTESTATION','Backup and single-writer evidence are required.',422)
        with self.db.tx() as c:
            self.db.lock(c,d.venues,id=who['venue_id']);v=d.one(c,select(d.venues).where(d.venues.c.id==who['venue_id']))
            if not json.loads(v['data']).get('admin_verified'):raise DomainError('CLUB_VERIFICATION','Club authority must be verified before activation.',409)
            ct=self.db.lock(c,d.courts,id=cid,venue_id=who['venue_id'])
            if not ct:raise DomainError('NOT_FOUND','Court not found.',404)
            sources=c.execute(select(d.bookings.c.provider).where(d.bookings.c.court_id==cid,d.bookings.c.provider!='native').distinct()).scalars().all()
            mapped=c.execute(select(d.mappings.c.provider).where(d.mappings.c.court_id==cid,d.mappings.c.venue_id==who['venue_id']).distinct()).scalars().all()
            for provider in set(sources)|set(mapped):
                runid=b.get('recon_run_ids',{}).get(provider)
                run=d.one(c,select(d.recon_runs).filter_by(id=runid,venue_id=who['venue_id']))
                if not run or run['status']!='matched':raise DomainError('RECON_GATE','A matched reconciliation is required for each source.',409)
                snap=d.one(c,select(d.snapshots).filter_by(id=run['snapshot_id'],venue_id=who['venue_id'],provider=provider))
                if not snap or not snap['complete'] or self.now()-snap['observed_at']>900:raise DomainError('FRESHNESS','Refresh complete provider evidence before cutover.',409)
                latest=c.execute(select(func.max(d.snapshots.c.observed_at)).where(d.snapshots.c.venue_id==who['venue_id'],d.snapshots.c.provider==provider)).scalar()
                if latest!=snap['observed_at']:raise DomainError('FRESHNESS','Reconcile the latest snapshot.',409)
                end_needed=self.now()+json.loads(ct['rules'])['booking_days']*86400
                if snap['window_start']>self.now() or snap['window_end']<end_needed:raise DomainError('COVERAGE','Snapshot must cover the entire future booking window.',409)
            if c.execute(select(func.count()).select_from(d.bookings).where(d.bookings.c.court_id==cid,d.bookings.c.starts_at>self.now(),d.bookings.c.amount_known==False)).scalar_one():raise DomainError('UNKNOWN_PRICES','Resolve unknown future booking prices before cutover.',409)
            c.execute(update(d.courts).where(d.courts.c.id==cid).values(authority='native',enabled=True,authorization_ref=b['legacy_disabled_ref']))
            self.audit(c,who,'migration.court_activated',cid,{'backup_ref':b['backup_ref'],'old_writer_attestation':b['legacy_disabled_ref'],'recon_runs':b.get('recon_run_ids',{})})
        return {'court_id':cid,'authority':'native','enabled':True}
    def pause(self,who,cid,note):
        with self.db.tx() as c:
            ct=self.db.lock(c,d.courts,id=cid,venue_id=who['venue_id'])
            if not ct:raise DomainError('NOT_FOUND','Court not found.',404)
            c.execute(update(d.courts).where(d.courts.c.id==cid).values(enabled=False));self.audit(c,who,'inventory.paused',cid,{'reason':note})
        return {'enabled':False,'existing_bookings_preserved':True}
    def update_court(self,who,cid,body):
        """Prospective tariffs only; confirmed reservations retain their quote/policy."""
        r=body['rules']
        if not (0<=r['opening_minute']<r['closing_minute']<=1440 and r['step_minutes'] in (15,30,60) and 1<=r['booking_days']<=365 and 0<=r['cancellation_hours']<=168):raise DomainError('RULES','Invalid booking rules.',422)
        if not r['durations'] or any(x not in (30,45,60,90,120) for x in r['durations']):raise DomainError('RULES','Unsupported duration.',422)
        with self.db.tx() as c:
            ct=self.db.lock(c,d.courts,id=cid,venue_id=who['venue_id'])
            if not ct:raise DomainError('NOT_FOUND','Court not found.',404)
            if r['policy_version']==json.loads(ct['rules'])['policy_version'] and r!=json.loads(ct['rules']):raise DomainError('POLICY_VERSION','Use a new policy version when rules change.',409)
            c.execute(update(d.courts).where(d.courts.c.id==cid).values(hourly_minor=money(body['hourly_minor']),rules=canonical(r)))
            self.audit(c,who,'court.rules_changed',cid,{'old_hourly_minor':ct['hourly_minor'],'hourly_minor':body['hourly_minor'],'policy_version':r['policy_version']})
        return {'ok':True,'existing_booking_quotes_unchanged':True}
    def reserve_for_contact(self,who,b,key):
        from .common import require_key
        require_key(key)
        with self.db.tx() as c:
            self.db.lock(c,d.players,id=who['id']);ct=self.booking.court(c,b['court_id'],write=True)
            if ct['venue_id']!=who['venue_id']:raise DomainError('SCOPE','Court outside club.',403)
            contact=d.one(c,select(d.contacts).filter_by(id=b['contact_id'],venue_id=who['venue_id']))
            if not contact:raise DomainError('SCOPE','Select a customer from this club.',403)
            prior=self.booking.prior(c,who['id'],'staff_booking',key,b)
            if prior:return prior
            self.booking.expire(c,ct['id']);s,e=self.booking.interval(ct,b['date'],b['time'],b['duration'])
            if self.booking.conflict(c,ct['id'],s,e):raise DomainError('SLOT_UNAVAILABLE','The court is already held or booked.',409)
            if b.get('accept_policy') is not True:raise DomainError('POLICY_REQUIRED','Confirm the customer accepted the booking terms.',422)
            participants=b.get('participants',1)
            if not 1<=participants<=(2 if ct['sport'] in ('squash','badminton') else 4):raise DomainError('PARTICIPANTS','Invalid participant count.',422)
            bid=ident('booking');c.execute(insert(d.bookings).values(id=bid,venue_id=who['venue_id'],court_id=ct['id'],player_id=None,contact_id=contact['id'],starts_at=s,ends_at=e,status='confirmed',total_minor=self.booking.price(ct,s,e),currency=ct['currency'],participants=participants,policy=canonical(ct['rules']),provider='native',created=self.now()))
            self.booking.remember(c,who['id'],'staff_booking',key,b,bid);self.audit(c,who,'booking.staff_created',bid,{'contact_id':contact['id'],'payment':'unpaid'})
            return self.booking.serialize(c,d.one(c,select(d.bookings).filter_by(id=bid)))
    def cancel_booking(self,who,bid,note):
        with self.db.tx() as c:
            r=d.one(c,select(d.bookings).filter_by(id=bid,venue_id=who['venue_id']))
            if not r:raise DomainError('NOT_FOUND','Booking not found.',404)
            ct=self.booking.court(c,r['court_id'],write=True,require_enabled=False)
            if ct['authority']!='native':raise DomainError('EXTERNAL_AUTHORITY','Cancel in the authoritative provider, then reconcile.',409)
            r=d.one(c,select(d.bookings).filter_by(id=bid))
            if r['status']=='cancelled':return {'id':bid,'status':'cancelled','replayed':True}
            if r['status'] not in ('held','confirmed'):raise DomainError('STATE','This booking cannot be cancelled.',409)
            if not r['payment_known'] or r['paid_minor']>r['refunded_minor']:raise DomainError('REFUND_REVIEW','Verify payment/refund with the original payment provider before cancelling.',409)
            c.execute(update(d.bookings).where(d.bookings.c.id==bid).values(status='cancelled',version=r['version']+1));self.audit(c,who,'booking.staff_cancelled',bid,{'note':note,'external_booking_updated':False})
            return {'id':bid,'status':'cancelled'}
