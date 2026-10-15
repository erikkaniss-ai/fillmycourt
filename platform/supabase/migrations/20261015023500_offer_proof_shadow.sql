-- FMC-REV-F09: non-causal Offer/booking evidence review ledger.
-- No external provider endpoint, live delivery, auto-booking or performance fees.
create table public.crm_offer_proof_reviews_shadow (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 core_snapshot_key char(64) not null,
 reconciliation_event_key char(64),
 event_key char(64) not null unique,
 outcome text not null check(outcome in (
   'BOOKING_NOT_ACTIVE','BOOKING_UNCONFIRMED','SOURCE_CONFLICT',
   'PROVIDER_NOT_AUTHORITATIVE','COMPETING_OFFERS','OBSERVED_ONLY',
   'STALE_LINK','NO_ASSOCIATION')),
 candidate_offer_ids jsonb not null default '[]'::jsonb
     check(jsonb_typeof(candidate_offer_ids)='array'),
 candidate_count integer not null default 0
     check(candidate_count >= 0),
 primary_offer_id uuid check(primary_offer_id is null),
 causal_evidence_verified boolean not null default false
     check(causal_evidence_verified=false),
 billable boolean not null default false check(billable=false),
 fee_minor integer not null default 0 check(fee_minor=0),
 review_required boolean not null default true,
 policy_version text not null default 'offer_proof_shadow_v1'
     check(policy_version='offer_proof_shadow_v1'),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 unique(organization_id,booking_id,event_key)
);
create index crm_offer_proof_reviews_org_idx
 on public.crm_offer_proof_reviews_shadow(organization_id,booking_id,created_at desc);
create index crm_offer_proof_reviews_booking_idx
 on public.crm_offer_proof_reviews_shadow(booking_id);
create index crm_offer_proof_reviews_creator_idx
 on public.crm_offer_proof_reviews_shadow(created_by);

create function private.guard_offer_proof_shadow() returns trigger
language plpgsql security invoker set search_path='' as $$
declare candidate jsonb;
declare candidate_id uuid;
declare expected_count integer;
begin
 if not exists (
    select 1 from public.crm_booking_evidence e
    join public.bookings b on b.id=e.booking_id and b.organization_id=e.organization_id
    where e.organization_id=new.organization_id
      and e.booking_id=new.booking_id
      and e.event_key=trim(new.core_snapshot_key)
      and e.authoritative_updated_at=b.updated_at
      and e.booking_status=b.status::text
      and e.booking_source=b.source
 ) then
    raise exception 'stale or cross-tenant Core booking snapshot'
      using errcode='23514';
 end if;
 if not exists (
    select 1 from public.organization_members m
    where m.organization_id=new.organization_id
      and m.user_id=new.created_by and m.role in ('owner','admin','manager')
 ) then
    raise exception 'unapproved evidence reviewer'
      using errcode='23514';
 end if;
 if new.reconciliation_event_key is not null and not exists (
     select 1 from public.crm_shadow_reconciliation_observations r
     where r.organization_id=new.organization_id
       and r.booking_id=new.booking_id
       and r.core_snapshot_key=trim(new.core_snapshot_key)
       and r.event_key=trim(new.reconciliation_event_key)
 ) then
     raise exception 'cross-tenant reconciliation linkage'
       using errcode='23514';
 end if;
 expected_count=jsonb_array_length(new.candidate_offer_ids);
 if new.candidate_count <> expected_count or expected_count>25 then
    raise exception 'invalid evidence candidate count' using errcode='23514';
 end if;
 for candidate in select value from jsonb_array_elements(new.candidate_offer_ids)
 loop
    if jsonb_typeof(candidate)<>'string' then
       raise exception 'invalid candidate identifier' using errcode='23514';
    end if;
    begin
       candidate_id=(trim(both '"' from candidate::text))::uuid;
    exception when invalid_text_representation then
       raise exception 'invalid candidate uuid' using errcode='23514';
    end;
    if not exists (
        select 1 from public.crm_booking_offer_links_shadow l
        join public.crm_offers o on o.id=l.offer_id and o.organization_id=l.organization_id
        where l.organization_id=new.organization_id
          and l.booking_id=new.booking_id
          and l.offer_id=candidate_id
          and l.booking_snapshot_key=trim(new.core_snapshot_key)
    ) then
       raise exception 'candidate lacks source-owned booking/Offer evidence'
         using errcode='23514';
    end if;
 end loop;
 if (select count(distinct value) from jsonb_array_elements(new.candidate_offer_ids))
    <> expected_count then
    raise exception 'duplicate candidates' using errcode='23514';
 end if;
 return new;
end; $$;
create trigger crm_offer_proof_reviews_integrity
 before insert on public.crm_offer_proof_reviews_shadow
 for each row execute function private.guard_offer_proof_shadow();
create trigger crm_offer_proof_reviews_append_only
 before update or delete on public.crm_offer_proof_reviews_shadow
 for each row execute function private.block_shadow_evidence_modification();
alter table public.crm_offer_proof_reviews_shadow enable row level security;
revoke all on public.crm_offer_proof_reviews_shadow from public,anon,authenticated;
grant select on public.crm_offer_proof_reviews_shadow to authenticated;
create policy crm_offer_proof_reviews_finance_read
 on public.crm_offer_proof_reviews_shadow for select to authenticated
 using(private.has_org_role(organization_id,
   array['owner','admin','manager','analyst']::public.fmc_member_role[]));
comment on table public.crm_offer_proof_reviews_shadow is
 'Append-only tenant-scoped Core booking↔Offer observation assessment. No causal winner or billable fees under any circumstances.';
