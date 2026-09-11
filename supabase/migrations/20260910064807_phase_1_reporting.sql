-- Antilia Voting Portal - Phase 1 private administrative reporting.
-- Views are security_invoker and stay in the non-exposed private schema.

create view private.candidate_results
with (security_invoker = true)
as
with totals as (
  select
    c.election_id,
    c.id as candidate_id,
    c.name as candidate_name,
    c.department,
    c.category,
    c.is_active,
    count(v.id)::bigint as vote_count
  from public.candidates c
  left join public.votes v
    on v.election_id = c.election_id
   and v.candidate_id = c.id
   and v.category = c.category
  group by c.election_id, c.id, c.name, c.department, c.category, c.is_active
), ranked as (
  select
    t.*,
    sum(t.vote_count) over (partition by t.election_id, t.category) as category_vote_count,
    dense_rank() over (
      partition by t.election_id, t.category
      order by t.vote_count desc
    )::integer as category_rank
  from totals t
), annotated as (
  select
    r.*,
    count(*) filter (where r.category_rank = 1)
      over (partition by r.election_id, r.category) as first_place_count
  from ranked r
)
select
  a.election_id,
  a.candidate_id,
  a.candidate_name,
  a.department,
  a.category,
  a.is_active,
  a.vote_count,
  a.category_vote_count,
  case when a.category_vote_count = 0 then 0::numeric
       else round((a.vote_count::numeric * 100) / a.category_vote_count, 2)
  end as vote_percentage,
  a.category_rank,
  (a.category_rank = 1 and a.first_place_count > 1) as is_tied_for_first
from annotated a;

create view private.election_turnout
with (security_invoker = true)
as
select
  e.id as election_id,
  count(eh.hod_id) filter (
    where eh.is_approved and eh.is_active
  )::bigint as eligible_hod_count,
  count(distinct v.hod_id) filter (
    where eh.is_approved and eh.is_active
  )::bigint as voted_hod_count,
  case
    when count(eh.hod_id) filter (where eh.is_approved and eh.is_active) = 0 then 0::numeric
    else round(
      count(distinct v.hod_id) filter (where eh.is_approved and eh.is_active)::numeric
      * 100
      / count(eh.hod_id) filter (where eh.is_approved and eh.is_active),
      2
    )
  end as turnout_percentage
from public.elections e
left join public.election_hods eh on eh.election_id = e.id
left join public.votes v on v.election_id = e.id and v.hod_id = eh.hod_id
group by e.id;

create view private.hod_ballots
with (security_invoker = true)
as
select
  eh.election_id,
  eh.hod_id,
  eh.hod_name_snapshot as hod_name,
  eh.department_snapshot as hod_department,
  eh.mobile_normalized_snapshot,
  eh.is_approved,
  eh.is_active,
  (foh.id is not null and boh.id is not null) as has_voted,
  foh.candidate_id as foh_candidate_id,
  foh_candidate.name as foh_candidate_name,
  boh.candidate_id as boh_candidate_id,
  boh_candidate.name as boh_candidate_name,
  greatest(foh.voted_at, boh.voted_at) as ballot_submitted_at
from public.election_hods eh
left join public.votes foh
  on foh.election_id = eh.election_id and foh.hod_id = eh.hod_id and foh.category = 'FOH'
left join public.candidates foh_candidate on foh_candidate.id = foh.candidate_id
left join public.votes boh
  on boh.election_id = eh.election_id and boh.hod_id = eh.hod_id and boh.category = 'BOH'
left join public.candidates boh_candidate on boh_candidate.id = boh.candidate_id;

create view private.category_outcomes
with (security_invoker = true)
as
select
  cr.election_id,
  cr.category,
  count(*) filter (where cr.category_rank = 1)::integer as leaders_count,
  (count(*) filter (where cr.category_rank = 1) > 1) as tie_detected,
  case when count(*) filter (where cr.category_rank = 1) = 1
       then (array_agg(cr.candidate_id) filter (where cr.category_rank = 1))[1]
       else null
  end as provisional_winner_candidate_id,
  max(cr.vote_count) as highest_vote_count
from private.candidate_results cr
where cr.is_active
group by cr.election_id, cr.category;

create view private.tie_break_results
with (security_invoker = true)
as
with totals as (
  select
    tb.id as tie_break_id,
    tb.original_election_id,
    tb.category,
    tb.round_number,
    tb.status,
    c.id as candidate_id,
    c.name as candidate_name,
    count(tbv.id)::bigint as vote_count
  from public.tie_breaks tb
  join public.tie_break_candidates tbc on tbc.tie_break_id = tb.id
  join public.candidates c on c.id = tbc.candidate_id
  left join public.tie_break_votes tbv
    on tbv.tie_break_id = tb.id and tbv.candidate_id = c.id
  group by tb.id, tb.original_election_id, tb.category, tb.round_number,
           tb.status, c.id, c.name
)
select
  t.*,
  dense_rank() over (partition by t.tie_break_id order by t.vote_count desc)::integer as rank
from totals t;

create view private.final_winners
with (security_invoker = true)
as
select
  ew.election_id,
  ew.category,
  ew.candidate_id,
  c.name as candidate_name,
  c.department,
  ew.source,
  ew.tie_break_id,
  ew.finalized_at,
  ew.finalized_by
from public.election_winners ew
join public.candidates c on c.id = ew.candidate_id;

create or replace function private.finalize_winner(
  p_election_id uuid,
  p_category public.employee_category,
  p_candidate_id uuid,
  p_source public.winner_source,
  p_actor_admin_id uuid,
  p_tie_break_id uuid default null
)
returns public.election_winners
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.election_winners;
  v_expected_candidate_id uuid;
  v_tie_detected boolean;
  v_leader_count integer;
begin
  perform private.assert_admin(p_actor_admin_id, array['SYSTEM']::public.admin_role[]);
  if not exists (
    select 1 from public.elections e
    where e.id = p_election_id and e.status = 'CLOSED'
  ) then
    raise exception using errcode = '55000', message = 'Election must be CLOSED before finalizing a winner';
  end if;

  if p_source = 'NORMAL' then
    if p_tie_break_id is not null then
      raise exception using errcode = '23514', message = 'A normal winner cannot reference a tie-break';
    end if;
    select co.provisional_winner_candidate_id, co.tie_detected
      into v_expected_candidate_id, v_tie_detected
    from private.category_outcomes co
    where co.election_id = p_election_id and co.category = p_category;
    if coalesce(v_tie_detected, true) or v_expected_candidate_id is distinct from p_candidate_id then
      raise exception using errcode = '23514', message = 'Candidate is not the unique normal-election leader';
    end if;
  else
    if p_tie_break_id is null then
      raise exception using errcode = '23514', message = 'Tie-break winner requires a tie-break ID';
    end if;
    if not exists (
      select 1 from public.tie_breaks tb
      where tb.id = p_tie_break_id and tb.original_election_id = p_election_id
        and tb.category = p_category and tb.status = 'CLOSED'
    ) then
      raise exception using errcode = '23514', message = 'Matching tie-break must be CLOSED';
    end if;
    select count(*) filter (where tbr.rank = 1)::integer,
           (array_agg(tbr.candidate_id) filter (where tbr.rank = 1))[1]
      into v_leader_count, v_expected_candidate_id
    from private.tie_break_results tbr
    where tbr.tie_break_id = p_tie_break_id;
    if v_leader_count <> 1 or v_expected_candidate_id is distinct from p_candidate_id then
      raise exception using errcode = '23514', message = 'Candidate is not the unique tie-break leader';
    end if;
  end if;

  insert into public.election_winners (
    election_id, category, candidate_id, source, tie_break_id, finalized_by
  ) values (
    p_election_id, p_category, p_candidate_id, p_source, p_tie_break_id, p_actor_admin_id
  ) returning * into v_result;
  return v_result;
end;
$$;

revoke all on private.candidate_results, private.election_turnout,
  private.hod_ballots, private.category_outcomes, private.tie_break_results,
  private.final_winners from public, anon;
grant select on private.candidate_results, private.election_turnout,
  private.hod_ballots, private.category_outcomes, private.tie_break_results,
  private.final_winners to authenticated, service_role;
revoke execute on function private.finalize_winner(
  uuid, public.employee_category, uuid, public.winner_source, uuid, uuid
) from public, anon, authenticated;
grant execute on function private.finalize_winner(
  uuid, public.employee_category, uuid, public.winner_source, uuid, uuid
) to service_role;

comment on view private.candidate_results is
  'Admin-only candidate totals, percentages, category rankings, and tie flags. security_invoker preserves source-table RLS.';
comment on view private.hod_ballots is
  'Admin-only turnout detail, including each HOD FOH/BOH choice. Kept outside exposed schemas.';
