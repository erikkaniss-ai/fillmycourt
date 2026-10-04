alter table public.booking_holds
  add column if not exists quote jsonb not null default '{}'::jsonb;

create table if not exists public.court_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  court_id uuid not null references public.courts(id) on delete cascade,
  weekday smallint check (weekday between 0 and 6),
  start_minute smallint not null default 0 check (start_minute between 0 and 1439),
  end_minute smallint not null default 1440 check (end_minute between 1 and 1440 and end_minute > start_minute),
  price_minor integer not null check (price_minor >= 0),
  currency char(3) not null default 'EUR',
  active boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now()
);
create index if not exists court_rates_lookup_idx on public.court_rates(court_id,active,weekday,start_minute,end_minute,priority);

create table if not exists public.court_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  court_id uuid not null references public.courts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists court_blocks_lookup_idx on public.court_blocks(court_id,starts_at,ends_at);
create index if not exists court_blocks_org_idx on public.court_blocks(organization_id,starts_at desc);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null,
  kind text not null,
  fingerprint text not null,
  status text not null default 'staged' check (status in ('staged','committed','rolled_back','failed')),
  payload jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  rolled_back_at timestamptz,
  unique (organization_id,source,kind,fingerprint)
);
create index if not exists import_batches_org_idx on public.import_batches(organization_id,created_at desc);

create table if not exists public.provider_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_connection_id uuid not null references public.provider_connections(id) on delete cascade,
  stream text not null,
  external_id text,
  fingerprint text not null,
  observed_at timestamptz not null default now(),
  window_start timestamptz,
  window_end timestamptz,
  complete boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(provider_connection_id,stream,fingerprint)
);
create index if not exists provider_observations_org_idx on public.provider_observations(organization_id,stream,observed_at desc);
create index if not exists provider_observations_external_idx on public.provider_observations(provider_connection_id,stream,external_id) where external_id is not null;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','leased','done','failed','dead')),
  attempts integer not null default 0,
  due_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,kind,dedupe_key)
);
create index if not exists jobs_due_idx on public.jobs(status,due_at,lease_until);
create index if not exists jobs_org_idx on public.jobs(organization_id,created_at desc);

alter table public.court_rates enable row level security;
alter table public.court_blocks enable row level security;
alter table public.import_batches enable row level security;
alter table public.provider_observations enable row level security;
alter table public.jobs enable row level security;

create policy court_rates_read on public.court_rates for select using (private.is_org_member(organization_id));
create policy court_rates_write on public.court_rates for all
  using (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));

create policy court_blocks_read on public.court_blocks for select using (private.is_org_member(organization_id));
create policy court_blocks_write on public.court_blocks for all
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));

create policy import_batches_read on public.import_batches for select using (private.is_org_member(organization_id));
create policy import_batches_write on public.import_batches for all
  using (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));

create policy provider_observations_read on public.provider_observations for select
  using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy jobs_read on public.jobs for select
  using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
