create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=auth.uid()) $$;

create or replace function private.has_org_role(target_org uuid, allowed public.fmc_member_role[])
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=auth.uid() and m.role=any(allowed)) $$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, public.fmc_member_role[]) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.fmc_member_role[]) to authenticated;

alter policy org_read on public.organizations using (private.is_org_member(id));
alter policy members_read on public.organization_members using (private.is_org_member(organization_id));
alter policy people_member_all on public.people
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
alter policy venues_member_all on public.venues
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
alter policy provider_conn_admin on public.provider_connections
  using (private.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));
alter policy provider_mapping_admin on public.provider_mappings
  using (private.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));
alter policy bookings_member_all on public.bookings
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
alter policy holds_member_all on public.booking_holds
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
alter policy payments_member_read on public.payments using (private.is_org_member(organization_id));
alter policy sync_cursor_admin on public.sync_cursors
  using (exists(select 1 from public.provider_connections pc where pc.id=provider_connection_id and private.has_org_role(pc.organization_id,array['owner','admin']::public.fmc_member_role[])))
  with check (exists(select 1 from public.provider_connections pc where pc.id=provider_connection_id and private.has_org_role(pc.organization_id,array['owner','admin']::public.fmc_member_role[])));
alter policy recon_runs_member_read on public.reconciliation_runs using (private.is_org_member(organization_id));
alter policy recon_items_member_all on public.reconciliation_items
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
alter policy audit_member_read on public.audit_events
  using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
alter policy events_admin_read on public.domain_events
  using (private.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));
alter policy courts_member_all on public.courts
  using (exists(select 1 from public.venues v where v.id=venue_id and private.is_org_member(v.organization_id)))
  with check (exists(select 1 from public.venues v where v.id=venue_id and private.is_org_member(v.organization_id)));

drop function if exists public.is_org_member(uuid);
drop function if exists public.has_org_role(uuid, public.fmc_member_role[]);
