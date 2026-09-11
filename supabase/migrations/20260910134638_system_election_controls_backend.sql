-- Antilia Voting Portal - SYSTEM-only election state controls.
-- Existing Phase 1 transition and reset functions remain the single source of
-- truth. These gateways add custom-session authorization and exact source-state
-- checks suitable for the Next.js server.

create or replace function private.transition_election_from_status(
  p_actor_token_hash bytea,
  p_election_id uuid,
  p_expected_status public.election_status,
  p_target_status public.election_status
)
returns public.elections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_current_status public.election_status;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['SYSTEM']::public.admin_role[]
  );

  select e.status into v_current_status
  from public.elections e
  where e.id = p_election_id and e.deleted_at is null
  for update;

  if v_current_status is null then
    raise exception using errcode = 'P0002', message = 'Election not found';
  end if;
  if v_current_status <> p_expected_status then
    raise exception using errcode = '55000', message = 'Election is not in the required source state';
  end if;

  return private.set_election_status(p_election_id, p_target_status, v_actor_id);
end;
$$;

revoke execute on function private.transition_election_from_status(
  bytea, uuid, public.election_status, public.election_status
) from public, anon, authenticated;

create or replace function public.antilia_elections_start(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns public.elections
language sql
security definer
set search_path = ''
as $$
  select private.transition_election_from_status(
    p_actor_token_hash,
    p_election_id,
    'DRAFT'::public.election_status,
    'OPEN'::public.election_status
  );
$$;

create or replace function public.antilia_elections_close(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns public.elections
language sql
security definer
set search_path = ''
as $$
  select private.transition_election_from_status(
    p_actor_token_hash,
    p_election_id,
    'OPEN'::public.election_status,
    'CLOSED'::public.election_status
  );
$$;

create or replace function public.antilia_elections_reopen(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns public.elections
language sql
security definer
set search_path = ''
as $$
  select private.transition_election_from_status(
    p_actor_token_hash,
    p_election_id,
    'CLOSED'::public.election_status,
    'OPEN'::public.election_status
  );
$$;

create or replace function public.antilia_elections_reset(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns public.elections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_replacement_id uuid;
  v_replacement public.elections;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['SYSTEM']::public.admin_role[]
  );

  v_replacement_id := private.reset_election(p_election_id, v_actor_id);
  select e.* into strict v_replacement
  from public.elections e
  where e.id = v_replacement_id;
  return v_replacement;
end;
$$;

revoke execute on function public.antilia_elections_start(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_elections_close(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_elections_reopen(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_elections_reset(bytea, uuid)
  from public, anon, authenticated;

grant execute on function public.antilia_elections_start(bytea, uuid)
  to service_role;
grant execute on function public.antilia_elections_close(bytea, uuid)
  to service_role;
grant execute on function public.antilia_elections_reopen(bytea, uuid)
  to service_role;
grant execute on function public.antilia_elections_reset(bytea, uuid)
  to service_role;

comment on function public.antilia_elections_reset(bytea, uuid) is
  'SYSTEM-only reset. Soft-deletes the original election, preserves its votes/results/history, and creates a replacement DRAFT with copied HOD snapshots and candidates. No vote row is deleted.';
