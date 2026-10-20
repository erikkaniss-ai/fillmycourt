-- Staging-source-only Playtomic read budget. No grant, secret, or credentials here.
-- A single atomic lock row per provider connection covers all data streams.
-- External provider writes and user-readable access are not introduced.
create table if not exists public.provider_request_windows (
  provider_connection_id uuid primary key
    references public.provider_connections(id) on delete cascade,
  next_allowed_at timestamptz not null default '-infinity'::timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.provider_request_windows enable row level security;
revoke all on public.provider_request_windows from anon, authenticated;
comment on table public.provider_request_windows is
  'Private rate reservations for authorized Playtomic club data reads; default no requests';
