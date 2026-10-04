create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  home_area text,
  preferred_sports text[] not null default '{}'::text[],
  locale text not null default 'en',
  marketing_consent boolean,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_profiles_full_name_len check (char_length(btrim(full_name)) between 2 and 120),
  constraint player_profiles_home_area_len check (home_area is null or char_length(home_area) <= 120),
  constraint player_profiles_locale_len check (char_length(locale) between 2 and 16),
  constraint player_profiles_sports_allowed check (
    preferred_sports <@ array['padel','tennis','squash','badminton','pickleball']::text[]
  ),
  constraint player_profiles_sports_count check (cardinality(preferred_sports) <= 5)
);

alter table public.player_profiles enable row level security;

revoke all on table public.player_profiles from anon;
grant select,insert,update on table public.player_profiles to authenticated;

create policy player_profile_select_own
on public.player_profiles
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy player_profile_insert_own
on public.player_profiles
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy player_profile_update_own
on public.player_profiles
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create index player_profiles_home_area_idx
on public.player_profiles(lower(home_area))
where home_area is not null;
