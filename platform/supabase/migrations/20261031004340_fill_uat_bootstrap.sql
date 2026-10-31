-- Source only. Private controls are released externally after a settled deploy.
-- No auth.users writes, runtime DDL, public policies or SECURITY DEFINER code.
create table fill_private.uat_bootstrap_intents (
    run_id uuid primary key,
    authorization_id uuid not null unique,
    candidate_sha text not null check (candidate_sha ~ '^[0-9a-f]{40}$'),
    project_ref text not null check (project_ref = 'yclqnbcrchwieyzkyumx'),
    organization_ids jsonb not null check (organization_ids =
      '["4484cf28-1947-41dd-9b41-14891ac93752","af24d8dd-813f-4919-bd6d-49a6d1169b25"]'::jsonb),
    input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
    deployment_id uuid not null,
    settled_at timestamptz not null,
    created_at timestamptz not null default clock_timestamp(),
    request_expires_at timestamptz not null,
    preflight_at timestamptz,
    preflight_executor uuid,
    released_at timestamptz,
    starts_at timestamptz,
    executor uuid,
    stopped boolean not null default false,
    reconciliation_required boolean not null default false,
    verdict jsonb,
    verdict_at timestamptz,
    check ((preflight_at is null) = (preflight_executor is null)),
    check ((starts_at is null) = (executor is null)),
    check ((verdict is null) = (verdict_at is null))
);
create table fill_private.uat_bootstrap_attempts (
    run_id uuid not null references fill_private.uat_bootstrap_intents(run_id),
    label text not null check (label in ('canary','a','b')),
    operation text not null check (operation in ('create','activate')),
    reserved_at timestamptz not null default clock_timestamp(),
    activation_nonce uuid not null default gen_random_uuid(),
    settled boolean not null default false,
    first_ban_readback_at timestamptz,
    user_id uuid,
    verified boolean not null default false,
    primary key (run_id, label, operation),
    check (not verified or user_id is not null),
    check (user_id is null or user_id not in (
      'b82a8774-839f-4b73-8c4d-5c76c10dd957','45ef3b07-f811-4e27-b41b-64fe5970d675',
      '4ff65a8d-3d3b-4fd7-a032-a81fd8f51fce','c29ba3be-d7ae-4dff-b662-88d1b0504024'))
);
create unique index uat_bootstrap_new_identity_once
on fill_private.uat_bootstrap_attempts(user_id) where operation='create' and user_id is not null;
alter table fill_private.uat_bootstrap_intents enable row level security;
alter table fill_private.uat_bootstrap_attempts enable row level security;
revoke all on fill_private.uat_bootstrap_intents, fill_private.uat_bootstrap_attempts
from public, anon, authenticated;

create function fill_private.protect_uat_bootstrap() returns trigger
language plpgsql security invoker set search_path=pg_catalog,fill_private as $$
declare i fill_private.uat_bootstrap_intents; r fill_private.uat_runs; c uuid;
begin
    if tg_op='DELETE' then raise exception 'Bootstrap evidence is append-only'; end if;
    if tg_table_name='uat_bootstrap_attempts' then
        if tg_op='UPDATE' then
            if (new.run_id,new.label,new.operation,new.reserved_at,new.activation_nonce) is distinct from
               (old.run_id,old.label,old.operation,old.reserved_at,old.activation_nonce)
               or (old.user_id is not null and new.user_id is distinct from old.user_id)
               or (old.verified and not new.verified) or (old.settled and not new.settled)
               or (old.first_ban_readback_at is not null and new.first_ban_readback_at is distinct from old.first_ban_readback_at)
               or (new.operation='create' and (new.settled or new.first_ban_readback_at is not null)) then
                raise exception 'Bootstrap attempt cannot be replayed';
            end if;
            if old.first_ban_readback_at is null and new.first_ban_readback_at is not null then
                if not new.settled then raise exception 'Activation not settled'; end if;
                new.first_ban_readback_at := clock_timestamp();
            end if;
            if new.operation='activate' and new.user_id is not null and not exists
              (select 1 from fill_private.uat_bootstrap_attempts a where a.run_id=new.run_id
                and a.label=new.label and a.operation='create' and a.verified and a.user_id=new.user_id) then
                raise exception 'Activation identity mismatch';
            end if;
            return new;
        end if;
        select * into strict i from fill_private.uat_bootstrap_intents where run_id=new.run_id for update;
        if i.starts_at is null or i.stopped or new.verified or new.settled or new.first_ban_readback_at is not null
           or clock_timestamp() < i.starts_at or clock_timestamp() >= i.starts_at+interval '20 minutes'
           or new.reserved_at < i.starts_at or new.user_id is not null then
            raise exception 'Invalid bootstrap reservation';
        end if;
        if new.operation='create' then
            if clock_timestamp() >= i.starts_at+interval '60 seconds'
               or exists(select 1 from fill_private.uat_runs where run_id=i.run_id) then
                raise exception 'Creation window closed';
            end if;
        else
            select * into strict r from fill_private.uat_runs where run_id=i.run_id;
            if not r.armed or r.stopped or r.cleanup_complete or r.healthy_at is null
               or clock_timestamp()-r.healthy_at not between interval '0 seconds' and interval '45 seconds'
               or not exists(select 1 from fill_private.uat_bootstrap_attempts a
                             where a.run_id=i.run_id and a.label=new.label and a.operation='create' and a.verified) then
                raise exception 'Activation prerequisites missing';
            end if;
            if new.label='canary' then
                if clock_timestamp() >= i.starts_at+interval '60 seconds' then
                    raise exception 'Canary admission closed';
                end if;
            elsif i.verdict->>'decision' is distinct from 'pass' or i.verdict_at is null
                  or clock_timestamp() >= i.starts_at+interval '10 minutes' then
                raise exception 'Independent operator verdict missing or late';
            end if;
        end if;
        return new;
    end if;
    if tg_op='INSERT' then
        if new.starts_at is not null or new.preflight_at is not null or new.released_at is not null
           or new.executor is not null or new.stopped or new.reconciliation_required
           or new.verdict is not null or new.verdict_at is not null
           or new.settled_at > new.created_at or new.settled_at < new.created_at-interval '5 minutes'
           or new.request_expires_at <= new.created_at
           or new.request_expires_at > new.created_at+interval '5 minutes' then
            raise exception 'Intent must be inactive after a settled deployment';
        end if;
        return new;
    end if;
    if (new.run_id,new.authorization_id,new.candidate_sha,new.project_ref,new.organization_ids,
        new.input_digest,new.deployment_id,new.settled_at,new.created_at,new.request_expires_at) is distinct from
       (old.run_id,old.authorization_id,old.candidate_sha,old.project_ref,old.organization_ids,
        old.input_digest,old.deployment_id,old.settled_at,old.created_at,old.request_expires_at)
       or (old.stopped and not new.stopped)
       or (old.reconciliation_required and not new.reconciliation_required)
       or (old.starts_at is not null and (new.starts_at,new.executor) is distinct from (old.starts_at,old.executor))
       or (old.released_at is not null and new.released_at is distinct from old.released_at)
       or (old.verdict is not null and (new.verdict,new.verdict_at) is distinct from (old.verdict,old.verdict_at)) then
        raise exception 'Bootstrap authority cannot be renewed';
    end if;
    if old.starts_at is not null and (new.preflight_at,new.preflight_executor) is distinct from
                                    (old.preflight_at,old.preflight_executor) then
        raise exception 'Preflight is frozen after T0';
    end if;
    if old.released_at is null and new.released_at is not null then
        if new.stopped or new.preflight_at is null or new.preflight_at > clock_timestamp()
           or clock_timestamp()-new.preflight_at > interval '30 seconds'
           or clock_timestamp() >= new.request_expires_at then
            raise exception 'Fresh preflight required before release';
        end if;
        new.released_at := clock_timestamp();
    end if;
    if old.starts_at is null and new.starts_at is not null then
        if new.stopped or old.released_at is null or new.executor is null
           or new.executor is distinct from old.preflight_executor
           or clock_timestamp() >= new.request_expires_at
           or clock_timestamp()-old.preflight_at not between interval '0 seconds' and interval '30 seconds' then
            raise exception 'Intent cannot start';
        end if;
        new.starts_at := clock_timestamp();
    end if;
    if old.verdict is null and new.verdict is not null then
        select * into strict r from fill_private.uat_runs where run_id=new.run_id;
        if new.starts_at is null
           or jsonb_typeof(new.verdict) is distinct from 'object'
           or (select array_agg(k order by k) from jsonb_object_keys(new.verdict) k) is distinct from
              array['candidate_sha','decision','denied_api','denied_login','evidence_ref','lease_digest','positive_get','run_id']
           or new.verdict->>'run_id' is distinct from new.run_id::text
           or new.verdict->>'candidate_sha' is distinct from new.candidate_sha
           or new.verdict->>'lease_digest' is distinct from encode(sha256(convert_to(r.spec::text,'UTF8')),'hex')
           or coalesce(new.verdict->>'evidence_ref','') !~ '^[A-Za-z0-9_:/#.-]{1,200}$'
           or coalesce(new.verdict->>'decision','') not in ('pass','fail') then
            raise exception 'Verdict binding invalid';
        end if;
        if new.verdict->>'decision'='pass' then
          select user_id into strict c from fill_private.uat_bootstrap_attempts
           where run_id=new.run_id and label='canary' and operation='activate' and verified and settled
             and first_ban_readback_at <= new.starts_at+interval '180 seconds';
          if (new.stopped or r.stopped or new.verdict->'positive_get' is distinct from 'true'::jsonb
           or new.verdict->'denied_login' is distinct from 'true'::jsonb
           or new.verdict->'denied_api' is distinct from 'true'::jsonb
           or r.receipts->c::text is distinct from 'true'::jsonb
           or clock_timestamp() < new.starts_at+interval '180 seconds'
           or clock_timestamp() >= new.starts_at+interval '10 minutes') then
            raise exception 'Canary evidence not ready';
          end if;
        end if;
        new.verdict_at := clock_timestamp();
    end if;
    return new;
end $$;
revoke all on function fill_private.protect_uat_bootstrap() from public,anon,authenticated;
create trigger protect_uat_bootstrap_intent before insert or update or delete
on fill_private.uat_bootstrap_intents for each row execute function fill_private.protect_uat_bootstrap();
create trigger protect_uat_bootstrap_attempt before insert or update or delete
on fill_private.uat_bootstrap_attempts for each row execute function fill_private.protect_uat_bootstrap();
