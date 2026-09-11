-- HR/SYSTEM reporting gateways over the existing Phase 1 private views.
-- Reporting calculations remain defined in private.candidate_results,
-- private.category_outcomes, private.election_turnout, and private.hod_ballots.

create or replace function private.require_election_report_access(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns void
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

  if not exists (
    select 1
    from public.elections e
    where e.id = p_election_id
      and e.status in ('OPEN', 'CLOSED')
  ) then
    raise exception using errcode = '55000',
      message = 'Election results are available only while OPEN or after CLOSED';
  end if;
end;
$$;

revoke execute on function private.require_election_report_access(bytea, uuid)
  from public, anon, authenticated;
grant execute on function private.require_election_report_access(bytea, uuid)
  to service_role;

create or replace function public.antilia_reporting_candidate_results(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns table (
  election_id uuid,
  candidate_id uuid,
  candidate_name text,
  department text,
  category public.employee_category,
  is_active boolean,
  vote_count bigint,
  category_vote_count numeric,
  vote_percentage numeric,
  category_rank integer,
  is_tied_for_first boolean,
  is_current_leader boolean,
  tie_detected boolean,
  provisional_winner_candidate_id uuid,
  final_winner_candidate_id uuid
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_election_report_access(
    p_actor_token_hash,
    p_election_id
  );

  return query
  select
    cr.election_id,
    cr.candidate_id,
    cr.candidate_name,
    cr.department,
    cr.category,
    cr.is_active,
    cr.vote_count,
    cr.category_vote_count,
    cr.vote_percentage,
    cr.category_rank,
    cr.is_tied_for_first,
    (cr.is_active and cr.category_rank = 1) as is_current_leader,
    co.tie_detected,
    co.provisional_winner_candidate_id,
    ew.candidate_id as final_winner_candidate_id
  from private.candidate_results cr
  left join private.category_outcomes co
    on co.election_id = cr.election_id and co.category = cr.category
  left join public.election_winners ew
    on ew.election_id = cr.election_id and ew.category = cr.category
  where cr.election_id = p_election_id
  order by cr.category, cr.category_rank, cr.candidate_name, cr.candidate_id;
end;
$$;

create or replace function public.antilia_reporting_turnout(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns table (
  election_id uuid,
  eligible_hod_count bigint,
  completed_hod_count bigint,
  pending_hod_count bigint,
  turnout_percentage numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_election_report_access(
    p_actor_token_hash,
    p_election_id
  );

  return query
  select
    et.election_id,
    et.eligible_hod_count,
    et.voted_hod_count as completed_hod_count,
    greatest(et.eligible_hod_count - et.voted_hod_count, 0::bigint)
      as pending_hod_count,
    et.turnout_percentage
  from private.election_turnout et
  where et.election_id = p_election_id;
end;
$$;

create or replace function public.antilia_reporting_hod_ballots(
  p_actor_token_hash bytea,
  p_election_id uuid
)
returns table (
  election_id uuid,
  hod_id uuid,
  hod_name text,
  hod_department text,
  has_voted boolean,
  foh_candidate_id uuid,
  foh_candidate_name text,
  boh_candidate_id uuid,
  boh_candidate_name text,
  ballot_submitted_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.require_election_report_access(
    p_actor_token_hash,
    p_election_id
  );

  return query
  select
    hb.election_id,
    hb.hod_id,
    hb.hod_name,
    hb.hod_department,
    hb.has_voted,
    hb.foh_candidate_id,
    hb.foh_candidate_name,
    hb.boh_candidate_id,
    hb.boh_candidate_name,
    hb.ballot_submitted_at
  from private.hod_ballots hb
  where hb.election_id = p_election_id
    and hb.is_approved
    and hb.is_active
  order by hb.has_voted desc, hb.hod_name, hb.hod_id;
end;
$$;

revoke execute on function public.antilia_reporting_candidate_results(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_reporting_turnout(bytea, uuid)
  from public, anon, authenticated;
revoke execute on function public.antilia_reporting_hod_ballots(bytea, uuid)
  from public, anon, authenticated;

grant execute on function public.antilia_reporting_candidate_results(bytea, uuid)
  to service_role;
grant execute on function public.antilia_reporting_turnout(bytea, uuid)
  to service_role;
grant execute on function public.antilia_reporting_hod_ballots(bytea, uuid)
  to service_role;

comment on function private.require_election_report_access(bytea, uuid) is
  'Validates a live HR/SYSTEM application session and restricts reporting to OPEN/CLOSED elections. Kept in the non-exposed private schema.';
comment on function public.antilia_reporting_candidate_results(bytea, uuid) is
  'Service-role-only SECURITY INVOKER gateway over existing private totals, percentage, ranking, leader, tie, and winner reporting.';
comment on function public.antilia_reporting_hod_ballots(bytea, uuid) is
  'Service-role-only SECURITY INVOKER gateway exposing eligible HOD turnout and individual FOH/BOH choices to authenticated HR/SYSTEM application sessions.';
