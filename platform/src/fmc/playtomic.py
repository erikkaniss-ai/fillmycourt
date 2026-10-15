"""Official read-only adapter, documentation checked 2026-10-04.

Bookings: offset pages. Players and Payments: cursor pages. No create/hold/cancel.
One page per worker step; rate limiting, Retry-After, 202, and continuation are durable.
"""
from decimal import Decimal,InvalidOperation
from datetime import datetime,timezone
from urllib.parse import quote
import time,httpx
from .common import DomainError
BASE='https://thirdparty.playtomic.io'
# This adapter deliberately has no provider booking-write method. A future
# write adapter needs separate provider authorization and per-court approval.
CAPABILITIES={'read_sync':True,'handoff':True,'authorized_native_write':False}
def capabilities():
    """Return declared modes; never infer provider write permission."""
    return CAPABILITIES.copy()
class Deferred(DomainError):
    def __init__(self,code,seconds):super().__init__(code,'Provider is preparing data or rate limited; queued for retry.',503);self.seconds=max(5,min(3600,seconds))
def parse_money(value):
    try:
        amount,currency=value.strip().split();n=Decimal(amount)
        if currency not in ('EUR','GBP','USD','SEK','DKK','NOK','CHF','CZK','PLN') or not n.is_finite() or n*100!=(n*100).to_integral_value():raise ValueError()
        minor=int(n*100)
        if abs(minor)>100_000_000:raise ValueError()
        return minor,currency
    except (AttributeError,ValueError,InvalidOperation):raise DomainError('PROVIDER_MONEY','Unrecognized money value; no silent rounding or FX conversion.',502) from None
class Playtomic:
    def __init__(self,client_id,secret,tenant,http=None):
        self.client_id,self.secret,self.tenant=client_id,secret,tenant
        self.http=http or httpx.Client(timeout=20,follow_redirects=False);self.token=None;self.expires=0
    def get_token(self):
        if not self.client_id or not self.secret or not self.tenant:raise DomainError('PROVIDER_CONFIG','Club credentials are not configured.',503)
        if self.token and self.expires>time.time():return self.token
        try:
            r=self.http.post(BASE+'/api/v1/oauth/token',json={'client_id':self.client_id,'secret':self.secret});r.raise_for_status();j=r.json()
            token=j['token'];duration=int(j['expires_in'])
            if not isinstance(token,str) or not token or not 60<=duration<=86400:raise ValueError()
            self.token=token;self.expires=time.time()+duration-30;return token
        except (httpx.HTTPError,ValueError,KeyError,TypeError):raise DomainError('PROVIDER_AUTH','Playtomic authentication failed.',502) from None
    @staticmethod
    def iso(value):
        try:
            dt=datetime.fromisoformat(value.replace('Z','+00:00'))
            if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc) # explicitly UTC in provider documentation
            return dt.astimezone(timezone.utc).isoformat()
        except (TypeError,ValueError,AttributeError):raise DomainError('PROVIDER_DATE','Unrecognized provider timestamp.',502) from None
    def page(self,kind,start,end,cursor=None,page=0):
        if kind=='bookings':
            path='/api/v1/bookings';params={'tenant_id':self.tenant,'start_booking_date':self.iso(start)[:19],'end_booking_date':self.iso(end)[:19],'page':page,'size':200}
        elif kind=='players':
            # The documented endpoint heading uses plural /venues. The cURL example
            # contains singular /venue; never probe undocumented fallbacks silently.
            path='/api/v1/venues/'+quote(self.tenant,safe='')+'/players';params={'limit':100}
            if cursor:params['cursor_id']=cursor
        elif kind=='payments':
            path='/api/v1/payments';params={'tenant_id':self.tenant,'start_payment_date':self.iso(start),'end_payment_date':self.iso(end),'limit':100}
            if cursor:params['cursor_id']=cursor
        else:raise DomainError('PROVIDER_KIND','Unsupported read operation.',422)
        try:r=self.http.get(BASE+path,params=params,headers={'Authorization':'Bearer '+self.get_token()})
        except httpx.HTTPError:raise DomainError('PROVIDER_TIMEOUT','Provider did not respond.',502) from None
        if r.status_code in (202,429):
            delay=r.headers.get('Retry-After','60');raise Deferred('PROVIDER_PROCESSING' if r.status_code==202 else 'PROVIDER_RATE',int(delay) if delay.isdigit() else 60)
        if r.status_code in (401,403):self.token=None;raise DomainError('PROVIDER_SCOPE','Provider denied access or the token expired.',502)
        if r.status_code!=200:raise DomainError('PROVIDER_HTTP','Provider returned an error; no records inferred.',502)
        try:
            raw=r.json();data=raw if kind=='bookings' else raw['data']
            if not isinstance(data,list) or len(data)>(200 if kind=='bookings' else 100):raise ValueError()
            if kind=='bookings':return {'records':[self.booking(x) for x in data],'has_more':len(data)==200,'next_cursor':None}
            more=raw['has_more'];nxt=raw.get('next_cursor_id')
            if type(more) is not bool or (more and (not isinstance(nxt,str) or not nxt or nxt==cursor)):raise ValueError()
            normalized=[self.player(x) if kind=='players' else self.payment(x) for x in data]
            return {'records':normalized,'has_more':more,'next_cursor':nxt}
        except (ValueError,TypeError,KeyError):raise DomainError('PROVIDER_SCHEMA','Provider schema changed or pagination is invalid.',502) from None
    def booking(self,r):
        if r['tenant_id']!=self.tenant:raise DomainError('PROVIDER_SCOPE','Unexpected venue in response.',502)
        n,curr=parse_money(r['price'])
        if n<0:raise DomainError('PROVIDER_PRICE','Negative booking quote.',502)
        states={'PENDING':'confirmed','IN_PROGRESS':'confirmed','FINISHED':'completed','CANCELED':'cancelled'}
        status='cancelled' if r.get('is_canceled') is True else states[r['status']]
        return {'external_id':r['booking_id'],'court_external_id':r['resource_id'],'starts_at':self.iso(r['booking_start_date']),'ends_at':self.iso(r['booking_end_date']),'status':status,'total_minor':n,'currency':curr}
    def player(self,r):
        accepted=r['accepts_commercial_communications']
        if type(accepted) is not bool:raise ValueError('Consent')
        return {'external_id':r['player_id'],'name':r['name'],'email':r.get('email') or '', 'phone':r.get('phone') or '', 'consent':'granted' if accepted else 'unknown','consent_proof':'Playtomic venue '+self.tenant+' player '+r['player_id']+' explicit accepted='+str(accepted).lower()}
    def payment(self,r):
        p=r.get('payment_info') or {};payout=r.get('payout_info') or {};fee=p.get('b2b_commission_info') or {}
        out={'external_id':r['club_payment_id'],'payment_id':r.get('payment_id'),'refund_id':r.get('refund_id'),'status':p.get('status'),'payout_id':payout.get('payout_id'),'booking_id':None,'link_status':'unlinked'}
        # Payment schema has no guaranteed booking ID. Never fuzzy-match by person/amount.
        for key,value in [('gross',p.get('total')),('net',p.get('net_transfer_amount')),('fee',fee.get('amount')),('fee_tax',fee.get('tax_amount'))]:
            if value is not None:
                n,currency=parse_money(value)
                if out.get('currency',currency)!=currency:raise ValueError('Mixed currencies')
                out[key+'_minor']=n;out['currency']=currency
        if out['status'] not in ('PAID','REFUNDED'):out['link_status']='requires_source_review'
        return out
