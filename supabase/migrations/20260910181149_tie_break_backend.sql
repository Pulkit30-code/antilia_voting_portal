-- Tie-break backend gateways over the normalized Phase 1 tables and workflows.
-- Original election votes are read to identify tied leaders and are never
-- updated or deleted by any function in this migration.

alter type public.audit_action add value if not exists 'TIE_BREAK_OPENED';
alter type public.audit_action add value if not exists 'TIE_BREAK_CLOSED';

create table private.tie_break_voter_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  tie_break_id uuid not null references public.tie_breaks(id) on delete restrict,
  hod_id uuid not null references public.hods(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint tie_break_voter_sessions_token_hash_length
    check (octet_length(token_hash) = 32),
  constraint tie_break_voter_sessions_expiry_check
    check (expires_at > created_at),
  constraint tie_break_voter_sessions_used_check
    check (used_at is null or used_at >= created_at)
);

create index tie_break_voter_sessions_active_idx
  on private.tie_break_voter_sessions (expires_at)
  where used_at is null;

alter table private.tie_break_voter_sessions enable row level security;
revoke all on private.tie_break_voter_sessions from public, anon, authenticated;
grant select, insert, update on private.tie_break_voter_sessions to service_role;

create or replace function private.audit_tie_break_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_admin_id uuid;
  v_actor_type public.actor_type;
  v_action public.audit_action;
begin
  if old.status = new.status then
    return new;
  end if;

  v_action := case
    when old.status = 'DRAFT' and new.status = 'OPEN' then 'TIE_BREAK_OPENED'::public.audit_action
    when old.status = 'OPEN' and new.status = 'CLOSED' then 'TIE_BREAK_CLOSED'::public.audit_action
    else null
  end;
  if v_action is null then
    return new;
  end if;

  select a.actor_admin_id, a.actor_type
    into v_actor_admin_id, v_actor_type
  from private.current_audit_actor() a;

  insert into private.audit_logs (
    action, actor_type, actor_admin_id, election_id, tie_break_id, metadata
  ) values (
    v_action, v_actor_type, v_actor_admin_id,
    new.original_election_id, new.id,
    jsonb_build_object('from_status', old.status, 'to_status', new.status)
  );
  return new;
end;
$$;

revoke execute on function private.audit_tie_break_status_change()
  from public, anon, authenticated;

create trigger tie_breaks_98_status_audit
after update of status on public.tie_breaks
for each row execute function private.audit_tie_break_status_change();

create or replace function private.transition_tie_break_from_status(
  p_actor_token_hash bytea,
  p_tie_break_id uuid,
  p_expected_status public.election_status,
  p_target_status public.election_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_status public.election_status;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['SYSTEM']::public.admin_role[]
  );

  select tb.status into v_status
  from public.tie_breaks tb
  where tb.id = p_tie_break_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Tie-break not found';
  end if;
  if v_status <> p_expected_status then
    raise exception using errcode = '55000', message = 'Tie-break is not in the required source state';
  end if;

  perform set_config('app.actor_admin_id', v_actor_id::text, true);
  perform private.set_tie_break_status(p_tie_break_id, p_target_status, v_actor_id);
end;
$$;

revoke execute on function private.transition_tie_break_from_status(
  bytea, uuid, public.election_status, public.election_status
) from public, anon, authenticated;
grant execute on function private.transition_tie_break_from_status(
  bytea, uuid, public.election_status, public.election_status
) to service_role;

create or replace function public.antilia_tie_breaks_create(
  p_actor_token_hash bytea,
  p_election_id uuid,
  p_category public.employee_category
)
returns public.tie_breaks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_tie_break_id uuid;
  v_result public.tie_breaks;
begin
  v_actor_id := private.require_admin_session(
    p_actor_token_hash,
    array['SYSTEM']::public.admin_role[]
  );
  v_tie_break_id := private.initiate_tie_break(
    p_election_id,
    p_category,
    v_actor_id
  );
  select tb.* into strict v_result
  from public.tie_breaks tb
  where tb.id = v_tie_break_id;
  return v_result;
end;
$$;

create or replace function public.antilia_tie_breaks_open(
  p_actor_token_hash bytea,
  p_tie_break_id uuid
)
returns public.tie_breaks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result public.tie_breaks;
begin
  perform private.transition_tie_break_from_status(
    p_actor_token_hash,
    p_tie_break_id,
    'DRAFT'::public.election_status,
    'OPEN'::public.election_status
  );
  select tb.* into strict v_result from public.tie_breaks tb where tb.id = p_tie_break_id;
  return v_result;
end;
$$;

create or replace function public.antilia_tie_breaks_close(
  p_actor_token_hash bytea,
  p_tie_break_id uuid
)
returns public.tie_breaks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result public.tie_breaks;
begin
  perform private.transition_tie_break_from_status(
    p_actor_token_hash,
    p_tie_break_id,
    'OPEN'::public.election_status,
    'CLOSED'::public.election_status
  );
  select tb.* into strict v_result from public.tie_breaks tb where tb.id = p_tie_break_id;
  return v_result;
end;
$$;

create or replace function public.antilia_tie_breaks_list(
  p_actor_token_hash bytea,
  p_election_id uuid default null
)
returns table (
  id uuid,
  original_election_id uuid,
  category public.employee_category,
  round_number smallint,
  status public.election_status,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  candidate_count bigint,
  vote_count bigint,
  tie_detected boolean,
  winner_candidate_id uuid
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );

  return query
  with outcomes as (
    select
      tbr.tie_break_id,
      count(*) filter (where tbr.rank = 1)::integer as leaders_count,
      case when count(*) filter (where tbr.rank = 1) = 1
        then (array_agg(tbr.candidate_id) filter (where tbr.rank = 1))[1]
        else null
      end as leader_candidate_id
    from private.tie_break_results tbr
    group by tbr.tie_break_id
  )
  select
    tb.id,
    tb.original_election_id,
    tb.category,
    tb.round_number,
    tb.status,
    tb.opened_at,
    tb.closed_at,
    tb.created_at,
    tb.updated_at,
    count(distinct tbc.candidate_id)::bigint as candidate_count,
    count(distinct tbv.id)::bigint as vote_count,
    (tb.status = 'CLOSED' and coalesce(o.leaders_count, 0) > 1) as tie_detected,
    case when tb.status = 'CLOSED' and o.leaders_count = 1
      then o.leader_candidate_id else null end as winner_candidate_id
  from public.tie_breaks tb
  left join public.tie_break_candidates tbc on tbc.tie_break_id = tb.id
  left join public.tie_break_votes tbv on tbv.tie_break_id = tb.id
  left join outcomes o on o.tie_break_id = tb.id
  where p_election_id is null or tb.original_election_id = p_election_id
  group by tb.id, o.leaders_count, o.leader_candidate_id
  order by tb.created_at desc, tb.id;
end;
$$;

create or replace function public.antilia_tie_breaks_get(
  p_actor_token_hash bytea,
  p_tie_break_id uuid
)
returns setof public.tie_breaks
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  return query select tb.* from public.tie_breaks tb where tb.id = p_tie_break_id;
end;
$$;

create or replace function public.antilia_tie_breaks_results(
  p_actor_token_hash bytea,
  p_tie_break_id uuid
)
returns table (
  tie_break_id uuid,
  candidate_id uuid,
  candidate_name text,
  vote_count bigint,
  rank integer,
  is_leader boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_admin_session(
    p_actor_token_hash,
    array['HR', 'SYSTEM']::public.admin_role[]
  );
  if not exists (select 1 from public.tie_breaks tb where tb.id = p_tie_break_id) then
    raise exception using errcode = 'P0002', message = 'Tie-break not found';
  end if;
  return query
  select tbr.tie_break_id, tbr.candidate_id, tbr.candidate_name,
         tbr.vote_count, tbr.rank, (tbr.rank = 1)
  from private.tie_break_results tbr
  where tbr.tie_break_id = p_tie_break_id
  order by tbr.rank, tbr.candidate_name, tbr.candidate_id;
end;
$$;

create or replace function public.antilia_tie_break_public_candidates(
  p_tie_break_id uuid
)
returns table (
  id uuid,
  name text,
  department text,
  category public.employee_category
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.tie_breaks tb
    where tb.id = p_tie_break_id and tb.status = 'OPEN'
  ) then
    raise exception using errcode = '55000', message = 'Tie-break is not open';
  end if;
  return query
  select c.id, c.name, c.department, c.category
  from public.tie_break_candidates tbc
  join public.candidates c on c.id = tbc.candidate_id
  where tbc.tie_break_id = p_tie_break_id
  order by c.name, c.id;
end;
$$;

create or replace function public.antilia_tie_break_verify_hod(
  p_tie_break_id uuid,
  p_name text,
  p_mobile_number text,
  p_department text,
  p_token_hash bytea
)
returns table (
  verification_status text,
  tie_break_id uuid,
  category public.employee_category,
  expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_original_election_id uuid;
  v_category public.employee_category;
  v_hod_id uuid;
  v_expires_at timestamptz := clock_timestamp() + interval '10 minutes';
begin
  if octet_length(p_token_hash) <> 32 then
    raise exception using errcode = '22023', message = 'Invalid verification token';
  end if;

  select tb.original_election_id, tb.category
    into v_original_election_id, v_category
  from public.tie_breaks tb
  where tb.id = p_tie_break_id and tb.status = 'OPEN';
  if not found then
    return query select 'TIE_BREAK_NOT_OPEN'::text, null::uuid,
      null::public.employee_category, null::timestamptz;
    return;
  end if;

  select h.id into v_hod_id
  from public.hods h
  join public.election_hods eh
    on eh.hod_id = h.id and eh.election_id = v_original_election_id
  where h.is_active and eh.is_active and eh.is_approved
    and eh.mobile_normalized_snapshot = private.normalize_mobile(p_mobile_number)
    and lower(btrim(eh.hod_name_snapshot)) = lower(btrim(p_name))
    and lower(btrim(eh.department_snapshot)) = lower(btrim(p_department))
  limit 1;

  if v_hod_id is null then
    return query select 'HOD_NOT_VERIFIED'::text, null::uuid,
      null::public.employee_category, null::timestamptz;
    return;
  end if;
  if exists (
    select 1 from public.tie_break_votes tbv
    where tbv.tie_break_id = p_tie_break_id and tbv.hod_id = v_hod_id
  ) then
    return query select 'ALREADY_VOTED'::text, p_tie_break_id,
      v_category, null::timestamptz;
    return;
  end if;

  insert into private.tie_break_voter_sessions (
    token_hash, tie_break_id, hod_id, expires_at
  ) values (
    p_token_hash, p_tie_break_id, v_hod_id, v_expires_at
  );
  return query select 'VERIFIED'::text, p_tie_break_id,
    v_category, v_expires_at;
end;
$$;

create or replace function public.antilia_tie_break_submit_verified_vote(
  p_token_hash bytea,
  p_tie_break_id uuid,
  p_candidate_id uuid,
  p_request_id uuid default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session private.tie_break_voter_sessions;
  v_mobile_number text;
  v_vote_id uuid;
begin
  select s.* into v_session
  from private.tie_break_voter_sessions s
  where s.token_hash = p_token_hash
    and s.tie_break_id = p_tie_break_id
    and s.used_at is null
    and s.expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'HOD not verified';
  end if;

  if not exists (
    select 1 from public.tie_break_candidates tbc
    where tbc.tie_break_id = v_session.tie_break_id
      and tbc.candidate_id = p_candidate_id
  ) then
    raise exception using errcode = '23514', message = 'Invalid candidate selection';
  end if;

  select h.mobile_number into strict v_mobile_number
  from public.hods h where h.id = v_session.hod_id;
  v_vote_id := private.submit_tie_break_vote(
    v_session.tie_break_id,
    v_mobile_number,
    p_candidate_id,
    p_request_id,
    null,
    p_user_agent
  );
  update private.tie_break_voter_sessions s
  set used_at = clock_timestamp()
  where s.id = v_session.id;
  return v_vote_id;
end;
$$;

revoke execute on function public.antilia_tie_breaks_create(bytea, uuid, public.employee_category)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_breaks_open(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_breaks_close(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_breaks_list(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_breaks_get(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_breaks_results(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_break_public_candidates(uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_break_verify_hod(uuid, text, text, text, bytea)
  from public, anon, authenticated;
revoke execute on function public.antilia_tie_break_submit_verified_vote(bytea, uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.antilia_tie_breaks_create(bytea, uuid, public.employee_category)
  to service_role;
grant execute on function public.antilia_tie_breaks_open(bytea, uuid)
  to service_role;
grant execute on function public.antilia_tie_breaks_close(bytea, uuid)
  to service_role;
grant execute on function public.antilia_tie_breaks_list(bytea, uuid)
  to service_role;
grant execute on function public.antilia_tie_breaks_get(bytea, uuid)
  to service_role;
grant execute on function public.antilia_tie_breaks_results(bytea, uuid)
  to service_role;
grant execute on function public.antilia_tie_break_public_candidates(uuid)
  to service_role;
grant execute on function public.antilia_tie_break_verify_hod(uuid, text, text, text, bytea)
  to service_role;
grant execute on function public.antilia_tie_break_submit_verified_vote(bytea, uuid, uuid, uuid, text)
  to service_role;

comment on table private.tie_break_voter_sessions is
  'Short-lived tie-break HOD verification sessions. Only SHA-256 token hashes are stored.';
comment on function public.antilia_tie_breaks_create(bytea, uuid, public.employee_category) is
  'SYSTEM-only SECURITY INVOKER gateway that delegates tied-leader selection to private.initiate_tie_break without changing original votes.';
comment on function public.antilia_tie_break_submit_verified_vote(bytea, uuid, uuid, uuid, text) is
  'Service-only SECURITY INVOKER gateway that consumes a verified HOD session and delegates validation/insertion to private.submit_tie_break_vote.';
