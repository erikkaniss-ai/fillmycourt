create table public.revenue_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  court_id uuid not null references public.courts(id) on delete cascade,
  opportunity_key text not null,
  target_date date not null,
  window_starts_at timestamptz not null,
  window_ends_at timestamptz not null,
  recommended_starts_at timestamptz,
  duration_minutes smallint,
  quote_amount_minor integer not null default 0 check (quote_amount_minor >= 0),
  currency char(3) not null,
  status text not null default 'detected'
    check (status in ('detected','qualified','actionable','in_progress','won','lost','expired','suppressed')),
  active_demand_count integer not null default 0 check (active_demand_count >= 0),
  demand_fit_score numeric(5,2) not null default 0 check (demand_fit_score between 0 and 100),
  freshness_confidence numeric(4,3) not null default 0 check (freshness_confidence between 0 and 1),
  organic_baseline_probability numeric(4,3) not null default 0 check (organic_baseline_probability between 0 and 1),
  action_conversion_probability numeric(4,3) not null default 0 check (action_conversion_probability between 0 and 1),
  expected_incremental_contribution_minor integer not null default 0,
  priority_score numeric(5,2) not null default 0 check (priority_score between 0 and 100),
  source_breakdown jsonb not null default '{}'::jsonb,
  action_plan jsonb not null default '[]'::jsonb,
  explanation jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  qualified_at timestamptz,
  actionable_at timestamptz,
  in_progress_at timestamptz,
  closed_at timestamptz,
  last_evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, opportunity_key)
);

create index revenue_opportunities_org_date_priority_idx
on public.revenue_opportunities(organization_id,target_date,status,expected_incremental_contribution_minor desc,priority_score desc);

create index revenue_opportunities_court_window_idx
on public.revenue_opportunities(court_id,window_starts_at,window_ends_at);

create index revenue_opportunities_venue_idx
on public.revenue_opportunities(venue_id);

alter table public.revenue_opportunities enable row level security;

revoke all on table public.revenue_opportunities from anon;
grant select,insert,update on table public.revenue_opportunities to authenticated;

create policy revenue_opportunities_member_read
on public.revenue_opportunities
for select
to authenticated
using (private.is_org_member(organization_id));

create policy revenue_opportunities_manager_insert
on public.revenue_opportunities
for insert
to authenticated
with check (
  private.has_org_role(
    organization_id,
    array['owner','admin','manager','analyst']::public.fmc_member_role[]
  )
);

create policy revenue_opportunities_manager_update
on public.revenue_opportunities
for update
to authenticated
using (
  private.has_org_role(
    organization_id,
    array['owner','admin','manager','analyst']::public.fmc_member_role[]
  )
)
with check (
  private.has_org_role(
    organization_id,
    array['owner','admin','manager','analyst']::public.fmc_member_role[]
  )
);
