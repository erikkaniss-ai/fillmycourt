drop policy if exists people_member_all on public.people;
create policy people_read on public.people for select
  using (private.is_org_member(organization_id));
create policy people_write on public.people for all
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));

drop policy if exists venues_member_all on public.venues;
create policy venues_read on public.venues for select
  using (private.is_org_member(organization_id));
create policy venues_write on public.venues for all
  using (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));

drop policy if exists courts_member_all on public.courts;
create policy courts_read on public.courts for select
  using (exists(select 1 from public.venues v where v.id=venue_id and private.is_org_member(v.organization_id)));
create policy courts_write on public.courts for all
  using (exists(select 1 from public.venues v where v.id=venue_id and private.has_org_role(v.organization_id,array['owner','admin','manager']::public.fmc_member_role[])))
  with check (exists(select 1 from public.venues v where v.id=venue_id and private.has_org_role(v.organization_id,array['owner','admin','manager']::public.fmc_member_role[])));

drop policy if exists bookings_member_all on public.bookings;
create policy bookings_read on public.bookings for select
  using (private.is_org_member(organization_id));
create policy bookings_write on public.bookings for all
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));

drop policy if exists holds_member_all on public.booking_holds;
create policy holds_read on public.booking_holds for select
  using (private.is_org_member(organization_id));
create policy holds_write on public.booking_holds for all
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));

drop policy if exists recon_items_member_all on public.reconciliation_items;
create policy recon_items_read on public.reconciliation_items for select
  using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
create policy recon_items_write on public.reconciliation_items for update
  using (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager','analyst']::public.fmc_member_role[]));
