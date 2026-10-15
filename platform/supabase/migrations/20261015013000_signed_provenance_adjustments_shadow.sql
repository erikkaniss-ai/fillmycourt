-- FMC-REV-F08 — verified OFFLINE fixture provenance and shadow-only
-- adjustment observations. NO provider webhook ingress or real refunds/fees.
create table public.crm_provider_signature_receipts_shadow (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 provider_event_id uuid not null unique
     references public.crm_provider_events_offline(id) on delete restrict,
 provider_connection_id uuid not null
     references public.provider_connections(id) on delete restrict,
 event_key char(64) not null unique,
 payload_sha256 char(64) not null,
 signature_digest char(64) not null check(signature_digest ~ '^[a-f0-9]{64}$'),
 signed_epoch bigint not null,
 verification_scheme text not null default 'hmac-sha256-ts-v1'
     check(verification_scheme='hmac-sha256-ts-v1'),
 source_mode text not null default 'offline_fixture'
     check(source_mode='offline_fixture'),
 causal_evidence_verified boolean not null default false
     check(causal_evidence_verified=false),
 observed_at timestamptz not null default now()
);
create index crm_provider_signature_receipts_org_idx
 on public.crm_provider_signature_receipts_shadow(organization_id,provider_connection_id,observed_at desc);
create index crm_provider_signature_receipts_conn_idx
 on public.crm_provider_signature_receipts_shadow(provider_connection_id);

create function private.guard_offline_signature_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists (
   select 1 from public.crm_provider_events_offline p
   join public.provider_connections c on c.id=p.provider_connection_id
   where p.id=new.provider_event_id
     and p.organization_id=new.organization_id
     and p.provider_connection_id=new.provider_connection_id
     and c.organization_id=new.organization_id
     and p.event_key=new.event_key and p.payload_sha256=new.payload_sha256
     and p.signed_at=to_timestamp(new.signed_epoch)
 ) then
   raise exception 'signature receipt does not match signed offline event/source'
     using errcode='23514';
 end if;
 return new;
end; $$;
create trigger crm_provider_signature_receipts_integrity
 before insert on public.crm_provider_signature_receipts_shadow
 for each row execute function private.guard_offline_signature_receipt();
create trigger crm_provider_signature_receipts_immutable
 before update or delete on public.crm_provider_signature_receipts_shadow
 for each row execute function private.block_shadow_evidence_modification();
alter table public.crm_provider_signature_receipts_shadow enable row level security;
revoke all on public.crm_provider_signature_receipts_shadow from public,anon,authenticated;
grant select on public.crm_provider_signature_receipts_shadow to authenticated;
create policy crm_provider_signature_receipts_finance_read
 on public.crm_provider_signature_receipts_shadow for select to authenticated
 using(private.has_org_role(organization_id,
 array['owner','admin','manager','analyst']::public.fmc_member_role[]));
comment on table public.crm_provider_signature_receipts_shadow is
 'Internal fixture-only HMAC validation receipt; NEVER independent provider/payment/CRM causal proof.';

-- Historical adjustment schema was foundation-only and never allowed billing.
-- This is a non-destructive extension; staging has no existing adjustments.
alter table public.crm_attribution_adjustments
 add column source_observation_id uuid
 references public.crm_shadow_reconciliation_observations(id) on delete restrict;
create index crm_attribution_adjustments_source_observation_idx
 on public.crm_attribution_adjustments(source_observation_id)
 where source_observation_id is not null;

create function private.guard_shadow_adjustment_insert() returns trigger
language plpgsql security invoker set search_path='' as $$
declare observed record;
declare actor_role text;
begin
 if new.source_observation_id is null or new.delta_minor<>0
    or new.kind not in ('cancellation','provider_correction')
    or coalesce(new.evidence->>'shadow_only','')<>'true'
    or coalesce(new.evidence->>'financial_execution','')<>'false'
    or coalesce(new.evidence->>'causal_evidence_verified','')<>'false'
 then
    raise exception 'financial adjustment not authorized' using errcode='23514';
 end if;
 select r.id,r.organization_id,r.booking_id,r.event_key,
        r.booking_status,r.provider_claim,r.shadow_maturity,r.review_required,
        a.id as attribution_id
 into observed
 from public.crm_shadow_reconciliation_observations r
 join public.crm_attribution_records a
   on a.booking_id=r.booking_id and a.organization_id=r.organization_id
 where r.id=new.source_observation_id and a.id=new.attribution_id
   and r.organization_id=new.organization_id;
 if not found then
   raise exception 'cross-tenant / mismatched adjustment source' using errcode='23514';
 end if;
 if new.correction_reference <> ('shadow:' || trim(observed.event_key) || ':' || new.kind) then
   raise exception 'invalid deterministic adjustment reference' using errcode='23514';
 end if;
 if new.kind='cancellation' and
    (observed.booking_status<>'cancelled'
      or observed.shadow_maturity not in ('unverified','disputed')) then
   raise exception 'cancellation requires authoritative Core state' using errcode='23514';
 end if;
 if new.kind='provider_correction' and not (
    observed.provider_claim is not null and observed.review_required
      and observed.shadow_maturity='disputed') then
   raise exception 'unreviewed or unsupported provider claim' using errcode='23514';
 end if;
 select m.role::text into actor_role from public.organization_members m
 where m.organization_id=new.organization_id and m.user_id=new.created_by;
 if actor_role is null or actor_role not in ('owner','admin','manager') then
   raise exception 'manager authority required for shadow adjustment' using errcode='23514';
 end if;
 return new;
end; $$;
create trigger crm_attribution_adjustments_shadow_guard
 before insert on public.crm_attribution_adjustments
 for each row execute function private.guard_shadow_adjustment_insert();
comment on table public.crm_attribution_adjustments is
 'Append-only adjustments: until separate live activation, ONLY nonbillable zero-delta evidence observations linked to Core reconciliation. No real refunds, invoices, fees or settlement.';
