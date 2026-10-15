"""Explicit disposable PostgreSQL integration gate; never target production.

FMC_TEST_DATABASE_URL must reference a database whose name ends in _test.
This environment has no PostgreSQL server: execution is an external release gate.
"""
import os,time
from sqlalchemy.engine import make_url
from sqlalchemy import insert,select
from sqlalchemy.exc import IntegrityError
from fmc import db as d
url=os.environ.get('FMC_TEST_DATABASE_URL')
if not url:raise SystemExit('Set FMC_TEST_DATABASE_URL for a disposable PostgreSQL database.')
u=make_url(url)
if not u.drivername.startswith('postgresql') or not (u.database or '').endswith('_test'):raise SystemExit('Refusing non-test database')
db=d.Store(url,production=True);now=int(time.time());prefix='gate_'+str(now)
with db.tx() as c:
    c.execute(insert(d.organisations).values(id=prefix,name='Synthetic concurrency gate',created=now))
    c.execute(insert(d.venues).values(id=prefix,organisation_id=prefix,name='Synthetic gate',latitude=0,longitude=0,data='{}',created=now))
    c.execute(insert(d.courts).values(id=prefix,venue_id=prefix,name='Court',sport='padel',hourly_minor=2000,currency='EUR',timezone='UTC',rules='{}',authority='native',enabled=True,authorization_ref='test-only'))
def try_insert(i):
    try:
        with db.tx() as c:c.execute(insert(d.bookings).values(id=f'{prefix}_{i}',venue_id=prefix,court_id=prefix,starts_at=now+86400,ends_at=now+90000,status='confirmed',total_minor=2000,currency='EUR',policy='{}',created=now))
        return 'won'
    except IntegrityError:return 'conflict'
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=16) as pool:results=list(pool.map(try_insert,range(16)))
assert results.count('won')==1,results
print({'postgres_exclusion_parallel_attempts':16,'wins':1,'conflicts':15})
