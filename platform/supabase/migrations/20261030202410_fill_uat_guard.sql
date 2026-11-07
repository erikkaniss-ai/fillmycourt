-- GO-A source only. Never applies itself; no Auth identities or public policies.
create schema if not exists fill_private;
revoke all on schema fill_private from public, anon, authenticated;

create table fill_private.uat_runs (
    run_id uuid primary key,
    spec jsonb not null,
    armed boolean not null default false,
    stopped boolean not null default false,
    healthy_at timestamptz,
    receipts jsonb not null default '{}'::jsonb,
    attempts bigint not null default 0 check (attempts >= 0),
    cleanup_complete boolean not null default false,
    created_at timestamptz not null default clock_timestamp(),
    check (jsonb_typeof(spec) = 'object'),
    check (jsonb_typeof(receipts) = 'object')
);
alter table fill_private.uat_runs enable row level security;
revoke all on fill_private.uat_runs from public, anon, authenticated;

-- Immutable run UUID/deadlines/allowlist; no delete or reuse of an enrolled ID.
-- SECURITY INVOKER, private schema, no public execute permission.
create function fill_private.protect_uat_run() returns trigger
language plpgsql security invoker set search_path = pg_catalog, fill_private
as $$
declare p jsonb; start_at timestamptz; end_at timestamptz; ids uuid[] := '{}'; labels text[] := '{}';
        principal_id uuid; ban_at timestamptz; expiry timestamptz;
begin
    if tg_op = 'DELETE' then
        raise exception 'Fill UAT ledger is append-only';
    end if;
    if tg_op = 'UPDATE' then
        if new.run_id is distinct from old.run_id or new.spec is distinct from old.spec
           or new.created_at is distinct from old.created_at
           or (old.armed and not new.armed) or (old.stopped and not new.stopped)
           or (old.cleanup_complete and not new.cleanup_complete) then
            raise exception 'Fill UAT lease cannot be renewed or removed';
        end if;
        return new;
    end if;
    if new.armed or new.stopped or new.healthy_at is not null or new.attempts <> 0
       or new.cleanup_complete or new.receipts <> '{}'::jsonb then
        raise exception 'Fill UAT enrollment must be inactive';
    end if;
    if (new.spec->>'run_id')::uuid is distinct from new.run_id
       or new.spec->>'project_ref' is distinct from 'yclqnbcrchwieyzkyumx'
       or coalesce(new.spec->>'candidate_sha','') !~ '^[0-9a-f]{40}$'
       or jsonb_typeof(new.spec->'principals') is distinct from 'array'
       or jsonb_array_length(new.spec->'principals') not between 1 and 3
       or new.spec->'organization_ids' is null
       or not (new.spec->'organization_ids' @> '["af24d8dd-813f-4919-bd6d-49a6d1169b25","4484cf28-1947-41dd-9b41-14891ac93752"]'::jsonb)
       or jsonb_array_length(new.spec->'organization_ids') <> 2 then
        raise exception 'Invalid Fill UAT scope';
    end if;
    if new.spec->>'starts_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
       or new.spec->>'expires_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception 'Fill UAT timezone required';
    end if;
    start_at := (new.spec->>'starts_at')::timestamptz;
    end_at := (new.spec->>'expires_at')::timestamptz;
    if start_at is null or end_at is null or end_at <= start_at or end_at > start_at + interval '30 minutes' then
        raise exception 'Invalid Fill UAT deadline';
    end if;
    -- Serialise enrollment so concurrent runs cannot reuse a principal.
    perform pg_advisory_xact_lock(81409236);
    for p in select value from jsonb_array_elements(new.spec->'principals') loop
        principal_id := (p->>'id')::uuid;
        ban_at := (p->>'ban_at')::timestamptz;
        expiry := (p->>'expires_at')::timestamptz;
        if principal_id is null or principal_id = any(ids) or p->>'label' = any(labels)
           or coalesce(p->>'label','') not in ('a','b','canary')
           or p->>'ban_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
           or p->>'expires_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
           or ban_at is null or expiry is null or ban_at <= start_at
           or expiry < ban_at + interval '30 seconds' or expiry > end_at
           or (p->>'label' = 'canary' and (expiry > start_at + interval '3 minutes' or ban_at > start_at + interval '2 minutes'))
           or ban_at > start_at + interval '20 minutes'
           or principal_id in ('b82a8774-839f-4b73-8c4d-5c76c10dd957', '45ef3b07-f811-4e27-b41b-64fe5970d675',
                               '4ff65a8d-3d3b-4fd7-a032-a81fd8f51fce', 'c29ba3be-d7ae-4dff-b662-88d1b0504024')
           or exists (select 1 from fill_private.uat_runs r,
                      lateral jsonb_array_elements(r.spec->'principals') existing
                      where (existing->>'id')::uuid = principal_id) then
            raise exception 'Invalid or previously enrolled Fill UAT principal';
        end if;
        ids := array_append(ids, principal_id);
        labels := array_append(labels, p->>'label');
    end loop;
    return new;
end;
$$;
revoke all on function fill_private.protect_uat_run() from public, anon, authenticated;
create trigger protect_uat_run before insert or update or delete on fill_private.uat_runs
for each row execute function fill_private.protect_uat_run();
