create index if not exists court_blocks_created_by_idx on public.court_blocks(created_by) where created_by is not null;
create index if not exists court_rates_org_idx on public.court_rates(organization_id);
create index if not exists import_batches_actor_idx on public.import_batches(actor_user_id) where actor_user_id is not null;

drop policy if exists people_write on public.people;
create policy people_insert on public.people for insert
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));
create policy people_update on public.people for update
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));
create policy people_delete on public.people for delete
  using (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));

drop policy if exists venues_write on public.venues;
create policy venues_insert on public.venues for insert
  with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));
create policy venues_update on public.venues for update
  using (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));
create policy venues_delete on public.venues for delete
  using (private.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));

drop policy if exists courts_write on public.courts;
create policy courts_insert on public.courts for insert
  with check (exists(select 1 from public.venues v where v.id=venue_id and private.has_org_role(v.organization_id,array['owner','admin','manager']::public.fmc_member_role[])));
create policy courts_update on public.courts for update
  using (exists(select 1 from public.venues v where v.id=venue_id and private.has_org_role(v.organization_id,array['owner','admin','manager']::public.fmc_member_role[])))
  with check (exists(select 1 from public.venues v where v.id=venue_id and private.has_org_role(v.organization_id,array['owner','admin','manager']::public.fmc_member_role[])));
create policy courts_delete on public.courts for delete
  using (exists(select 1 from public.venues v where v.id=venue_id and private.has_org_role(v.organization_id,array['owner','admin']::public.fmc_member_role[])));

drop policy if exists bookings_write on public.bookings;
create policy bookings_insert on public.bookings for insert
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));
create policy bookings_update on public.bookings for update
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));
create policy bookings_delete on public.bookings for delete
  using (private.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));

drop policy if exists holds_write on public.booking_holds;
create policy holds_insert on public.booking_holds for insert
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));
create policy holds_update on public.booking_holds for update
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));
create policy holds_delete on public.booking_holds for delete
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));

drop policy if exists court_rates_write on public.court_rates;
create policy court_rates_insert on public.court_rates for insert
  with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));
create policy court_rates_update on public.court_rates for update
  using (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));
create policy court_rates_delete on public.court_rates for delete
  using (private.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));

drop policy if exists court_blocks_write on public.court_blocks;
create policy court_blocks_insert on public.court_blocks for insert
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));
create policy court_blocks_update on public.court_blocks for update
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));
create policy court_blocks_delete on public.court_blocks for delete
  using (private.has_org_role(organization_id,array['owner','admin','manager','front_desk']::public.fmc_member_role[]));

drop policy if exists import_batches_write on public.import_batches;
create policy import_batches_insert on public.import_batches for insert
  with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));
create policy import_batches_update on public.import_batches for update
  using (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]))
  with check (private.has_org_role(organization_id,array['owner','admin','manager']::public.fmc_member_role[]));
create policy import_batches_delete on public.import_batches for delete
  using (private.has_org_role(organization_id,array['owner','admin']::public.fmc_member_role[]));
