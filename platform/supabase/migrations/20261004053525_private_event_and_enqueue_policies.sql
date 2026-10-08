create or replace function private.append_event(
  target_org uuid,
  actor_override uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id text,
  p_before jsonb,
  p_after jsonb,
  p_request_id text
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  effective_actor uuid;
  audit_id bigint;
begin
  effective_actor := coalesce(auth.uid(), actor_override);
  if auth.uid() is not null then
    if actor_override is not null and actor_override <> auth.uid() then
      raise exception 'actor mismatch';
    end if;
    if target_org is not null and not private.is_org_member(target_org) then
      raise exception 'not an organization member';
    end if;
  end if;

  insert into public.audit_events
    (organization_id,actor_user_id,event_type,entity_type,entity_id,before_state,after_state,request_id)
  values
    (target_org,effective_actor,p_event_type,p_entity_type,p_entity_id,p_before,p_after,p_request_id)
  returning id into audit_id;

  if target_org is not null then
    insert into public.domain_events
      (organization_id,aggregate_type,aggregate_id,event_type,payload)
    values
      (target_org,p_entity_type,
       case when p_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then p_entity_id::uuid else null end,
       p_event_type,
       jsonb_build_object('entity_id',p_entity_id,'after',p_after));
  end if;

  return audit_id;
end $$;

revoke all on function private.append_event(uuid,uuid,text,text,text,jsonb,jsonb,text) from public, anon;
grant execute on function private.append_event(uuid,uuid,text,text,text,jsonb,jsonb,text) to authenticated;

create policy recon_runs_enqueue on public.reconciliation_runs for insert
  with check (
    private.has_org_role(
      organization_id,
      array['owner','admin','manager','analyst']::public.fmc_member_role[]
    )
  );

create policy jobs_enqueue on public.jobs for insert
  with check (
    kind in ('reconcile','sync_bookings','sync_players','sync_payments')
    and private.has_org_role(
      organization_id,
      array['owner','admin','manager','analyst']::public.fmc_member_role[]
    )
  );
