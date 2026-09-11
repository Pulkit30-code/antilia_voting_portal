-- Antilia Voting Portal - service-only HOD management backend.
--
-- Browser roles retain no table access. These narrow gateways are callable only
-- with the server-held Supabase secret key and independently validate the
-- application's hashed administrative session token in PostgreSQL.

alter type public.audit_action add value if not exists 'HOD_ACTIVATED';
alter type public.audit_action add value if not exists 'HOD_REMOVED';

create or replace function private.require_admin_session(
  p_token_hash bytea,
  p_allowed_roles public.admin_role[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception using errcode = '42501', message = 'Active administrative session required';
  end if;

  select ap.id into v_admin_id
  from private.admin_sessions s
  join private.admin_principals ap on ap.id = s.admin_principal_id
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > clock_timestamp()
    and ap.is_active
    and ap.role = any (p_allowed_roles);

  if v_admin_id is null then
    raise exception using errcode = '42501', message = 'Active administrative session required';
  end if;

  return v_admin_id;
end;
$$;

revoke execute on function private.require_admin_session(bytea, public.admin_role[])
  from public, anon, authenticated;

-- Extend the existing shared audit trigger without changing prior migrations.
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

create or replace function public.antilia_hods_list(p_actor_token_hash bytea)
returns table (
  id uuid,
  name text,
  mobile_number text,
  department text,
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
  select h.id, h.name, h.mobile_number, h.department, h.is_active,
         h.created_at, h.updated_at
  from public.hods h
  order by h.name, h.id;
end;
$$;

create or replace function public.antilia_hods_create(
  p_actor_token_hash bytea,
  p_name text,
  p_mobile_number text,
  p_department text,
  p_is_active boolean default true
)
returns public.hods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_hod public.hods;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  perform set_config('app.actor_admin_id', v_actor_id::text, true);

  insert into public.hods (name, mobile_number, department, is_active)
  values (btrim(p_name), btrim(p_mobile_number), btrim(p_department), p_is_active)
  returning * into v_hod;
  return v_hod;
end;
$$;

create or replace function public.antilia_hods_update(
  p_actor_token_hash bytea,
  p_hod_id uuid,
  p_name text,
  p_mobile_number text,
  p_department text
)
returns public.hods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_hod public.hods;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  perform set_config('app.actor_admin_id', v_actor_id::text, true);

  update public.hods h
  set name = btrim(p_name),
      mobile_number = btrim(p_mobile_number),
      department = btrim(p_department)
  where h.id = p_hod_id
  returning h.* into v_hod;

  if not found then
    raise exception using errcode = 'P0002', message = 'HOD not found';
  end if;
  return v_hod;
end;
$$;

create or replace function public.antilia_hods_set_active(
  p_actor_token_hash bytea,
  p_hod_id uuid,
  p_is_active boolean
)
returns public.hods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_hod public.hods;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  perform set_config('app.actor_admin_id', v_actor_id::text, true);

  update public.hods h
  set is_active = p_is_active
  where h.id = p_hod_id
  returning h.* into v_hod;

  if not found then
    raise exception using errcode = 'P0002', message = 'HOD not found';
  end if;
  return v_hod;
end;
$$;

create or replace function public.antilia_hods_remove(
  p_actor_token_hash bytea,
  p_hod_id uuid
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

  if exists (select 1 from public.election_hods eh where eh.hod_id = p_hod_id) then
    raise exception using errcode = '55000',
      message = 'HOD with election history cannot be removed; deactivate it instead';
  end if;

  delete from public.hods h where h.id = p_hod_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'HOD not found';
  end if;
end;
$$;

revoke execute on function public.antilia_hods_list(bytea)
  from public, anon, authenticated;
revoke execute on function public.antilia_hods_create(bytea, text, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.antilia_hods_update(bytea, uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.antilia_hods_set_active(bytea, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.antilia_hods_remove(bytea, uuid)
  from public, anon, authenticated;

grant execute on function public.antilia_hods_list(bytea) to service_role;
grant execute on function public.antilia_hods_create(bytea, text, text, text, boolean)
  to service_role;
grant execute on function public.antilia_hods_update(bytea, uuid, text, text, text)
  to service_role;
grant execute on function public.antilia_hods_set_active(bytea, uuid, boolean)
  to service_role;
grant execute on function public.antilia_hods_remove(bytea, uuid)
  to service_role;

comment on function public.antilia_hods_list(bytea) is
  'Service-role-only HOD listing. Requires a live HR or SYSTEM application session; mobile numbers never become anonymous-readable.';
comment on function public.antilia_hods_remove(bytea, uuid) is
  'Safely removes only HODs with no election history. Historical HODs must be deactivated.';
