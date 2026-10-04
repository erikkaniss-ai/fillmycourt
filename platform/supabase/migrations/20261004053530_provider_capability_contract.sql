do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='provider_connection_write_mode_check'
  ) then
    alter table public.provider_connections
      add constraint provider_connection_write_mode_check
      check (coalesce(capabilities ->> 'write_mode', 'read_sync') in ('read_sync','handoff','authorized_native_write'));
  end if;
end $$;
