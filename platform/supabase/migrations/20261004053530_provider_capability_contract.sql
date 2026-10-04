-- Follow the already-applied production baseline migrations. Do not apply
-- this migration to production until it has completed a staging review.
begin;
alter table public.provider_connections
  add constraint provider_connection_write_mode_check
  check (coalesce(capabilities ->> 'write_mode', 'read_sync') in ('read_sync', 'handoff', 'authorized_native_write'));
commit;
