"""Shared domain types. No provider credentials, fixture data or demo identities."""
import hashlib,json,secrets,time
from datetime import datetime,timezone
SPORTS=('padel','tennis','squash','badminton','pickleball')
class DomainError(Exception):
    def __init__(self,code,message,status=400):
        self.code,self.message,self.status=code,message,status
        super().__init__(message)
def ident(prefix='id'):return prefix+'_'+secrets.token_hex(16)
def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def stamp(value):
    try:
        d=datetime.fromisoformat(value.replace('Z','+00:00'))
        if d.tzinfo is None:raise ValueError('Timezone is required')
        return int(d.timestamp())
    except (ValueError,TypeError,AttributeError):raise DomainError('TIMESTAMP','Use ISO 8601 with a timezone.',422) from None
def require_key(key):
    if not isinstance(key,str) or not 8<=len(key)<=128:raise DomainError('IDEMPOTENCY_REQUIRED','Use an 8–128 character Idempotency-Key.',422)
def money(value):
    if type(value) is not int or not 0<=value<=100_000_000:raise DomainError('AMOUNT','Use nonnegative integer minor units.',422)
    return value
