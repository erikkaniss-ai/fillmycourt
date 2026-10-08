"""Single booking authority shared by GetACourt and FmC. Never infers provider rights."""
import json,time,math
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from sqlalchemy import select,insert,update,and_,or_,func
from .db import courts,bookings,venues,players,idempotency,one,rows
from .common import DomainError,ident,digest,canonical,require_key,SPORTS
CENTRES={'cascais':(38.6979,-9.4215),'estoril':(38.705,-9.397),'lisbon':(38.7223,-9.1393),'lisboa':(38.7223,-9.1393),'sintra':(38.8029,-9.3817)}
def distance(a,b):
    r=math.pi/180;dlat=(b[0]-a[0])*r;dlon=(b[1]-a[1])*r
    h=math.sin(dlat/2)**2+math.cos(a[0]*r)*math.cos(b[0]*r)*math.sin(dlon/2)**2
    return 6371*2*math.asin(math.sqrt(min(1,h)))
class Booking:
    def __init__(self,db,clock=time.time):self.db,self.clock=db,clock
    def now(self):return int(self.clock())
    def court(self,c,cid,write=False,require_enabled=True):
        r=self.db.lock(c,courts,id=cid) if write else one(c,select(courts).where(courts.c.id==cid))
        if not r:raise DomainError('NOT_FOUND','Court not found.',404)
        r['rules']=json.loads(r['rules'])
        if require_enabled and (not r['enabled'] or r['authority']!='native' or not r['authorization_ref']):
            raise DomainError('NOT_BOOKABLE','This court is not enabled for direct FmC bookings.',409)
        return r
    def interval(self,ct,date,at,duration):
        r=ct['rules']
        if type(duration) is not int or duration not in r['durations']:raise DomainError('DURATION','Unsupported duration.',422)
        try:
            naive=datetime.strptime(date+' '+at,'%Y-%m-%d %H:%M');tz=ZoneInfo(ct['timezone']);dt=naive.replace(tzinfo=tz)
            if dt.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None)!=naive:raise ValueError('Nonexistent time')
            if naive.replace(tzinfo=tz,fold=0).utcoffset()!=naive.replace(tzinfo=tz,fold=1).utcoffset():raise ValueError('Ambiguous time')
        except (ValueError,TypeError,ZoneInfoNotFoundError):raise DomainError('DATE_TIME','Invalid or ambiguous club-local time.',422) from None
        mins=dt.hour*60+dt.minute
        if mins%r['step_minutes'] or mins<r['opening_minute'] or mins+duration>r['closing_minute']:raise DomainError('HOURS','Outside club booking hours.',422)
        start=int(dt.timestamp());end=start+duration*60
        if start<=self.now()+300 or start>self.now()+r['booking_days']*86400:raise DomainError('WINDOW','Outside the booking window.',422)
        return start,end
    def price(self,ct,start,end):
        # Exact minute-weighted tariff; a single final rounding, not cumulative rounding.
        r=ct['rules'];numerator=0
        for t in range(start,end,60):
            hr=datetime.fromtimestamp(t,ZoneInfo(ct['timezone'])).hour
            numerator+=ct['hourly_minor']+(r.get('peak_addon_minor',0) if r.get('peak_start',17)<=hr<r.get('peak_end',21) else 0)
        return (numerator+30)//60
    def expire(self,c,cid=None):
        q=update(bookings).where(bookings.c.status=='held',bookings.c.expires<=self.now())
        if cid:q=q.where(bookings.c.court_id==cid)
        c.execute(q.values(status='expired',version=bookings.c.version+1))
    def conflict(self,c,cid,start,end,exclude=''):
        return one(c,select(bookings.c.id).where(bookings.c.court_id==cid,bookings.c.id!=exclude,bookings.c.starts_at<end,bookings.c.ends_at>start,or_(bookings.c.status.in_(['confirmed','blocked']),and_(bookings.c.status=='held',bookings.c.expires>self.now()))).limit(1))
    def serialize(self,c,b):
        r=dict(b);ct=self.court(c,r['court_id'],require_enabled=False);v=one(c,select(venues).where(venues.c.id==r['venue_id']))
        local=datetime.fromtimestamp(r['starts_at'],ZoneInfo(ct['timezone']));policy=json.loads(r['policy'])
        r.update(start=r['starts_at'],end=r['ends_at'],date=local.strftime('%Y-%m-%d'),time=local.strftime('%H:%M'),duration=(r['ends_at']-r['starts_at'])//60,price_minor=r['total_minor'],venue_name=v['name'],city=json.loads(v['data'])['city'],court_name=ct['name'],sport=ct['sport'],timezone=ct['timezone'],policy=policy,payment_status='unpaid' if not r['paid_minor'] else 'recorded',cancellation_cutoff=r['starts_at']-policy.get('cancellation_hours',12)*3600)
        r.pop('player_id',None);return r
    def prior(self,c,actor,op,key,payload):
        fp=digest(canonical(payload));r=one(c,select(idempotency).filter_by(actor=actor,operation=op,key=key))
        if r:
            if r['fingerprint']!=fp:raise DomainError('IDEMPOTENCY_CONFLICT','The key was reused for a different request.',409)
            b=one(c,select(bookings).where(bookings.c.id==r['result_id']))
            return self.serialize(c,b)
        return None
    def remember(self,c,actor,op,key,payload,result):
        c.execute(insert(idempotency).values(actor=actor,operation=op,key=key,fingerprint=digest(canonical(payload)),result_id=result))
    def quote(self,cid,date,at,duration):
        with self.db.read() as c:
            ct=self.court(c,cid);s,e=self.interval(ct,date,at,duration)
            if self.conflict(c,cid,s,e):raise DomainError('SLOT_UNAVAILABLE','This slot is no longer available.',409)
            return {'court_id':cid,'start':s,'end':e,'price_minor':self.price(ct,s,e),'currency':ct['currency'],'policy':ct['rules'],'payment_method':'pay_at_venue'}
    def hold(self,actor,cid,date,at,duration,key):
        require_key(key);payload=[cid,date,at,duration]
        with self.db.tx() as c:
            # Lock principal before resource: hold quota and idempotency stay atomic across replicas.
            self.db.lock(c,players,id=actor)
            ct=self.court(c,cid,write=True);self.expire(c,cid)
            old=self.prior(c,actor,'hold',key,payload)
            if old:return old
            s,e=self.interval(ct,date,at,duration)
            if self.conflict(c,cid,s,e):raise DomainError('SLOT_UNAVAILABLE','Someone else has reserved this slot.',409)
            count=c.execute(select(func.count()).select_from(bookings).where(bookings.c.player_id==actor,bookings.c.status=='held',bookings.c.expires>self.now())).scalar_one()
            if count>=3:raise DomainError('HOLD_LIMIT','Finish or cancel an existing hold.',429)
            b={'id':ident('booking'),'venue_id':ct['venue_id'],'court_id':cid,'player_id':actor,'starts_at':s,'ends_at':e,'status':'held','expires':self.now()+600,'total_minor':self.price(ct,s,e),'currency':ct['currency'],'policy':canonical(ct['rules']),'provider':'native','created':self.now()}
            c.execute(insert(bookings).values(**b));self.remember(c,actor,'hold',key,payload,b['id']);self.db.emit(c,ct['venue_id'],actor,'booking.held',b['id'],at=self.now())
            return self.serialize(c,one(c,select(bookings).where(bookings.c.id==b['id'])))
    def owned(self,c,actor,bid):
        b=one(c,select(bookings).where(bookings.c.id==bid,bookings.c.player_id==actor))
        if not b:raise DomainError('NOT_FOUND','Booking not found.',404)
        return b
    def confirm(self,actor,bid,participants,key,accept_policy,payment='venue'):
        require_key(key);payload=[bid,participants,payment]
        if accept_policy is not True:raise DomainError('POLICY_REQUIRED','Accept the cancellation terms.',422)
        if type(participants) is not int or not 1<=participants<=4:raise DomainError('PARTICIPANTS','Choose one to four players.',422)
        if payment!='venue':raise DomainError('PAYMENT_UNAVAILABLE','Only pay-at-venue is enabled for this inventory.',422)
        with self.db.tx() as c:
            self.db.lock(c,players,id=actor);b=self.owned(c,actor,bid);ct=self.court(c,b['court_id'],write=True)
            self.expire(c,b['court_id']);b=self.owned(c,actor,bid)
            old=self.prior(c,actor,'confirm',key,payload)
            if old:return old
            if b['status']=='confirmed':return self.serialize(c,b)
            if b['status']!='held' or b['expires']<=self.now():raise DomainError('HOLD_EXPIRED','Your hold expired. Search again.',409)
            if ct['sport']=='squash' and participants>2:raise DomainError('PARTICIPANTS','This squash court supports two players.',422)
            if self.conflict(c,b['court_id'],b['starts_at'],b['ends_at'],bid):raise DomainError('CONFLICT','Court unavailable.',409)
            c.execute(update(bookings).where(bookings.c.id==bid).values(status='confirmed',participants=participants,expires=None,version=bookings.c.version+1))
            self.remember(c,actor,'confirm',key,payload,bid);self.db.emit(c,b['venue_id'],actor,'booking.confirmed',bid,{'payment':'unpaid'},self.now())
            return self.serialize(c,self.owned(c,actor,bid))
    def cancel(self,actor,bid):
        with self.db.tx() as c:
            self.db.lock(c,players,id=actor);b=self.owned(c,actor,bid);self.court(c,b['court_id'],write=True,require_enabled=False);b=self.owned(c,actor,bid)
            if b['status']=='cancelled':return self.serialize(c,b)
            if b['status'] not in ('held','confirmed'):raise DomainError('STATE','This booking cannot be cancelled.',409)
            if b['status']=='confirmed' and self.now()>=b['starts_at']-json.loads(b['policy'])['cancellation_hours']*3600:raise DomainError('CUTOFF','Contact the club: the cancellation cutoff passed.',409)
            if b['provider']!='native':raise DomainError('EXTERNAL_AUTHORITY','Cancellation must be confirmed by the booking provider.',409)
            c.execute(update(bookings).where(bookings.c.id==bid).values(status='cancelled',version=bookings.c.version+1));self.db.emit(c,b['venue_id'],actor,'booking.cancelled',bid,at=self.now())
            return self.serialize(c,self.owned(c,actor,bid))
    def list_for(self,actor,after='',limit=50):
        with self.db.read() as c:return [self.serialize(c,b) for b in rows(c,select(bookings).where(bookings.c.player_id==actor,bookings.c.id>after).order_by(bookings.c.id).limit(min(100,max(1,limit))))]
    def search(self,*,sport,date,time='07:00',end_time='23:00',duration=90,location='Cascais',radius=25,indoor='all',lat=None,lon=None,sort='time'):
        if sport not in SPORTS or indoor not in ('all','indoor','outdoor') or not 1<=radius<=100:raise DomainError('SEARCH','Invalid search filters.',422)
        try:
            lo=datetime.strptime(time,'%H:%M');hi=datetime.strptime(end_time,'%H:%M');lo=lo.hour*60+lo.minute;hi=hi.hour*60+hi.minute;datetime.strptime(date,'%Y-%m-%d')
            centre=(float(lat),float(lon)) if lat is not None and lon is not None else CENTRES[location.lower()]
            if not all(math.isfinite(x) for x in centre) or not -90<=centre[0]<=90 or not -180<=centre[1]<=180 or hi<=lo:raise ValueError()
        except (ValueError,KeyError,TypeError):raise DomainError('SEARCH','Select a valid location, date and time window.',422) from None
        result=[]
        with self.db.read() as c:
            # Bounded query and bulk overlap fetch avoid one SQL call per displayed slot.
            delta_lat=radius/110.5;delta_lon=min(180,radius/(110.5*max(.001,math.cos(math.radians(centre[0])))))
            geo=[venues.c.latitude.between(centre[0]-delta_lat,centre[0]+delta_lat)]
            # Longitude wrap is handled by distance filtering, not a false empty bounding box.
            if -180<=centre[1]-delta_lon and centre[1]+delta_lon<=180:geo.append(venues.c.longitude.between(centre[1]-delta_lon,centre[1]+delta_lon))
            cs=rows(c,select(courts).join(venues,venues.c.id==courts.c.venue_id).where(courts.c.sport==sport,courts.c.enabled==True,courts.c.authority=='native',*geo).order_by(courts.c.id).limit(251))
            truncated=len(cs)>250;cs=cs[:250]
            if not cs:return {'venues':[],'checked_at':self.now(),'source':'fillmycourt-core','partial':truncated}
            vs={v['id']:v for v in rows(c,select(venues).where(venues.c.id.in_({ct['venue_id'] for ct in cs})))}
            day=int(datetime.strptime(date,'%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp())
            occupied=rows(c,select(bookings).where(bookings.c.court_id.in_([ct['id'] for ct in cs]),bookings.c.starts_at<day+2*86400,bookings.c.ends_at>day-86400,or_(bookings.c.status.in_(['confirmed','blocked']),and_(bookings.c.status=='held',bookings.c.expires>self.now()))))
            bycourt={ct['id']:[] for ct in cs}
            for b in occupied:bycourt[b['court_id']].append((b['starts_at'],b['ends_at']))
            for ct in cs:
                ct['rules']=json.loads(ct['rules']);r=ct['rules'];v=vs[ct['venue_id']];data=json.loads(v['data']);dist=distance(centre,(data['lat'],data['lon']))
                if dist>radius or (indoor!='all' and data['indoor']!=(indoor=='indoor')) or duration not in r['durations'] or not ct['authorization_ref']:continue
                slots=[];step=r['step_minutes'];start=max(r['opening_minute'],((lo+step-1)//step)*step)
                for minutes in range(start,min(r['closing_minute'],hi)-duration+1,step):
                    at=f'{minutes//60:02}:{minutes%60:02}'
                    try:s,e=self.interval(ct,date,at,duration)
                    except DomainError:continue
                    if any(a<e and b>s for a,b in bycourt[ct['id']]):continue
                    slots.append({'court_id':ct['id'],'court_name':ct['name'],'date':date,'time':at,'duration':duration,'start':s,'end':e,'price_minor':self.price(ct,s,e),'currency':ct['currency'],'booking_mode':'native'})
                if slots:result.append({**data,'id':v['id'],'name':v['name'],'court_id':ct['id'],'court_name':ct['name'],'sport':sport,'timezone':ct['timezone'],'distance':round(dist,1),'slots':slots})
        key=(lambda x:min(s['price_minor'] for s in x['slots'])) if sort=='price' else (lambda x:x['distance']) if sort=='distance' else (lambda x:x['slots'][0]['start'])
        return {'venues':sorted(result,key=key),'checked_at':self.now(),'source':'fillmycourt-core','partial':truncated}
