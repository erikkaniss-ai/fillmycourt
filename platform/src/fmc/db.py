"""SQLAlchemy 2 storage. PostgreSQL for deployed services; SQLite only for tests/dev.

Each request is bounded. Native writes lock the court row on PostgreSQL. Worker
claims use SKIP LOCKED. No network I/O is performed while a DB transaction is held.
"""
from contextlib import contextmanager
from pathlib import Path
import time
from sqlalchemy import (MetaData,Table,Column as C,String as S,Integer as I,BigInteger as B,
    Boolean as Bool,Float,Text as T,ForeignKey as FK,UniqueConstraint as U,Index,CheckConstraint as Check,
    create_engine,event,select,insert,text)
from .common import ident,canonical,DomainError
m=MetaData()
def table(name,*cols):return Table(name,m,*cols)
def pk():return C('id',S(80),primary_key=True)
organisations=table('organisations',pk(),C('name',S(200),nullable=False),C('created',B,nullable=False))
players=table('players',pk(),C('email',S(320),nullable=False),C('display_name',S(100),nullable=False,default=''),C('profile',T,nullable=False,default='{}'),C('onboarded',Bool,nullable=False,default=False),C('created',B,nullable=False),C('updated',B,nullable=False))
identities=table('identities',C('provider',S(20),primary_key=True),C('subject',S(255),primary_key=True),C('player_id',S(80),FK('players.id'),nullable=False))
sessions=table('player_sessions',C('token_hash',S(64),primary_key=True),C('player_id',S(80),FK('players.id'),nullable=False),C('expires',B,nullable=False))
oauth=table('oauth_transactions',C('state_hash',S(64),primary_key=True),C('provider',S(20),nullable=False),C('browser_hash',S(64),nullable=False),C('nonce',S(100),nullable=False),C('verifier',S(100),nullable=False),C('expires',B,nullable=False))
rates=table('auth_rates',C('key',S(64),primary_key=True),C('started',B,nullable=False),C('count',I,nullable=False))
members=table('memberships',C('organisation_id',S(80),FK('organisations.id'),primary_key=True),C('player_id',S(80),FK('players.id'),primary_key=True),C('role',S(20),nullable=False),Check("role IN ('owner','manager','staff','accountant','viewer')"))
venues=table('venues',pk(),C('organisation_id',S(80),FK('organisations.id'),nullable=False),C('name',S(200),nullable=False),C('latitude',Float,nullable=False),C('longitude',Float,nullable=False),C('data',T,nullable=False),C('created',B,nullable=False))
courts=table('courts',pk(),C('venue_id',S(80),FK('venues.id'),nullable=False),C('name',S(120),nullable=False),C('sport',S(30),nullable=False),C('hourly_minor',I,nullable=False),C('currency',S(3),nullable=False,default='EUR'),C('timezone',S(80),nullable=False),C('rules',T,nullable=False),C('authority',S(20),nullable=False,default='external'),C('enabled',Bool,nullable=False,default=False),C('authorization_ref',T,nullable=False,default=''),Check('hourly_minor > 0'),Check("authority IN ('native','external')"))
bookings=table('bookings',pk(),C('venue_id',S(80),FK('venues.id'),nullable=False),C('court_id',S(80),FK('courts.id'),nullable=False),C('player_id',S(80),FK('players.id')),C('starts_at',B,nullable=False),C('ends_at',B,nullable=False),C('status',S(20),nullable=False),C('expires',B),C('total_minor',I,nullable=False),C('amount_known',Bool,nullable=False,default=True),C('currency',S(3),nullable=False),C('paid_minor',I,nullable=False,default=0),C('refunded_minor',I,nullable=False,default=0),C('payment_known',Bool,nullable=False,default=True),C('participants',I,nullable=False,default=1),C('policy',T,nullable=False),C('provider',S(40),nullable=False,default='native'),C('external_id',S(160)),C('contact_id',S(80)),C('version',I,nullable=False,default=1),C('created',B,nullable=False),U('venue_id','provider','external_id'),Check('ends_at > starts_at'),Check('total_minor >= 0 AND paid_minor >= 0 AND refunded_minor >= 0'),Check("status IN ('held','confirmed','blocked','cancelled','expired','completed','no_show')"))
idempotency=table('idempotency',C('actor',S(80),primary_key=True),C('operation',S(120),primary_key=True),C('key',S(128),primary_key=True),C('fingerprint',S(64),nullable=False),C('result_id',S(80),nullable=False))
contacts=table('contacts',pk(),C('venue_id',S(80),FK('venues.id'),nullable=False),C('source',S(40),nullable=False),C('external_id',S(160),nullable=False),C('name',S(200),nullable=False),C('name_key',S(200),nullable=False),C('email',S(320),nullable=False,default=''),C('phone',S(40),nullable=False,default=''),C('consent',S(20),nullable=False,default='unknown'),C('consent_proof',T,nullable=False,default=''),C('updated',B,nullable=False),U('venue_id','source','external_id'),Check("consent IN ('unknown','granted','withdrawn')"))
imports=table('import_batches',pk(),C('venue_id',S(80),FK('venues.id'),nullable=False),C('source',S(40),nullable=False),C('kind',S(30),nullable=False),C('fingerprint',S(64),nullable=False),C('payload',T,nullable=False),C('errors',T,nullable=False),C('status',S(20),nullable=False),C('actor',S(80),nullable=False),C('created',B,nullable=False),U('venue_id','kind','source','fingerprint'))
mappings=table('provider_courts',C('venue_id',S(80),FK('venues.id'),primary_key=True),C('provider',S(40),primary_key=True),C('external_id',S(160),primary_key=True),C('court_id',S(80),FK('courts.id'),nullable=False))
integrations=table('integrations',C('venue_id',S(80),FK('venues.id'),primary_key=True),C('provider',S(40),primary_key=True),C('tenant_id',S(160),nullable=False),C('credential_ref',S(100),nullable=False),C('authorization_ref',T,nullable=False),C('status',S(30),nullable=False,default='configured'),C('last_success',B),C('last_error',S(50)),C('next_allowed',B,nullable=False,default=0))
snapshots=table('provider_snapshots',pk(),C('venue_id',S(80),FK('venues.id'),nullable=False),C('provider',S(40),nullable=False),C('fingerprint',S(64),nullable=False),C('observed_at',B,nullable=False),C('window_start',B,nullable=False),C('window_end',B,nullable=False),C('complete',Bool,nullable=False),C('payload',T,nullable=False),C('source_ref',T,nullable=False),C('created',B,nullable=False),U('venue_id','provider','fingerprint'))
recon_runs=table('recon_runs',pk(),C('venue_id',S(80),FK('venues.id'),nullable=False),C('snapshot_id',S(80),FK('provider_snapshots.id'),nullable=False),C('status',S(20),nullable=False),C('summary',T,nullable=False),C('created',B,nullable=False))
issues=table('recon_issues',pk(),C('run_id',S(80),FK('recon_runs.id'),nullable=False),C('venue_id',S(80),FK('venues.id'),nullable=False),C('external_id',S(160)),C('booking_id',S(80)),C('category',S(40),nullable=False),C('severity',S(20),nullable=False),C('status',S(30),nullable=False,default='open'),C('expected',T,nullable=False),C('observed',T,nullable=False),C('assigned_to',S(80)),C('proposed_by',S(80)),C('approved_by',S(80)),C('note',T,nullable=False,default=''),C('version',I,nullable=False,default=1))
ledger=table('money_events',pk(),C('venue_id',S(80),FK('venues.id'),nullable=False),C('source',S(40),nullable=False),C('external_id',S(160),nullable=False),C('booking_id',S(80),FK('bookings.id')),C('batch_ref',S(160)),C('kind',S(30),nullable=False),C('amount_minor',I,nullable=False),C('currency',S(3),nullable=False),C('evidence_ref',T,nullable=False),C('actor',S(80),nullable=False),C('created',B,nullable=False),U('venue_id','source','external_id'),Check('amount_minor >= 0'),Check("kind IN ('capture','refund','fee','payout_expected','bank_credit')"))
jobs=table('jobs',pk(),C('venue_id',S(80),FK('venues.id'),nullable=False),C('kind',S(40),nullable=False),C('dedupe_key',S(200),nullable=False),C('payload',T,nullable=False),C('status',S(20),nullable=False),C('attempts',I,nullable=False,default=0),C('due',B,nullable=False),C('lease_until',B),C('lease_token',S(80)),C('error',S(80)),C('result',T),C('created',B,nullable=False),U('venue_id','kind','dedupe_key'))
audit=table('audit_events',pk(),C('venue_id',S(80)),C('actor',S(80),nullable=False),C('action',S(80),nullable=False),C('entity_id',S(160),nullable=False),C('data',T,nullable=False),C('created',B,nullable=False))
outbox=table('outbox',pk(),C('event_id',S(80),FK('audit_events.id'),nullable=False),C('topic',S(80),nullable=False),C('status',S(20),nullable=False,default='pending'),C('created',B,nullable=False))
Index('venue_geography',venues.c.latitude,venues.c.longitude)
Index('enabled_sport_courts',courts.c.sport,courts.c.enabled,courts.c.venue_id)
Index('booking_overlap_lookup',bookings.c.court_id,bookings.c.starts_at,bookings.c.ends_at,bookings.c.status)
Index('booking_player_page',bookings.c.player_id,bookings.c.id)
Index('booking_provider_scope',bookings.c.venue_id,bookings.c.provider,bookings.c.starts_at)
Index('contact_prefix_page',contacts.c.venue_id,contacts.c.name_key,contacts.c.id)
Index('contact_email_lookup',contacts.c.venue_id,contacts.c.email)
Index('job_due',jobs.c.status,jobs.c.due,jobs.c.lease_until)
Index('recon_venue_status',issues.c.venue_id,issues.c.status,issues.c.id)
Index('audit_venue_created',audit.c.venue_id,audit.c.created)

def one(c,q):
    r=c.execute(q).mappings().first();return dict(r) if r else None
def rows(c,q):return [dict(r) for r in c.execute(q).mappings()]
class Store:
    def __init__(self,url='sqlite:///.data/fmc.sqlite',production=False,initialize=True):
        self.postgres=url.startswith('postgresql')
        if production and not self.postgres:raise RuntimeError('Production requires PostgreSQL; SQLite is local development only.')
        if url.startswith('sqlite:///'):
            p=url[len('sqlite:///'):]
            if p!=':memory:':Path(p).parent.mkdir(parents=True,exist_ok=True)
        kw={'pool_pre_ping':True}
        if self.postgres:kw.update(pool_size=5,max_overflow=5,pool_timeout=10)
        else:kw['connect_args']={'check_same_thread':False,'timeout':15}
        self.engine=create_engine(url,**kw)
        if not self.postgres:
            @event.listens_for(self.engine,'connect')
            def setup(conn,_):
                conn.execute('PRAGMA foreign_keys=ON');conn.execute('PRAGMA journal_mode=WAL');conn.execute('PRAGMA busy_timeout=15000')
        if initialize:self.migrate()
    def migrate(self):
        m.create_all(self.engine)
        if self.postgres:
            with self.engine.begin() as c:
                c.execute(text('CREATE EXTENSION IF NOT EXISTS btree_gist'))
                exists=c.execute(text("SELECT 1 FROM pg_constraint WHERE conname='no_active_court_overlap'" )).first()
                if not exists:
                    c.execute(text("ALTER TABLE bookings ADD CONSTRAINT no_active_court_overlap EXCLUDE USING gist (court_id WITH =, int8range(starts_at,ends_at,'[)') WITH &&) WHERE (status IN ('held','confirmed','blocked'))"))
        # Evidence records cannot be rewritten by an application update/delete.
        # Production runtime role must additionally have no schema-owner privileges.
        with self.engine.begin() as c:
            if self.postgres:
                c.execute(text("CREATE OR REPLACE FUNCTION fmc_immutable_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable evidence'; END; $$"))
            for name in ('audit_events','provider_snapshots','money_events','provider_reports'):
                if self.postgres:
                    c.execute(text(f"DROP TRIGGER IF EXISTS immutable_{name} ON {name}"))
                    c.execute(text(f"CREATE TRIGGER immutable_{name} BEFORE UPDATE OR DELETE ON {name} FOR EACH ROW EXECUTE FUNCTION fmc_immutable_evidence()"))
                else:
                    for action in ('UPDATE','DELETE'):
                        c.exec_driver_sql(f"CREATE TRIGGER IF NOT EXISTS immutable_{name}_{action} BEFORE {action} ON {name} BEGIN SELECT RAISE(ABORT, 'immutable evidence'); END;")
    @contextmanager
    def tx(self):
        with self.engine.connect() as c:
            try:
                if not self.postgres:c.exec_driver_sql('BEGIN IMMEDIATE')
                else:c.begin()
                yield c;c.commit()
            except Exception:c.rollback();raise
    @contextmanager
    def read(self):
        with self.engine.connect() as c:yield c
    def lock(self,c,t,**where):
        q=select(t).filter_by(**where)
        if self.postgres:q=q.with_for_update()
        return one(c,q)
    def emit(self,c,venue,actor,action,entity,data=None,at=None):
        now=int(at or time.time());eid=ident('evt')
        c.execute(insert(audit).values(id=eid,venue_id=venue,actor=actor,action=action,entity_id=entity,data=canonical(data or {}),created=now))
        c.execute(insert(outbox).values(id=ident('out'),event_id=eid,topic=action,status='pending',created=now))
        return eid

# Separate feed observations: no asserted bank settlement or booking relation.
reports=table('provider_reports',pk(),C('venue_id',S(80),FK('venues.id'),nullable=False),C('provider',S(40),nullable=False),C('kind',S(30),nullable=False),C('job_id',S(80),nullable=False),C('data',T,nullable=False),C('complete',Bool,nullable=False),C('created',B,nullable=False),U('job_id'))

activity=table('activity_feed',C('event_id',S(80),FK('audit_events.id'),primary_key=True),C('venue_id',S(80)),C('topic',S(80),nullable=False),C('entity_id',S(160),nullable=False),C('created',B,nullable=False))
Index('activity_club_page',activity.c.venue_id,activity.c.created)
