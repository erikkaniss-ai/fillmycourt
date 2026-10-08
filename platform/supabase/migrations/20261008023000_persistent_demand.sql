create table public.play_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sport text not null,
  days_of_week smallint[] not null,
  window_start_minute smallint not null check (window_start_minute between 0 and 1439),
  window_end_minute smallint not null check (window_end_minute between 1 and 1440 and window_end_minute > window_start_minute),
  duration_minutes smallint not null check (duration_minutes in (30,60,90,120,150,180,240)),
  location_label text not null default '',
  center_lat double precision,
  center_lon double precision,
  radius_km double precision not null default 10 check (radius_km > 0 and radius_km <= 200),
  max_price_minor integer check (max_price_minor is null or max_price_minor >= 0),
  currency char(3) not null default 'EUR',
  indoor_preference text not null default 'all' check (indoor_preference in ('all','indoor','outdoor')),
  preferred_venue_ids text[] not null default '{}'::text[],
  excluded_venue_ids text[] not null default '{}'::text[],
  timezone text not null default 'Europe/Lisbon',
  start_date date not null,
  valid_until date,
  status text not null default 'active' check (status in ('active','paused','expired')),
  watch_enabled boolean not null default true,
  last_engaged_at timestamptz not null default now(),
  last_evaluated_at timestamptz,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint play_routines_sport_allowed check (
    sport in ('padel','tennis','squash','badminton','pickleball')
  ),
  constraint play_routines_days_allowed check (
    cardinality(days_of_week) between 1 and 7
    and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint play_routines_location_pair check (
    (center_lat is null and center_lon is null)
    or
    (center_lat between -90 and 90 and center_lon between -180 and 180)
  ),
  constraint play_routines_valid_until check (
    valid_until is null or valid_until >= start_date
  ),
  constraint play_routines_venue_list_limit check (
    cardinality(preferred_venue_ids) <= 30 and cardinality(excluded_venue_ids) <= 30
  )
);

create index play_routines_user_status_idx
on public.play_routines(user_id,status,updated_at desc);

create index play_routines_watch_due_idx
on public.play_routines(status,watch_enabled,next_check_at)
where status='active' and watch_enabled is true;

create table public.demand_intents (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.play_routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_date date not null,
  window_start_minute smallint not null check (window_start_minute between 0 and 1439),
  window_end_minute smallint not null check (window_end_minute between 1 and 1440 and window_end_minute > window_start_minute),
  duration_minutes smallint not null,
  status text not null default 'watching' check (status in ('watching','matched','paused','expired')),
  freshness_score numeric(4,3) not null default 1.000 check (freshness_score between 0 and 1),
  expires_at timestamptz not null,
  last_evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (routine_id,target_date)
);

create index demand_intents_user_date_idx
on public.demand_intents(user_id,target_date,status);

create index demand_intents_active_date_idx
on public.demand_intents(target_date,status,freshness_score)
where status in ('watching','matched');

create table public.demand_matches (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.demand_intents(id) on delete cascade,
  routine_id uuid not null references public.play_routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  court_id uuid not null references public.courts(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes smallint not null,
  amount_minor integer not null check (amount_minor >= 0),
  currency char(3) not null,
  distance_km double precision,
  match_score numeric(5,2) not null check (match_score between 0 and 100),
  status text not null default 'active' check (status in ('active','stale','dismissed','selected')),
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  unique (intent_id,fingerprint)
);

create index demand_matches_intent_score_idx
on public.demand_matches(intent_id,status,match_score desc,last_seen_at desc);

create index demand_matches_user_seen_idx
on public.demand_matches(user_id,last_seen_at desc);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid references public.play_routines(id) on delete cascade,
  intent_id uuid references public.demand_intents(id) on delete cascade,
  event_type text not null check (event_type in ('ready','opened','clicked','ignored','converted')),
  channel text not null default 'in_app',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index notification_events_user_time_idx
on public.notification_events(user_id,created_at desc);

create index notification_events_intent_time_idx
on public.notification_events(intent_id,event_type,created_at desc);

alter table public.play_routines enable row level security;
alter table public.demand_intents enable row level security;
alter table public.demand_matches enable row level security;
alter table public.notification_events enable row level security;

revoke all on table public.play_routines from anon;
revoke all on table public.demand_intents from anon;
revoke all on table public.demand_matches from anon;
revoke all on table public.notification_events from anon;

grant select,insert,update,delete on table public.play_routines to authenticated;
grant select,insert,update,delete on table public.demand_intents to authenticated;
grant select,insert,update,delete on table public.demand_matches to authenticated;
grant select,insert on table public.notification_events to authenticated;

create policy play_routines_own
on public.play_routines
for all
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy demand_intents_own
on public.demand_intents
for all
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy demand_matches_own
on public.demand_matches
for all
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy notification_events_select_own
on public.notification_events
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy notification_events_insert_own
on public.notification_events
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
