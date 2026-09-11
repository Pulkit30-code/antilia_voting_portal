-- Antilia Voting Portal - service-only candidate management backend.
-- Existing table constraints and the candidate configuration trigger remain the
-- authority for category integrity, election membership, and DRAFT-only writes.

alter type public.audit_action add value if not exists 'CANDIDATE_ACTIVATED';
alter type public.audit_action add value if not exists 'CANDIDATE_REMOVED';

create or replace function private.audit_entity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_admin_id uuid;
  v_actor_type public.actor_type;
  v_action public.audit_action;
  v_election_id uuid;
  v_hod_id uuid;
  v_candidate_id uuid;
  v_tie_break_id uuid;
begin
  select a.actor_admin_id, a.actor_type into v_actor_admin_id, v_actor_type
  from private.current_audit_actor() a;

  if tg_table_name = 'hods' then
    v_hod_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_action := case
      when tg_op = 'INSERT' then 'HOD_CREATED'
      when tg_op = 'DELETE' then 'HOD_REMOVED'
      when not old.is_active and new.is_active then 'HOD_ACTIVATED'
      when old.is_active and not new.is_active then 'HOD_DEACTIVATED'
      else 'HOD_UPDATED' end;
  elsif tg_table_name = 'candidates' then
    v_candidate_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_election_id := case when tg_op = 'DELETE' then old.election_id else new.election_id end;
    v_action := case
      when tg_op = 'INSERT' then 'CANDIDATE_CREATED'
      when tg_op = 'DELETE' then 'CANDIDATE_REMOVED'
      when not old.is_active and new.is_active then 'CANDIDATE_ACTIVATED'
      when old.is_active and not new.is_active then 'CANDIDATE_DEACTIVATED'
      else 'CANDIDATE_UPDATED' end;
  elsif tg_table_name = 'elections' then
    v_election_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_action := case
      when tg_op = 'INSERT' then 'ELECTION_CREATED'
      when new.deleted_at is not null and old.deleted_at is null then 'ELECTION_DELETED'
      when old.status = 'DRAFT' and new.status = 'OPEN' then 'ELECTION_OPENED'
      when old.status = 'OPEN' and new.status = 'CLOSED' then 'ELECTION_CLOSED'
      when old.status = 'CLOSED' and new.status = 'OPEN' then 'ELECTION_REOPENED'
      else null end;
  elsif tg_table_name = 'tie_breaks' and tg_op = 'INSERT' then
    v_tie_break_id := new.id;
    v_election_id := new.original_election_id;
    v_action := 'TIE_BREAK_CREATED';
  elsif tg_table_name = 'admin_credentials' and tg_op in ('INSERT', 'UPDATE') then
    v_action := case new.role when 'HR' then 'HR_PASSCODE_CHANGED' else 'SYSTEM_PASSCODE_CHANGED' end;
  end if;

  if v_action is not null then
    insert into private.audit_logs (
      action, actor_type, actor_admin_id, election_id, hod_id, candidate_id, tie_break_id,
      metadata
    ) values (
      v_action, v_actor_type, v_actor_admin_id, v_election_id, v_hod_id, v_candidate_id, v_tie_break_id,
      jsonb_build_object('operation', tg_op)
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.antilia_candidates_list(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns table (
  id uuid,
  election_id uuid,
  name text,
  department text,
  category public.employee_category,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );

  return query
  select c.id, c.election_id, c.name, c.department, c.category,
         c.is_active, c.created_at, c.updated_at
  from public.candidates c
  where c.election_id = p_election_id
  order by c.category, c.name, c.id;
end;
$$;

create or replace function public.antilia_candidates_create(
  p_actor_token_hash bytea,
  p_election_id uuid,
  p_name text,
  p_department text,
  p_category public.employee_category,
  p_is_active boolean default true
)
returns public.candidates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_candidate public.candidates;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  perform set_config('app.actor_admin_id', v_actor_id::text, true);

  insert into public.candidates (
    election_id, name, department, category, is_active
  ) values (
    p_election_id, btrim(p_name), btrim(p_department), p_category, p_is_active
  ) returning * into v_candidate;
  return v_candidate;
end;
$$;

create or replace function public.antilia_candidates_update(
  p_actor_token_hash bytea,
  p_candidate_id uuid,
  p_election_id uuid,
  p_name text,
  p_department text,
  p_category public.employee_category
)
returns public.candidates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_candidate public.candidates;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  perform set_config('app.actor_admin_id', v_actor_id::text, true);

  update public.candidates c
  set name = btrim(p_name),
      department = btrim(p_department),
      category = p_category
  where c.id = p_candidate_id and c.election_id = p_election_id
  returning c.* into v_candidate;

  if not found then
    raise exception using errcode = 'P0002', message = 'Candidate not found';
  end if;
  return v_candidate;
end;
$$;

create or replace function public.antilia_candidates_set_active(
  p_actor_token_hash bytea,
  p_candidate_id uuid,
  p_election_id uuid,
  p_is_active boolean
)
returns public.candidates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_candidate public.candidates;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  perform set_config('app.actor_admin_id', v_actor_id::text, true);

  update public.candidates c
  set is_active = p_is_active
  where c.id = p_candidate_id and c.election_id = p_election_id
  returning c.* into v_candidate;

  if not found then
    raise exception using errcode = 'P0002', message = 'Candidate not found';
  end if;
  return v_candidate;
end;
$$;

create or replace function public.antilia_candidates_remove(
  p_actor_token_hash bytea,
  p_candidate_id uuid,
  p_election_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  perform set_config('app.actor_admin_id', v_actor_id::text, true);

  delete from public.candidates c
  where c.id = p_candidate_id and c.election_id = p_election_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Candidate not found';
  end if;
end;
$$;

revoke execute on function public.antilia_candidates_list(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_candidates_create(
  bytea, uuid, text, text, public.employee_category, boolean
) from public, anon, authenticated;
revoke execute on function public.antilia_candidates_update(
  bytea, uuid, uuid, text, text, public.employee_category
) from public, anon, authenticated;
revoke execute on function public.antilia_candidates_set_active(bytea, uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.antilia_candidates_remove(bytea, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.antilia_candidates_list(bytea, uuid)
  to service_role;
grant execute on function public.antilia_candidates_create(
  bytea, uuid, text, text, public.employee_category, boolean
) to service_role;
grant execute on function public.antilia_candidates_update(
  bytea, uuid, uuid, text, text, public.employee_category
) to service_role;
grant execute on function public.antilia_candidates_set_active(bytea, uuid, uuid, boolean)
  to service_role;
grant execute on function public.antilia_candidates_remove(bytea, uuid, uuid)
  to service_role;

comment on function public.antilia_candidates_list(bytea, uuid) is
  'Service-role-only candidate listing for one election. Requires a live HR or SYSTEM application session.';
comment on function public.antilia_candidates_remove(bytea, uuid, uuid) is
  'DRAFT-only candidate removal enforced by the existing database trigger; historical election candidates remain locked.';
