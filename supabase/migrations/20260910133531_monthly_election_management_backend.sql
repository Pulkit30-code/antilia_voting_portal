-- Antilia Voting Portal - service-only monthly election management backend.
-- This migration intentionally adds no OPEN/CLOSE/REOPEN gateway.

alter type public.audit_action add value if not exists 'ELECTION_UPDATED';

create or replace function private.audit_draft_election_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_admin_id uuid;
  v_actor_type public.actor_type;
begin
  if new.deleted_at is not distinct from old.deleted_at
     and (
       new.name is distinct from old.name
       or new.election_month is distinct from old.election_month
       or new.election_year is distinct from old.election_year
     ) then
    select a.actor_admin_id, a.actor_type into v_actor_admin_id, v_actor_type
    from private.current_audit_actor() a;

    insert into private.audit_logs (
      action, actor_type, actor_admin_id, election_id, metadata
    ) values (
      'ELECTION_UPDATED', v_actor_type, v_actor_admin_id, new.id,
      jsonb_build_object('operation', tg_op)
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.audit_draft_election_update()
  from public, anon, authenticated;

create trigger elections_98_draft_update_audit
after update of name, election_month, election_year on public.elections
for each row execute function private.audit_draft_election_update();

create or replace function public.antilia_elections_list(p_actor_token_hash bytea)
returns table (
  id uuid,
  name text,
  election_month smallint,
  election_year smallint,
  status public.election_status,
  opened_at timestamptz,
  closed_at timestamptz,
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
  select e.id, e.name, e.election_month, e.election_year, e.status,
         e.opened_at, e.closed_at, e.created_at, e.updated_at
  from public.elections e
  where e.deleted_at is null
  order by e.election_year desc, e.election_month desc, e.created_at desc;
end;
$$;

create or replace function public.antilia_elections_get(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns table (
  id uuid,
  name text,
  election_month smallint,
  election_year smallint,
  status public.election_status,
  opened_at timestamptz,
  closed_at timestamptz,
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
  select e.id, e.name, e.election_month, e.election_year, e.status,
         e.opened_at, e.closed_at, e.created_at, e.updated_at
  from public.elections e
  where e.id = p_election_id and e.deleted_at is null;
end;
$$;

create or replace function public.antilia_elections_create(
  p_actor_token_hash bytea,
  p_name text,
  p_month smallint,
  p_year smallint
)
returns public.elections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_election public.elections;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  perform set_config('app.actor_admin_id', v_actor_id::text, true);

  insert into public.elections (
    name, election_month, election_year, status, created_by
  ) values (
    btrim(p_name), p_month, p_year, 'DRAFT', v_actor_id
  ) returning * into v_election;

  -- Active master HODs are the currently pre-approved HOD population. The
  -- election-specific row records approval and preserves identity snapshots.
  insert into public.election_hods (
    election_id, hod_id, is_approved, is_active,
    hod_name_snapshot, department_snapshot, mobile_normalized_snapshot
  )
  select v_election.id, h.id, true, true,
         h.name, h.department, h.mobile_normalized
  from public.hods h
  where h.is_active;

  return v_election;
end;
$$;

create or replace function public.antilia_elections_update(
  p_actor_token_hash bytea,
  p_election_id uuid,
  p_name text,
  p_month smallint,
  p_year smallint
)
returns public.elections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_election public.elections;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  perform set_config('app.actor_admin_id', v_actor_id::text, true);

  update public.elections e
  set name = btrim(p_name),
      election_month = p_month,
      election_year = p_year
  where e.id = p_election_id
    and e.deleted_at is null
    and e.status = 'DRAFT'
  returning e.* into v_election;

  if not found then
    raise exception using errcode = '55000',
      message = 'Election not found or is not editable';
  end if;
  return v_election;
end;
$$;

create or replace function public.antilia_elections_cancel(
  p_actor_token_hash bytea,
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

  -- Soft cancellation preserves the election, candidates, eligibility snapshot,
  -- and all relational history while releasing the month/year uniqueness slot.
  update public.elections e
  set deleted_at = clock_timestamp(),
      deleted_by = v_actor_id
  where e.id = p_election_id
    and e.deleted_at is null
    and e.status = 'DRAFT';

  if not found then
    raise exception using errcode = '55000',
      message = 'Election not found or is not cancellable';
  end if;
end;
$$;

revoke execute on function public.antilia_elections_list(bytea)
  from public, anon, authenticated;
revoke execute on function public.antilia_elections_get(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_elections_create(bytea, text, smallint, smallint)
  from public, anon, authenticated;
revoke execute on function public.antilia_elections_update(bytea, uuid, text, smallint, smallint)
  from public, anon, authenticated;
revoke execute on function public.antilia_elections_cancel(bytea, uuid)
  from public, anon, authenticated;

grant execute on function public.antilia_elections_list(bytea) to service_role;
grant execute on function public.antilia_elections_get(bytea, uuid) to service_role;
grant execute on function public.antilia_elections_create(bytea, text, smallint, smallint)
  to service_role;
grant execute on function public.antilia_elections_update(bytea, uuid, text, smallint, smallint)
  to service_role;
grant execute on function public.antilia_elections_cancel(bytea, uuid)
  to service_role;

comment on function public.antilia_elections_create(bytea, text, smallint, smallint) is
  'Creates one DRAFT monthly election and atomically snapshots all active master HODs as approved election voters.';
comment on function public.antilia_elections_cancel(bytea, uuid) is
  'Soft-cancels only a DRAFT election. Historical relational records are retained and OPEN/CLOSED elections are rejected.';
