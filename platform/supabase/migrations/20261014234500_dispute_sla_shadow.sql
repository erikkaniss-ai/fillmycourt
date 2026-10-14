-- FMC-REV-F05: idempotent open dispute sources and append-only SLA breach evidence.
-- Pure shadow workflow, no billing, provider callbacks, outgoing notifications or payments.
create unique index crm_dispute_active_attribution_uniq
 on public.crm_dispute_cases(organization_id,attribution_id)
 where attribution_id is not null
   and status in ('open','pending_evidence','review','approved');
create unique index crm_dispute_active_reconciliation_uniq
 on public.crm_dispute_cases(organization_id,reconciliation_item_id)
 where reconciliation_item_id is not null
   and status in ('open','pending_evidence','review','approved');

create table public.crm_dispute_escalations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 case_id uuid not null references public.crm_dispute_cases(id) on delete cascade,
 kind text not null default 'sla_breached' check(kind='sla_breached'),
 policy_version text not null,
 risk text not null check(risk in ('low','medium','high')),
 sla_due_at timestamptz not null,
 next_responsible_role text not null check(next_responsible_role in ('finance','owner','owner_admin')),
 event_key text not null unique,
 observed_at timestamptz not null default now(),
 unique (case_id,policy_version,kind)
);
create index crm_dispute_escalations_org_idx
 on public.crm_dispute_escalations(organization_id,observed_at desc);

create function private.guard_dispute_escalation_tenant() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists (
   select 1 from public.crm_dispute_cases d
   where d.id=new.case_id and d.organization_id=new.organization_id
     and d.policy_version=new.policy_version and d.risk=new.risk
 ) then
   raise exception 'cross-tenant or stale-policy escalation blocked' using errcode='23514';
 end if;
 return new;
end;
$$;
create trigger crm_dispute_escalation_tenant_guard
 before insert on public.crm_dispute_escalations
 for each row execute function private.guard_dispute_escalation_tenant();
create trigger crm_dispute_escalation_append_only
 before update or delete on public.crm_dispute_escalations
 for each row execute function private.block_shadow_evidence_modification();

alter table public.crm_dispute_escalations enable row level security;
revoke all on public.crm_dispute_escalations from public,anon,authenticated;
grant select on public.crm_dispute_escalations to authenticated;
create policy crm_dispute_escalations_finance_read on public.crm_dispute_escalations
 for select to authenticated
 using (private.has_org_role(organization_id,
   array['owner','admin','manager','analyst']::public.fmc_member_role[]));
comment on table public.crm_dispute_escalations is
 'Append-only SLA breach escalation evidence only; no customer messaging, assignments, automatic decisions or money movements.';
