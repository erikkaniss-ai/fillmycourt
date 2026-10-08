create index if not exists demand_matches_routine_idx
on public.demand_matches(routine_id);

create index if not exists demand_matches_venue_idx
on public.demand_matches(venue_id);

create index if not exists demand_matches_court_idx
on public.demand_matches(court_id);

create index if not exists notification_events_routine_idx
on public.notification_events(routine_id);
