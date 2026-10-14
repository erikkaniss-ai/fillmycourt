-- FMC-REV-F07: operator-triggered, non-financial reconciliation observations.
-- Immutable Core snapshot + offline fixture claims; NO automatic settlement.
create table public.crm_shadow_reconciliation_observations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 core_snapshot_key char(64) not null,
 offline_event_id uuid references public.crm_provider_events_offline(id) on delete restrict,
 event_key char(64) not null unique,
 booking_status text not null,
 provider_claim text check(provider_claim in ('pending','confirmed','cancelled','refunded','failed')),
 source_resolution text not null check(source_resolution in ('core_native','provider_unverified','provider_conflict')),
 shadow_maturity text not null check(shadow_maturity in ('pending_evidence','provisional','unverified','disputed')),
 reason text not null,
 review_required boolean not null default false,
 causal_evidence_verified boolean not null default false check(causal_evidence_verified=false),
 billable boolean not null default false check(billable=false),
 fee_minor integer not null default 0 check(fee_minor=0),
 observed_at timestamptz not null default now()
);
create index crm_shadow_recon_org_booking_idx
 on public.crm_shadow_reconciliation_observations(organization_id,booking_id,observed_at desc);
create index crm_shadow_recon_booking_idx
 on public.crm_shadow_reconciliation_observations(booking_id);
create index crm_shadow_recon_offline_idx
 on public.crm_shadow_reconciliation_observations(offline_event_id)
 where offline_event_id is not null;

create function private.guard_shadow_reconciliation_observation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists (
   select 1 from public.crm_booking_evidence e
   where e.organization_id=new.organization_id and e.booking_id=new.booking_id
     and e.event_key=new.core_snapshot_key and e.booking_status=new.booking_status
 ) then raise exception 'Core snapshot evidence mismatch' using errcode='23514'; end if;
 if new.offline_event_id is not null then
   if not exists (
     select 1 from public.crm_provider_events_offline p
     join public.bookings b on b.id=new.booking_id and b.organization_id=p.organization_id
     where p.id=new.offline_event_id and p.organization_id=new.organization_id
       and p.provider=b.source
       and p.booking_reference=b.external_reference
       and p.event_state=new.provider_claim
   ) then raise exception 'cross-tenant or wrong booking provider claim' using errcode='23514'; end if;
 elsif new.provider_claim is not null then
   raise exception 'provider claim requires linked fixture' using errcode='23514';
 end if;
 return new;
end;
$$;
create trigger crm_shadow_recon_integrity before insert
 on public.crm_shadow_reconciliation_observations
 for each row execute function private.guard_shadow_reconciliation_observation();
create trigger crm_shadow_recon_append_only before update or delete
 on public.crm_shadow_reconciliation_observations
 for each row execute function private.block_shadow_evidence_modification();
alter table public.crm_shadow_reconciliation_observations enable row level security;
revoke all on public.crm_shadow_reconciliation_observations from public,anon,authenticated;
grant select on public.crm_shadow_reconciliation_observations to authenticated;
create policy crm_shadow_recon_finance_read on public.crm_shadow_reconciliation_observations
 for select to authenticated
 using(private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

-- Database backstop for state machine and risk-based independent approvals.
-- Pre-existing shadow workflows preserve manager API guards; this adds integrity
-- when an internal trusted caller directly updates a case.
create function private.guard_shadow_dispute_transitions() returns trigger
language plpgsql security invoker set search_path='' as $$
declare approver_role text;
declare initiator_role text;
begin
 if old.organization_id<>new.organization_id
    or old.attribution_id is distinct from new.attribution_id
    or old.reconciliation_item_id is distinct from new.reconciliation_item_id
    or old.risk<>new.risk
    or old.policy_version<>new.policy_version
    or old.amount_at_risk_minor<>new.amount_at_risk_minor
    or old.currency<>new.currency
    or old.reason<>new.reason
 then raise exception 'dispute source and policy immutable' using errcode='23514'; end if;
 if old.status in ('resolved','unverified') then
   raise exception 'closed dispute case immutable' using errcode='23514'; end if;
 if old.approved_by is not null and new.approved_by is distinct from old.approved_by then
   raise exception 'approved identity immutable' using errcode='23514'; end if;
 if old.status<>new.status then
   if not ((old.status in ('open','pending_evidence') and new.status='review')
       or (old.status='review' and new.status='approved')
       or (old.status='approved' and new.status='resolved')) then
     raise exception 'illegal dispute state transition' using errcode='23514';
   end if;
   if new.status='review' then
     select m.role::text into initiator_role from public.organization_members m
      where m.organization_id=new.organization_id and m.user_id=new.initiated_by;
     if initiator_role is null or initiator_role not in ('owner','admin','manager') then
       raise exception 'review initiator lacks manager authority' using errcode='23514';
     end if;
   elsif new.status='approved' then
     select m.role::text into approver_role from public.organization_members m
      where m.organization_id=new.organization_id and m.user_id=new.approved_by;
     if new.initiated_by is null or new.approved_by is null
       or new.initiated_by=new.approved_by
       or approver_role is null or approver_role not in ('owner','admin','manager')
       or (new.risk='high' and approver_role not in ('owner','admin')) then
       raise exception 'independent risk-authorized approval required' using errcode='23514';
     end if;
   elsif new.status='resolved' and
       (new.approved_by is null or new.resolved_at is null) then
     raise exception 'approved resolution timestamp required' using errcode='23514';
   end if;
 end if;
 if new.status<>'review' and old.status=new.status
     and new.initiated_by is distinct from old.initiated_by then
   raise exception 'initiator change outside review prohibited' using errcode='23514'; end if;
 if old.status<>'open' and old.status<>'pending_evidence'
      and new.initiated_by is distinct from old.initiated_by then
   raise exception 'initiator immutable after proposal' using errcode='23514'; end if;
 if old.status=new.status and (
      new.resolution is distinct from old.resolution
      or new.approved_by is distinct from old.approved_by
      or new.resolved_at is distinct from old.resolved_at
 ) then raise exception 'silent dispute state mutation prohibited' using errcode='23514'; end if;
 return new;
end;
$$;
create trigger crm_dispute_transition_guard
 before update on public.crm_dispute_cases
 for each row execute function private.guard_shadow_dispute_transitions();

comment on table public.crm_shadow_reconciliation_observations is
 'Immutable nonbillable shadow reconciliation, Core canonical, provider fixtures unverified; no financial/refund or booking execution.';
