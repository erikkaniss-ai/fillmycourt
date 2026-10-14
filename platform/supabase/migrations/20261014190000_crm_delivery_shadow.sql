-- FMC-CRM-D01: non-live delivery evidence foundation. No send transport or live executor.
create table public.crm_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_id uuid not null references public.crm_actions(id) on delete cascade,
  offer_id uuid not null references public.crm_offers(id) on delete cascade,
  audience_id uuid not null references public.crm_action_audience(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email')),
  adapter text not null default 'null' check (adapter='null'),
  attempt_number integer not null default 1 check (attempt_number>0),
  business_key text not null unique,
  status text not null default 'created' check (status in ('created','shadow_simulated')),
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action_id,offer_id,audience_id,attempt_number)
);
create index crm_delivery_attempts_org_action_idx on public.crm_delivery_attempts(organization_id,action_id,created_at);
create index crm_delivery_attempts_offer_idx on public.crm_delivery_attempts(offer_id);
create index crm_delivery_attempts_audience_idx on public.crm_delivery_attempts(audience_id);
create index crm_delivery_attempts_person_idx on public.crm_delivery_attempts(person_id);

create table public.crm_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  attempt_id uuid not null references public.crm_delivery_attempts(id) on delete cascade,
  event_key text not null unique,
  event_type text not null check (event_type in
    ('CREATED','QUEUED','SHADOW_SIMULATED','PROVIDER_ACCEPTED','DELIVERED',
     'READ','CLICKED','REPLIED','FAILED_TRANSIENT','RETRY_SCHEDULED',
     'FAILED_PERMANENT','OPT_OUT','BOOKING_STARTED','PAYMENT_STARTED',
     'BOOKING_CONFIRMED','BOOKING_FAILED','ABANDONED')),
  source text not null default 'null' check (source in ('null','internal')),
  provider_event_id text,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb,
  unique (source,provider_event_id)
);
create index crm_delivery_events_attempt_time_idx on public.crm_delivery_events(attempt_id,occurred_at,id);
create index crm_delivery_events_org_time_idx on public.crm_delivery_events(organization_id,received_at desc);

create function private.guard_crm_delivery_links() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='crm_delivery_attempts' then
    if not exists (
      select 1 from public.crm_actions a
      join public.crm_offers o on o.action_id=a.id
      join public.crm_action_audience au on au.action_id=a.id
      where a.id=new.action_id and a.organization_id=new.organization_id
        and o.id=new.offer_id and o.organization_id=new.organization_id
        and au.id=new.audience_id and au.organization_id=new.organization_id
        and au.person_id=new.person_id and au.channel=new.channel
        and o.wave_number=au.wave_number
    ) then raise exception 'crm delivery reference/tenant mismatch' using errcode='23514'; end if;
    if new.adapter<>'null' or new.provider_message_id is not null then
      raise exception 'live delivery adapter disabled' using errcode='23514';
    end if;
  elsif tg_table_name='crm_delivery_events' then
    if not exists (
      select 1 from public.crm_delivery_attempts a
      where a.id=new.attempt_id and a.organization_id=new.organization_id
    ) then raise exception 'delivery event tenant mismatch' using errcode='23514'; end if;
    if new.event_type not in ('CREATED','SHADOW_SIMULATED')
       or new.source<>'null' or new.provider_event_id is not null then
      raise exception 'live delivery events disabled' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger crm_delivery_attempt_org_guard before insert or update on public.crm_delivery_attempts
for each row execute function private.guard_crm_delivery_links();
create trigger crm_delivery_event_org_guard before insert on public.crm_delivery_events
for each row execute function private.guard_crm_delivery_links();

create function private.block_delivery_event_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'delivery events are append-only' using errcode='23514';
end;
$$;
create trigger crm_delivery_events_immutable before update or delete on public.crm_delivery_events
for each row execute function private.block_delivery_event_mutation();

alter table public.crm_delivery_attempts enable row level security;
alter table public.crm_delivery_events enable row level security;
revoke all on public.crm_delivery_attempts,public.crm_delivery_events from public,anon,authenticated;
grant select on public.crm_delivery_attempts,public.crm_delivery_events to authenticated;

create policy crm_delivery_attempts_finance_read on public.crm_delivery_attempts
for select to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
create policy crm_delivery_events_finance_read on public.crm_delivery_events
for select to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

comment on table public.crm_delivery_attempts is
'FMC #81-#87: shadow-only, idempotent attempts. No live transport in this migration.';
comment on table public.crm_delivery_events is
'Append-only canonical audit. Only CREATED/SHADOW_SIMULATED permitted until separately authorized live-adapter migration.';
