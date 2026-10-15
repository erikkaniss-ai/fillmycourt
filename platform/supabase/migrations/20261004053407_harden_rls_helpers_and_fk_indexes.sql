revoke all on function public.is_org_member(uuid) from public, anon, authenticated;
revoke all on function public.has_org_role(uuid, public.fmc_member_role[]) from public, anon, authenticated;

create index if not exists audit_events_actor_idx on public.audit_events(actor_user_id) where actor_user_id is not null;
create index if not exists booking_holds_player_idx on public.booking_holds(player_id) where player_id is not null;
create index if not exists bookings_venue_idx on public.bookings(venue_id);
create index if not exists domain_events_org_idx on public.domain_events(organization_id);
create index if not exists recon_items_run_idx on public.reconciliation_items(run_id);
create index if not exists recon_items_booking_idx on public.reconciliation_items(booking_id) where booking_id is not null;
create index if not exists recon_items_assigned_idx on public.reconciliation_items(assigned_to) where assigned_to is not null;
create index if not exists recon_items_proposed_idx on public.reconciliation_items(proposed_by) where proposed_by is not null;
create index if not exists recon_items_approved_idx on public.reconciliation_items(approved_by) where approved_by is not null;
create index if not exists recon_runs_provider_idx on public.reconciliation_runs(provider_connection_id) where provider_connection_id is not null;
