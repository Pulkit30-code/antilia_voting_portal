-- Finalize DRAFT eligibility from the active HOD master immediately before the
-- election opens. This keeps election_hods as the immutable voting snapshot
-- while allowing HODs added after the DRAFT was created to participate.
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
  v_eligible_hods integer;
  v_foh_candidates integer;
  v_boh_candidates integer;
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
    raise exception using errcode = '55000', message = format(
      'Election is not in %s status', p_expected_status::text
    );
  end if;

  if p_expected_status = 'DRAFT' and p_target_status = 'OPEN' then
    perform set_config('app.actor_admin_id', v_actor_id::text, true);

    insert into public.election_hods (
      election_id, hod_id, is_approved, is_active,
      hod_name_snapshot, department_snapshot, mobile_normalized_snapshot
    )
    select p_election_id, h.id, true, true,
           h.name, h.department, h.mobile_normalized
    from public.hods h
    where h.is_active
    on conflict (election_id, hod_id) do update
    set is_approved = true,
        is_active = true,
        hod_name_snapshot = excluded.hod_name_snapshot,
        department_snapshot = excluded.department_snapshot,
        mobile_normalized_snapshot = excluded.mobile_normalized_snapshot;

    select count(*) into v_eligible_hods
    from public.election_hods eh
    join public.hods h on h.id = eh.hod_id
    where eh.election_id = p_election_id
      and eh.is_approved and eh.is_active and h.is_active;

    select count(*) filter (where c.category = 'FOH'),
           count(*) filter (where c.category = 'BOH')
      into v_foh_candidates, v_boh_candidates
    from public.candidates c
    where c.election_id = p_election_id and c.is_active;

    if v_eligible_hods = 0 then
      raise exception using errcode = '23514',
        message = 'At least one eligible HOD is required';
    end if;
    if v_foh_candidates = 0 then
      raise exception using errcode = '23514',
        message = 'At least one active FOH candidate is required';
    end if;
    if v_boh_candidates = 0 then
      raise exception using errcode = '23514',
        message = 'At least one active BOH candidate is required';
    end if;
  end if;

  return private.set_election_status(p_election_id, p_target_status, v_actor_id);
end;
$$;

revoke execute on function private.transition_election_from_status(
  bytea, uuid, public.election_status, public.election_status
) from public, anon, authenticated;

comment on function private.transition_election_from_status(
  bytea, uuid, public.election_status, public.election_status
) is 'SYSTEM-only exact-state transition. DRAFT-to-OPEN atomically finalizes active HOD snapshots and enforces explicit HOD/FOH/BOH readiness checks.';
