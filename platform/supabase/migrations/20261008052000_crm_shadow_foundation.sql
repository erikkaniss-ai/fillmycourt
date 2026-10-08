create table public.communication_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email','sms','push')),
  purpose text not null default 'promotional',
  status text not null check (status in ('granted','denied','withdrawn','unknown')),
  consent_proof text,
  consent_at timestamptz,
  jurisdiction text,
  source text not null default 'manual',
  frequency_cap_count integer check (frequency_cap_count is null or frequency_cap_count > 0),
  frequency_cap_hours integer check (frequency_cap_hours is null or frequency_cap_hours > 0),
  last_contacted_at timestamptz,
  suppression_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,person_id,channel,purpose)
);

create index communication_permissions_person_idx
on public.communication_permissions(person_id,channel,purpose);
create index communication_permissions_org_status_idx
on public.communication_permissions(organization_id,channel,purpose,status);
create index communication_permissions_created_by_idx
on public.communication_permissions(created_by) where created_by is not null;

create table public.crm_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.revenue_opportunities(id) on delete cascade,
  mode text not null default 'shadow' check (mode in ('shadow','managed_live','autopilot')),
  status text not null default 'shadow_ready'
    check (status in ('shadow_ready','approval_pending','approved','stale','stopped','completed','cancelled')),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high')),
  primary_channel text not null default 'whatsapp' check (primary_channel in ('whatsapp','email')),
  fallback_channel text check (fallback_channel in ('whatsapp','email')),
  purpose text not null default 'promotional',
  message_template_key text not null default 'availability_current_price_v1',
  quote_amount_minor integer not null check (quote_amount_minor >= 0),
  currency char(3) not null,
  incentive_bps integer not null default 0 check (incentive_bps between 0 and 10000),
  expected_incremental_contribution_minor integer not null default 0,
  organic_baseline_probability numeric(4,3) not null default 0 check (organic_baseline_probability between 0 and 1),
  audience_total integer not null default 0,
  audience_eligible integer not null default 0,
  audience_blocked integer not null default 0,
  current_wave smallint not null default 1 check (current_wave > 0),
  execution_enabled boolean not null default false,
  opportunity_snapshot jsonb not null default '{}'::jsonb,
  economics_snapshot jsonb not null default '{}'::jsonb,
  policy_version text not null default 'crm_shadow_v1',
  opportunity_version_at_plan timestamptz not null,
  stop_reason text,
  stopped_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crm_actions_org_status_idx
on public.crm_actions(organization_id,status,created_at desc);
create index crm_actions_opportunity_idx
on public.crm_actions(opportunity_id,created_at desc);
create index crm_actions_created_by_idx
on public.crm_actions(created_by) where created_by is not null;

create table public.crm_action_audience (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_id uuid not null references public.crm_actions(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  permission_id uuid references public.communication_permissions(id) on delete set null,
  eligibility text not null check (eligibility in ('eligible','blocked')),
  channel text check (channel in ('whatsapp','email')),
  segment_key text not null,
  segment_rank smallint not null check (segment_rank > 0),
  relevance_score numeric(5,2) not null default 0 check (relevance_score between 0 and 100),
  wave_number smallint check (wave_number is null or wave_number > 0),
  exclusion_reason text,
  person_snapshot jsonb not null default '{}'::jsonb,
  permission_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (action_id,person_id)
);

create index crm_action_audience_action_wave_idx
on public.crm_action_audience(action_id,eligibility,wave_number,segment_rank,relevance_score desc);
create index crm_action_audience_person_idx
on public.crm_action_audience(person_id,created_at desc);
create index crm_action_audience_permission_idx
on public.crm_action_audience(permission_id) where permission_id is not null;
create index crm_action_audience_org_idx
on public.crm_action_audience(organization_id,action_id);

create table public.crm_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_id uuid not null references public.crm_actions(id) on delete cascade,
  opportunity_id uuid not null references public.revenue_opportunities(id) on delete cascade,
  wave_number smallint not null default 1 check (wave_number > 0),
  tracking_token text not null unique,
  status text not null default 'shadow' check (status in ('shadow','active','expired','stopped','converted')),
  target_court_id uuid not null references public.courts(id) on delete cascade,
  target_starts_at timestamptz not null,
  target_ends_at timestamptz not null,
  authoritative_price_minor integer not null check (authoritative_price_minor >= 0),
  incentive_bps integer not null default 0 check (incentive_bps between 0 and 10000),
  offered_price_minor integer not null check (offered_price_minor >= 0),
  currency char(3) not null,
  expires_at timestamptz not null,
  attribution_window_ends_at timestamptz not null,
  booking_destination text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crm_offers_action_idx on public.crm_offers(action_id,wave_number,status);
create index crm_offers_org_idx on public.crm_offers(organization_id,status);
create index crm_offers_opportunity_idx on public.crm_offers(opportunity_id,status);
create index crm_offers_target_idx on public.crm_offers(target_court_id,target_starts_at,target_ends_at);

create table public.crm_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_id uuid not null references public.crm_actions(id) on delete cascade,
  approver_user_id uuid not null references auth.users(id) on delete restrict,
  approver_role public.fmc_member_role not null,
  status text not null check (status in ('approved','rejected','stale')),
  policy_version text not null,
  audience_snapshot jsonb not null default '{}'::jsonb,
  offer_snapshot jsonb not null default '{}'::jsonb,
  economics_snapshot jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index crm_approvals_action_idx on public.crm_approvals(action_id,created_at desc);
create index crm_approvals_org_idx on public.crm_approvals(organization_id,created_at desc);
create index crm_approvals_approver_idx on public.crm_approvals(approver_user_id,created_at desc);

alter table public.communication_permissions enable row level security;
alter table public.crm_actions enable row level security;
alter table public.crm_action_audience enable row level security;
alter table public.crm_offers enable row level security;
alter table public.crm_approvals enable row level security;

revoke all on table public.communication_permissions,public.crm_actions,public.crm_action_audience,public.crm_offers,public.crm_approvals from anon;
grant select,insert,update on table public.communication_permissions,public.crm_actions,public.crm_action_audience,public.crm_offers to authenticated;
grant select,insert on table public.crm_approvals to authenticated;

create policy communication_permissions_finance_read on public.communication_permissions
for select to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy communication_permissions_manager_insert on public.communication_permissions
for insert to authenticated
with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));

create policy communication_permissions_manager_update on public.communication_permissions
for update to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]))
with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));

create policy crm_actions_finance_read on public.crm_actions
for select to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_actions_finance_insert on public.crm_actions
for insert to authenticated
with check (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_actions_finance_update on public.crm_actions
for update to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]))
with check (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_action_audience_finance_read on public.crm_action_audience
for select to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_action_audience_finance_insert on public.crm_action_audience
for insert to authenticated
with check (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_action_audience_finance_update on public.crm_action_audience
for update to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]))
with check (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_offers_finance_read on public.crm_offers
for select to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_offers_finance_insert on public.crm_offers
for insert to authenticated
with check (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_offers_finance_update on public.crm_offers
for update to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]))
with check (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_approvals_finance_read on public.crm_approvals
for select to authenticated
using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

create policy crm_approvals_manager_insert on public.crm_approvals
for insert to authenticated
with check (
  approver_user_id=(select auth.uid())
  and private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[])
);
