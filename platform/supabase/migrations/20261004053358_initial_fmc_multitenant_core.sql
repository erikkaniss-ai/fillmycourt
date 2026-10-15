create extension if not exists pgcrypto;

create type public.fmc_member_role as enum ('owner','admin','manager','front_desk','analyst','support');
create type public.fmc_booking_status as enum ('held','pending_payment','confirmed','cancelled','refunded','partially_refunded','completed','no_show');
create type public.fmc_inventory_mode as enum ('shadow','native','handoff');
create type public.fmc_recon_status as enum ('open','assigned','proposed','approved','resolved','ignored');
create type public.fmc_recon_severity as enum ('info','warning','critical');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  default_currency char(3) not null default 'EUR',
  timezone text not null default 'Europe/Lisbon',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.fmc_member_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);
create index organization_members_user_idx on public.organization_members(user_id,organization_id);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  external_key text,
  full_name text,
  email text,
  phone text,
  marketing_consent boolean,
  source text not null default 'fmc',
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,source,external_key)
);
create index people_org_email_idx on public.people(organization_id,lower(email)) where email is not null;
create index people_org_phone_idx on public.people(organization_id,phone) where phone is not null;
create index people_auth_user_idx on public.people(auth_user_id) where auth_user_id is not null;

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  timezone text not null default 'Europe/Lisbon',
  currency char(3) not null default 'EUR',
  address jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index venues_org_idx on public.venues(organization_id,active);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  sport text not null,
  indoor boolean,
  active boolean not null default true,
  inventory_mode public.fmc_inventory_mode not null default 'shadow',
  native_write_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (venue_id,name)
);
create index courts_venue_active_idx on public.courts(venue_id,active);

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  status text not null default 'pending',
  capabilities jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id,provider)
);

create table public.provider_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_connection_id uuid not null references public.provider_connections(id) on delete cascade,
  entity_type text not null,
  local_id uuid not null,
  external_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider_connection_id,entity_type,external_id)
);
create index provider_mappings_local_idx on public.provider_mappings(organization_id,entity_type,local_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venue_id uuid not null references public.venues(id),
  court_id uuid not null references public.courts(id),
  player_id uuid references public.people(id),
  status public.fmc_booking_status not null default 'held',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  currency char(3) not null,
  gross_amount_minor integer not null default 0 check (gross_amount_minor >= 0),
  source text not null default 'fmc',
  external_reference text,
  idempotency_key text,
  cancellation_policy_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (organization_id,idempotency_key)
);
create index bookings_org_time_idx on public.bookings(organization_id,starts_at desc);
create index bookings_court_time_idx on public.bookings(court_id,starts_at,ends_at);
create index bookings_player_idx on public.bookings(organization_id,player_id,starts_at desc);
create unique index bookings_external_ref_idx on public.bookings(organization_id,source,external_reference) where external_reference is not null;

create table public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  court_id uuid not null references public.courts(id),
  player_id uuid references public.people(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (organization_id,idempotency_key)
);
create index booking_holds_court_expiry_idx on public.booking_holds(court_id,expires_at);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  provider text not null,
  external_reference text,
  kind text not null,
  status text not null,
  currency char(3) not null,
  amount_minor integer not null,
  fee_minor integer,
  payout_reference text,
  occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id,provider,external_reference,kind)
);
create index payments_booking_idx on public.payments(organization_id,booking_id);
create index payments_payout_idx on public.payments(organization_id,payout_reference) where payout_reference is not null;

create table public.sync_cursors (
  provider_connection_id uuid not null references public.provider_connections(id) on delete cascade,
  stream text not null,
  cursor jsonb not null default '{}'::jsonb,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error text,
  primary key(provider_connection_id,stream)
);

create table public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_connection_id uuid references public.provider_connections(id) on delete set null,
  scope text not null,
  window_start timestamptz,
  window_end timestamptz,
  status text not null default 'running',
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index recon_runs_org_idx on public.reconciliation_runs(organization_id,started_at desc);

create table public.reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  external_reference text,
  category text not null,
  severity public.fmc_recon_severity not null default 'warning',
  status public.fmc_recon_status not null default 'open',
  expected jsonb not null default '{}'::jsonb,
  observed jsonb not null default '{}'::jsonb,
  assigned_to uuid references auth.users(id) on delete set null,
  proposed_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  resolution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index recon_items_queue_idx on public.reconciliation_items(organization_id,status,severity,created_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  before_state jsonb,
  after_state jsonb,
  request_id text,
  occurred_at timestamptz not null default now()
);
create index audit_events_org_time_idx on public.audit_events(organization_id,occurred_at desc);

create table public.domain_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  published_at timestamptz
);
create index domain_events_unpublished_idx on public.domain_events(id) where published_at is null;

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=auth.uid()) $$;

create or replace function public.has_org_role(target_org uuid, allowed public.fmc_member_role[])
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=auth.uid() and m.role=any(allowed)) $$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.people enable row level security;
alter table public.venues enable row level security;
alter table public.courts enable row level security;
alter table public.provider_connections enable row level security;
alter table public.provider_mappings enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_holds enable row level security;
alter table public.payments enable row level security;
alter table public.sync_cursors enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.reconciliation_items enable row level security;
alter table public.audit_events enable row level security;
alter table public.domain_events enable row level security;

create policy org_read on public.organizations for select using (public.is_org_member(id));
create policy members_read on public.organization_members for select using (public.is_org_member(organization_id));
create policy people_member_all on public.people for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy venues_member_all on public.venues for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy provider_conn_admin on public.provider_connections for all using (public.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[])) with check (public.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));
create policy provider_mapping_admin on public.provider_mappings for all using (public.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[])) with check (public.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));
create policy bookings_member_all on public.bookings for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy holds_member_all on public.booking_holds for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy payments_member_read on public.payments for select using (public.is_org_member(organization_id));
create policy sync_cursor_admin on public.sync_cursors for all using (exists(select 1 from public.provider_connections pc where pc.id=provider_connection_id and public.has_org_role(pc.organization_id,array['owner','admin']::public.fmc_member_role[]))) with check (exists(select 1 from public.provider_connections pc where pc.id=provider_connection_id and public.has_org_role(pc.organization_id,array['owner','admin']::public.fmc_member_role[])));
create policy recon_runs_member_read on public.reconciliation_runs for select using (public.is_org_member(organization_id));
create policy recon_items_member_all on public.reconciliation_items for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy audit_member_read on public.audit_events for select using (public.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
create policy events_admin_read on public.domain_events for select using (public.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));
create policy courts_member_all on public.courts for all
using (exists(select 1 from public.venues v where v.id=venue_id and public.is_org_member(v.organization_id)))
with check (exists(select 1 from public.venues v where v.id=venue_id and public.is_org_member(v.organization_id)));
