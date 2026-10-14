-- FMC-REV-F06: offline signed provider fixture ledger and Core-linked tracked
-- Offer observation. NO webhook route, live sends, billing, provider writes.
create table public.crm_provider_events_offline (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 provider_connection_id uuid not null references public.provider_connections(id) on delete cascade,
 provider text not null,
 event_id text not null check(length(event_id) between 1 and 128),
 provider_sequence bigint not null check(provider_sequence > 0),
 booking_reference text not null,
 event_state text not null check(event_state in ('pending','confirmed','cancelled','refunded','failed')),
 event_key char(64) not null unique,
 payload_sha256 char(64) not null,
 event_occurred_at timestamptz not null,
 signed_at timestamptz not null,
 verified_source text not null default 'offline_fixture' check(verified_source='offline_fixture'),
 causal_evidence_verified boolean not null default false check(causal_evidence_verified=false),
 created_at timestamptz not null default now(),
 unique (organization_id,provider_connection_id,event_id),
 unique (organization_id,provider_connection_id,provider_sequence)
);
create index crm_provider_events_offline_org_idx on public.crm_provider_events_offline(organization_id,provider_connection_id,created_at desc);
create index crm_provider_events_offline_conn_idx on public.crm_provider_events_offline(provider_connection_id);

create table public.crm_booking_offer_links_shadow (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 offer_id uuid not null references public.crm_offers(id) on delete cascade,
 booking_snapshot_key char(64) not null,
 event_key char(64) not null unique,
 tracking_digest char(64) not null,
 outcome text not null check(outcome in ('observed_match','ambiguous')),
 causal_evidence_verified boolean not null default false check(causal_evidence_verified=false),
 fee_minor integer not null default 0 check(fee_minor=0),
 source_mode text not null default 'core_shadow' check(source_mode='core_shadow'),
 created_at timestamptz not null default now(),
 unique (organization_id,booking_id,offer_id,booking_snapshot_key)
);
create index crm_booking_offer_links_org_booking_idx on public.crm_booking_offer_links_shadow(organization_id,booking_id,created_at desc);
create index crm_booking_offer_links_booking_idx on public.crm_booking_offer_links_shadow(booking_id);
create index crm_booking_offer_links_offer_idx on public.crm_booking_offer_links_shadow(offer_id);

create function private.guard_offline_revenue_evidence() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='crm_provider_events_offline' then
   if not exists (
      select 1 from public.provider_connections c
      where c.id=new.provider_connection_id
        and c.organization_id=new.organization_id
        and c.provider=new.provider
   ) then raise exception 'provider ownership mismatch' using errcode='23514'; end if;
 elsif tg_table_name='crm_booking_offer_links_shadow' then
   if not exists (
      select 1 from public.crm_booking_evidence e
      where e.booking_id=new.booking_id and e.organization_id=new.organization_id
        and e.event_key=new.booking_snapshot_key
   ) then raise exception 'missing tenant-owned Core snapshot' using errcode='23514'; end if;
   if not exists (
      select 1 from public.bookings b join public.crm_offers o
        on o.id=new.offer_id and o.organization_id=b.organization_id
      where b.id=new.booking_id and b.organization_id=new.organization_id
        and b.court_id=o.target_court_id
        and b.starts_at=o.target_starts_at and b.ends_at=o.target_ends_at
        and b.currency=o.currency
        and encode(sha256(convert_to(o.tracking_token,'UTF8')),'hex')=new.tracking_digest
   ) then raise exception 'invalid offer / booking / token association' using errcode='23514'; end if;
 end if;
 return new;
end;
$$;
create trigger crm_provider_events_offline_guard before insert on public.crm_provider_events_offline
 for each row execute function private.guard_offline_revenue_evidence();
create trigger crm_booking_offer_links_shadow_guard before insert on public.crm_booking_offer_links_shadow
 for each row execute function private.guard_offline_revenue_evidence();
create trigger crm_provider_events_offline_immutable before update or delete on public.crm_provider_events_offline
 for each row execute function private.block_shadow_evidence_modification();
create trigger crm_booking_offer_links_shadow_immutable before update or delete on public.crm_booking_offer_links_shadow
 for each row execute function private.block_shadow_evidence_modification();

alter table public.crm_provider_events_offline enable row level security;
alter table public.crm_booking_offer_links_shadow enable row level security;
revoke all on public.crm_provider_events_offline, public.crm_booking_offer_links_shadow from public,anon,authenticated;
grant select on public.crm_provider_events_offline, public.crm_booking_offer_links_shadow to authenticated;
create policy crm_provider_events_offline_finance_read on public.crm_provider_events_offline
 for select to authenticated using(private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
create policy crm_booking_offer_links_shadow_finance_read on public.crm_booking_offer_links_shadow
 for select to authenticated using(private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
comment on table public.crm_provider_events_offline is 'Only offline signed fixtures; HMAC verified by offline parser, no external ingress or causal/financial claim.';
comment on table public.crm_booking_offer_links_shadow is 'Observed Core booking to tracked Offer association, not a proven incremental or billable conversion.';
