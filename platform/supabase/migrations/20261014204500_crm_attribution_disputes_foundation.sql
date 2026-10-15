-- FMC-REV-F02/F03: shadow financial attribution and dispute queue schema.
-- No billing/settlement/provider write executor in this migration.
create table public.crm_attribution_records (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete restrict,
 primary_action_id uuid references public.crm_actions(id) on delete set null,
 primary_offer_id uuid references public.crm_offers(id) on delete set null,
 confidence text not null default 'ambiguous'
  check (confidence in ('direct','strong_inferred','weak_modelled','ambiguous')),
 maturity text not null default 'provisional'
  check (maturity in ('provisional','pending_evidence','finalized','unverified','disputed','adjusted')),
 authority_source text not null default 'unknown',
 evidence_snapshot jsonb not null default '{}'::jsonb,
 assisted_actions jsonb not null default '[]'::jsonb,
 gross_attributed_minor integer not null default 0 check (gross_attributed_minor>=0),
 fee_minor integer not null default 0 check (fee_minor=0),
 billable boolean not null default false check (billable=false),
 policy_version text not null default 'attribution_shadow_v1',
 finalized_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id,booking_id),
 check ((primary_action_id is null and primary_offer_id is null) or
        (primary_action_id is not null and primary_offer_id is not null))
);
create index crm_attribution_booking_idx on public.crm_attribution_records(booking_id);
create index crm_attribution_action_idx on public.crm_attribution_records(primary_action_id) where primary_action_id is not null;
create index crm_attribution_offer_idx on public.crm_attribution_records(primary_offer_id) where primary_offer_id is not null;
create index crm_attribution_maturity_idx on public.crm_attribution_records(organization_id,maturity,created_at desc);

create table public.crm_attribution_adjustments (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 attribution_id uuid not null references public.crm_attribution_records(id) on delete restrict,
 kind text not null check (kind in ('cancellation','partial_refund','full_refund','chargeback','provider_correction')),
 delta_minor integer not null,
 evidence jsonb not null default '{}'::jsonb,
 correction_reference text not null,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique (attribution_id,correction_reference)
);
create index crm_attribution_adjustments_org_idx on public.crm_attribution_adjustments(organization_id,created_at desc);

create table public.crm_dispute_cases (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 attribution_id uuid references public.crm_attribution_records(id) on delete set null,
 reconciliation_item_id uuid references public.reconciliation_items(id) on delete set null,
 risk text not null check(risk in ('low','medium','high')),
 status text not null default 'open'
  check(status in ('open','pending_evidence','review','approved','resolved','unverified')),
 reason text not null,
 evidence jsonb not null default '{}'::jsonb,
 amount_at_risk_minor integer not null default 0 check(amount_at_risk_minor>=0),
 currency char(3) not null default 'EUR',
 assignee_id uuid references auth.users(id) on delete set null,
 initiated_by uuid references auth.users(id) on delete set null,
 approved_by uuid references auth.users(id) on delete set null,
 policy_version text not null default 'disputes_shadow_v1',
 sla_due_at timestamptz,
 resolution jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 check(initiated_by is null or approved_by is null or initiated_by<>approved_by)
);
create index crm_dispute_cases_org_queue_idx on public.crm_dispute_cases(organization_id,status,risk,sla_due_at);
create index crm_dispute_cases_attribution_idx on public.crm_dispute_cases(attribution_id);
create index crm_dispute_cases_reconciliation_idx on public.crm_dispute_cases(reconciliation_item_id);
create index crm_dispute_cases_assignee_idx on public.crm_dispute_cases(assignee_id) where assignee_id is not null;
create index crm_dispute_cases_initiated_idx on public.crm_dispute_cases(initiated_by) where initiated_by is not null;
create index crm_dispute_cases_approved_idx on public.crm_dispute_cases(approved_by) where approved_by is not null;

create function private.protect_attribution_adjustments() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and current_setting('fmc.allow_finance_purge',true)='on' then
   return old;
 end if;
 raise exception 'attribution adjustments are append-only' using errcode='23514';
end; $$;
create trigger crm_attribution_adjustments_append_only
 before update or delete on public.crm_attribution_adjustments
 for each row execute function private.protect_attribution_adjustments();

alter table public.crm_attribution_records enable row level security;
alter table public.crm_attribution_adjustments enable row level security;
alter table public.crm_dispute_cases enable row level security;
revoke all on public.crm_attribution_records,public.crm_attribution_adjustments,
 public.crm_dispute_cases from public,anon,authenticated;
grant select on public.crm_attribution_records,public.crm_attribution_adjustments,
 public.crm_dispute_cases to authenticated;

create policy crm_attribution_records_finance_read on public.crm_attribution_records
 for select to authenticated
 using(private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
create policy crm_attribution_adjustments_finance_read on public.crm_attribution_adjustments
 for select to authenticated
 using(private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
create policy crm_dispute_cases_finance_read on public.crm_dispute_cases
 for select to authenticated
 using(private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

comment on table public.crm_attribution_records is 'FMC #88-#92 shadow-only single-primary attribution; fee/billable hard-locked to zero/false.';
comment on table public.crm_attribution_adjustments is 'Append-only adjustment contract; no active settlement executor.';
comment on table public.crm_dispute_cases is 'FMC #93-#95 risk/authority/SLA queue; no automatic financial resolution.';
