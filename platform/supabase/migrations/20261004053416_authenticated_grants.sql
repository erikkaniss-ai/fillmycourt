grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant select,insert,update,delete on tables to authenticated;
alter default privileges in schema public
  grant usage,select on sequences to authenticated;
