-- These RPCs are exposed only to the server-held service role and each one
-- validates the application's hashed HR/SYSTEM session before returning data.
-- They need definer rights solely to call the private session guard and read
-- the private tie-break results view; browser roles retain no EXECUTE access.

alter function public.antilia_tie_breaks_list(bytea, uuid) security definer;
alter function public.antilia_tie_breaks_get(bytea, uuid) security definer;
alter function public.antilia_tie_breaks_results(bytea, uuid) security definer;

revoke execute on function public.antilia_tie_breaks_list(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_breaks_get(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_breaks_results(bytea, uuid)
  from public, anon, authenticated;

grant execute on function public.antilia_tie_breaks_list(bytea, uuid)
  to service_role;
grant execute on function public.antilia_tie_breaks_get(bytea, uuid)
  to service_role;
grant execute on function public.antilia_tie_breaks_results(bytea, uuid)
  to service_role;
