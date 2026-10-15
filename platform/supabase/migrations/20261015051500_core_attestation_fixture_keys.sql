-- FMC-REV-F11: offline-only Ed25519 Core-shaped fixture verification.
-- Trust registry deliberately admits fixture_only keys, no real Core issuer or
-- browser sign route, no real booking/payment/provider/CRM write authority.
create table public.crm_core_attestation_fixture_keys (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 issuer_instance_id uuid not null,
 key_id char(64) not null check (key_id ~ '^[a-f0-9]{64}$'),
 public_key_hex char(64) not null check(public_key_hex ~ '^[a-f0-9]{64}$'),
 registered_by uuid not null references auth.users(id) on delete restrict,
 trust_mode text not null default 'fixture_only' check(trust_mode='fixture_only'),
 valid_from timestamptz not null,
 valid_until timestamptz not null,
 created_at timestamptz not null default now(),
 unique(organization_id,issuer_instance_id,key_id),
 check(valid_until>valid_from)
);
create index crm_core_attestation_fixture_keys_org_idx
 on public.crm_core_attestation_fixture_keys(organization_id,issuer_instance_id);

create function private.guard_core_fixture_key() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.organization_members m
    where m.organization_id=new.organization_id
      and m.user_id=new.registered_by and m.role in ('owner','admin')) then
   raise exception 'fixture key requires owner/admin registrant' using errcode='23514';
 end if;
 if new.key_id <> encode(sha256(decode(trim(new.public_key_hex),'hex')),'hex') then
   raise exception 'incorrect public key fingerprint' using errcode='23514';
 end if;
 return new;
end; $$;
create trigger crm_core_fixture_key_integrity
 before insert on public.crm_core_attestation_fixture_keys
 for each row execute function private.guard_core_fixture_key();
create trigger crm_core_fixture_key_immutable
 before update or delete on public.crm_core_attestation_fixture_keys
 for each row execute function private.block_shadow_evidence_modification();

create table public.crm_core_attestation_checks_shadow (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 fixture_key_id uuid not null references public.crm_core_attestation_fixture_keys(id) on delete restrict,
 issuer_instance_id uuid not null,
 event_id uuid not null,
 event_key char(64) not null unique,
 core_snapshot_key char(64) not null,
 booking_status text not null check(booking_status='confirmed'),
 booking_source text not null check(booking_source in ('fmc','getacourt')),
 booking_updated_at timestamptz not null,
 occurred_at timestamptz not null,
 expires_at timestamptz not null,
 payload_sha256 char(64) not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 signature_sha256 char(64) not null check(signature_sha256 ~ '^[a-f0-9]{64}$'),
 verification_scheme text not null default 'ed25519-offline-fixture-v1'
   check(verification_scheme='ed25519-offline-fixture-v1'),
 signature_verified_fixture boolean not null default true
   check(signature_verified_fixture=true),
 core_origin_verified boolean not null default false check(core_origin_verified=false),
 causal_evidence_verified boolean not null default false check(causal_evidence_verified=false),
 billable boolean not null default false check(billable=false),
 fee_minor integer not null default 0 check(fee_minor=0),
 observed_at timestamptz not null default now(),
 unique(organization_id,issuer_instance_id,event_id),
 check(expires_at>occurred_at and expires_at<=occurred_at+interval '5 minutes')
);
create index crm_core_attestation_checks_org_booking_idx
 on public.crm_core_attestation_checks_shadow(organization_id,booking_id,observed_at desc);
create index crm_core_attestation_checks_booking_idx
 on public.crm_core_attestation_checks_shadow(booking_id);
create index crm_core_attestation_checks_key_idx
 on public.crm_core_attestation_checks_shadow(fixture_key_id);

create function private.guard_core_fixture_verification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(
   select 1 from public.crm_core_attestation_fixture_keys k
   join public.bookings b on b.id=new.booking_id and b.organization_id=k.organization_id
   join public.crm_booking_evidence e on e.booking_id=b.id and e.organization_id=b.organization_id
   where k.id=new.fixture_key_id and k.organization_id=new.organization_id
     and k.issuer_instance_id=new.issuer_instance_id and k.trust_mode='fixture_only'
     and new.occurred_at>=k.valid_from and new.occurred_at<k.valid_until
     and b.status='confirmed' and b.source in ('fmc','getacourt')
     and b.updated_at=new.booking_updated_at
     and b.status::text=new.booking_status and b.source=new.booking_source
     and e.event_key=trim(new.core_snapshot_key) and e.authoritative_updated_at=b.updated_at
     and e.booking_status=new.booking_status and e.booking_source=b.source
 ) then
    raise exception 'forged, stale or cross-tenant fixture attestation'
       using errcode='23514';
 end if;
 return new;
end; $$;
create trigger crm_core_attestation_fixture_integrity
 before insert on public.crm_core_attestation_checks_shadow
 for each row execute function private.guard_core_fixture_verification();
create trigger crm_core_attestation_fixture_append_only
 before update or delete on public.crm_core_attestation_checks_shadow
 for each row execute function private.block_shadow_evidence_modification();

alter table public.crm_core_attestation_fixture_keys enable row level security;
alter table public.crm_core_attestation_checks_shadow enable row level security;
revoke all on public.crm_core_attestation_fixture_keys,
 public.crm_core_attestation_checks_shadow from public,anon,authenticated;
grant select on public.crm_core_attestation_fixture_keys,
 public.crm_core_attestation_checks_shadow to authenticated;
create policy crm_core_fixture_key_finance_read on public.crm_core_attestation_fixture_keys
 for select to authenticated using(private.has_org_role(organization_id,
  array['owner','admin','manager','analyst']::public.fmc_member_role[]));
create policy crm_core_fixture_verification_finance_read on public.crm_core_attestation_checks_shadow
 for select to authenticated using(private.has_org_role(organization_id,
  array['owner','admin','manager','analyst']::public.fmc_member_role[]));
comment on table public.crm_core_attestation_fixture_keys is
 'Public Ed25519 test fixture keys ONLY. No real Core issuance, no private keys, no live trust activation.';
comment on table public.crm_core_attestation_checks_shadow is
 'Append-only cryptographically verified fixture evidence; never real Core-origin, marketing causality or fee.';
