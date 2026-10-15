-- FMC-REV-F10: offline Core-shaped signed pathway fixtures, never a live Core signer.
-- No routes accepting signatures or secret values; no booking/provider/payment writes.
create table public.crm_core_pathway_fixtures_shadow (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 offer_id uuid not null references public.crm_offers(id) on delete cascade,
 core_snapshot_key char(64) not null,
 offer_link_event_key char(64) not null,
 path_id uuid not null,
 event_id text not null check(length(event_id) between 1 and 128),
 sequence smallint not null check(sequence in (1,2)),
 state text not null check (
   (sequence=1 and state='BOOKING_STARTED') or
   (sequence=2 and state='BOOKING_CONFIRMED')),
 prior_event_key char(64),
 event_key char(64) not null unique,
 payload_sha256 char(64) not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 signature_digest char(64) not null check(signature_digest ~ '^[a-f0-9]{64}$'),
 occurred_at timestamptz not null,
 signed_epoch bigint not null,
 source_mode text not null default 'offline_fixture'
    check(source_mode='offline_fixture'),
 causal_evidence_verified boolean not null default false check(causal_evidence_verified=false),
 core_origin_verified boolean not null default false check(core_origin_verified=false),
 billable boolean not null default false check(billable=false),
 fee_minor integer not null default 0 check(fee_minor=0),
 observed_at timestamptz not null default now(),
 unique(organization_id,path_id,event_id),
 unique(organization_id,path_id,sequence),
 check((sequence=1 and prior_event_key is null) or
       (sequence=2 and prior_event_key is not null))
);
create index crm_pathway_fixture_org_booking_idx on
 public.crm_core_pathway_fixtures_shadow(organization_id,booking_id,observed_at desc);
create index crm_pathway_fixture_booking_idx on
 public.crm_core_pathway_fixtures_shadow(booking_id);
create index crm_pathway_fixture_offer_idx on
 public.crm_core_pathway_fixtures_shadow(offer_id);
create index crm_pathway_fixture_path_idx on
 public.crm_core_pathway_fixtures_shadow(path_id);

create function private.guard_core_pathway_fixture() returns trigger
language plpgsql security invoker set search_path='' as $$
declare predecessor record;
begin
 if not exists (
   select 1 from public.bookings b
   join public.crm_booking_evidence e
    on e.booking_id=b.id and e.organization_id=b.organization_id
   join public.crm_booking_offer_links_shadow l
    on l.booking_id=b.id and l.organization_id=b.organization_id
   where b.id=new.booking_id and b.organization_id=new.organization_id
     and b.status='confirmed' and b.source in ('fmc','getacourt')
     and e.event_key=trim(new.core_snapshot_key)
     and e.authoritative_updated_at=b.updated_at
     and e.booking_status='confirmed' and e.booking_source=b.source
     and l.offer_id=new.offer_id
     and l.event_key=trim(new.offer_link_event_key)
     and l.booking_snapshot_key=trim(new.core_snapshot_key)
     and l.outcome='observed_match'
 ) then
   raise exception 'stale, non-native or cross-tenant pathway source' using errcode='23514';
 end if;
 if new.occurred_at > to_timestamp(new.signed_epoch) then
   raise exception 'future pathway event' using errcode='23514';
 end if;
 if new.sequence=2 then
    select p.event_key,p.occurred_at,p.offer_id,p.booking_id,p.core_snapshot_key
      into predecessor
    from public.crm_core_pathway_fixtures_shadow p
    where p.organization_id=new.organization_id and p.path_id=new.path_id
      and p.sequence=1;
    if not found or predecessor.event_key<>new.prior_event_key
       or predecessor.occurred_at>new.occurred_at
       or predecessor.booking_id<>new.booking_id
       or predecessor.offer_id<>new.offer_id
       or predecessor.core_snapshot_key<>new.core_snapshot_key then
       raise exception 'invalid pathway chain' using errcode='23514';
    end if;
 end if;
 return new;
end; $$;
create trigger crm_core_pathway_fixture_integrity
 before insert on public.crm_core_pathway_fixtures_shadow
 for each row execute function private.guard_core_pathway_fixture();
create trigger crm_core_pathway_fixture_immutable
 before update or delete on public.crm_core_pathway_fixtures_shadow
 for each row execute function private.block_shadow_evidence_modification();
alter table public.crm_core_pathway_fixtures_shadow enable row level security;
revoke all on public.crm_core_pathway_fixtures_shadow from public,anon,authenticated;
grant select on public.crm_core_pathway_fixtures_shadow to authenticated;
create policy crm_core_pathway_fixture_finance_read
 on public.crm_core_pathway_fixtures_shadow for select to authenticated
 using(private.has_org_role(organization_id,
   array['owner','admin','manager','analyst']::public.fmc_member_role[]));
comment on table public.crm_core_pathway_fixtures_shadow is
 'Immutable OFFLINE HMAC fixture chain, not real Core-origin delivery, booking causality or financial authority.';
