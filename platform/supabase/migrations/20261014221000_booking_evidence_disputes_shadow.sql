-- FMC-REV-F04: authoritative Core snapshot evidence and guarded dispute reviews.
-- Staging-only API; no external provider webhook, send, fee, payment or billing executor.
create table public.crm_booking_evidence (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 event_key text not null unique,
 source_kind text not null default 'core_snapshot' check(source_kind='core_snapshot'),
 booking_status text not null,
 booking_source text not null,
 authoritative_updated_at timestamptz not null,
 observed_at timestamptz not null default now(),
 evidence jsonb not null default '{}'::jsonb
);
create index crm_booking_evidence_org_booking_idx
 on public.crm_booking_evidence(organization_id,booking_id,observed_at desc);
create index crm_booking_evidence_booking_idx on public.crm_booking_evidence(booking_id);

create table public.crm_dispute_decisions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 case_id uuid not null references public.crm_dispute_cases(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete restrict,
 event_key text not null unique,
 ingest_seq bigint generated always as identity unique,
 transition text not null check(transition in ('PROPOSED','APPROVED','RESOLVED')),
 before_state text not null,
 after_state text not null,
 evidence jsonb not null default '{}'::jsonb,
 occurred_at timestamptz not null default now()
);
create index crm_dispute_decisions_case_idx
 on public.crm_dispute_decisions(case_id,occurred_at,id);
create index crm_dispute_decisions_org_idx
 on public.crm_dispute_decisions(organization_id,occurred_at desc);
create index crm_dispute_decisions_actor_idx
 on public.crm_dispute_decisions(actor_id);

create function private.guard_revenue_shadow_integrity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='crm_booking_evidence' then
   if not exists (select 1 from public.bookings b
       where b.id=new.booking_id and b.organization_id=new.organization_id)
   then raise exception 'cross-tenant booking evidence blocked' using errcode='23514'; end if;
 elsif tg_table_name='crm_dispute_decisions' then
   if not exists (select 1 from public.crm_dispute_cases d
       where d.id=new.case_id and d.organization_id=new.organization_id)
   then raise exception 'cross-tenant dispute decision blocked' using errcode='23514'; end if;
   if not exists (select 1 from public.organization_members m
       where m.organization_id=new.organization_id and m.user_id=new.actor_id)
   then raise exception 'unapproved dispute actor' using errcode='23514'; end if;
 elsif tg_table_name='crm_attribution_records' then
   if not exists (select 1 from public.bookings b
       where b.id=new.booking_id and b.organization_id=new.organization_id)
   then raise exception 'cross-tenant attribution blocked' using errcode='23514'; end if;
   if (new.primary_action_id is not null and not exists (
       select 1 from public.crm_actions a join public.crm_offers o on o.action_id=a.id
       where a.id=new.primary_action_id and o.id=new.primary_offer_id
         and a.organization_id=new.organization_id and o.organization_id=new.organization_id
   )) then raise exception 'cross-tenant primary offer blocked' using errcode='23514'; end if;
   if new.billable or new.fee_minor<>0 then
      raise exception 'finance execution remains disabled' using errcode='23514'; end if;
   if new.maturity='finalized' and (
      new.primary_offer_id is null or new.confidence not in ('direct','strong_inferred')
      or coalesce(new.evidence_snapshot->>'causal_evidence_verified','false')<>'true'
   ) then raise exception 'verified causal evidence required to finalize attribution' using errcode='23514'; end if;
   if tg_op='UPDATE' and old.maturity in ('finalized','adjusted') then
      raise exception 'finalized attribution immutable; use adjustments' using errcode='23514'; end if;
 elsif tg_table_name='crm_dispute_cases' then
   if new.attribution_id is not null and not exists (
       select 1 from public.crm_attribution_records a
       where a.id=new.attribution_id and a.organization_id=new.organization_id
   ) then raise exception 'cross-tenant dispute attribution blocked' using errcode='23514'; end if;
   if new.reconciliation_item_id is not null and not exists (
       select 1 from public.reconciliation_items i
       where i.id=new.reconciliation_item_id and i.organization_id=new.organization_id
   ) then raise exception 'cross-tenant dispute reconciliation blocked' using errcode='23514'; end if;
 end if;
 return new;
end;
$$;
create trigger crm_booking_evidence_tenant_guard before insert on public.crm_booking_evidence
 for each row execute function private.guard_revenue_shadow_integrity();
create trigger crm_dispute_decisions_tenant_guard before insert on public.crm_dispute_decisions
 for each row execute function private.guard_revenue_shadow_integrity();
create trigger crm_attribution_shadow_guard before insert or update on public.crm_attribution_records
 for each row execute function private.guard_revenue_shadow_integrity();
create trigger crm_dispute_cases_tenant_guard before insert or update on public.crm_dispute_cases
 for each row execute function private.guard_revenue_shadow_integrity();

create function private.block_shadow_evidence_modification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and current_setting('fmc.allow_finance_purge',true)='on' then
    return old;
 end if;
 raise exception 'authoritative evidence and dispute decisions are append-only'
   using errcode='23514';
end;
$$;
create trigger crm_booking_evidence_append_only before update or delete on public.crm_booking_evidence
 for each row execute function private.block_shadow_evidence_modification();
create trigger crm_dispute_decisions_append_only before update or delete on public.crm_dispute_decisions
 for each row execute function private.block_shadow_evidence_modification();

alter table public.crm_booking_evidence enable row level security;
alter table public.crm_dispute_decisions enable row level security;
revoke all on public.crm_booking_evidence,public.crm_dispute_decisions from public,anon,authenticated;
grant select on public.crm_booking_evidence,public.crm_dispute_decisions to authenticated;
create policy crm_booking_evidence_finance_read on public.crm_booking_evidence
 for select to authenticated
 using(private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
create policy crm_dispute_decisions_finance_read on public.crm_dispute_decisions
 for select to authenticated
 using(private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));

comment on table public.crm_booking_evidence is
 'Immutable observed Core booking snapshot only. Not provider/payment confirmation and not proof of message delivery.';
comment on table public.crm_dispute_decisions is
 'Shadow review event history. Only server-authorized actors; no payment/refund or commission write.';
