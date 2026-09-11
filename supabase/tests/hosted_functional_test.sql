-- DEVELOPMENT / STAGING ONLY
--
-- This script creates fake test rows inside one transaction and always ends in
-- ROLLBACK. Do not run it against the production Antilia project. It uses fixed,
-- clearly scoped UUIDs and never issues DELETE, TRUNCATE, or DROP statements.
--
-- Expected result: every returned row has status = PASS, followed by ROLLBACK.

begin;

create temporary table phase_1_5_test_results (
  sequence integer generated always as identity,
  check_name text not null,
  status text not null,
  detail text not null
) on commit drop;

create or replace function pg_temp.assert_true(
  p_condition boolean,
  p_check_name text,
  p_detail text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'FAILED: % — %', p_check_name, p_detail;
  end if;
  insert into pg_temp.phase_1_5_test_results(check_name, status, detail)
  values (p_check_name, 'PASS', p_detail);
end;
$$;

create or replace function pg_temp.expect_error(
  p_sql text,
  p_expected_state text,
  p_expected_message text,
  p_check_name text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_state text;
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state = p_expected_state and v_message = p_expected_message then
      insert into pg_temp.phase_1_5_test_results(check_name, status, detail)
      values (p_check_name, 'PASS', format('Rejected with %s: %s', v_state, v_message));
      return;
    end if;
    raise exception 'FAILED: % — got %: %, expected %: %',
      p_check_name, v_state, v_message, p_expected_state, p_expected_message;
  end;
  raise exception 'FAILED: % — statement unexpectedly succeeded', p_check_name;
end;
$$;

insert into private.admin_principals (id, display_name, role)
values ('f1500000-0000-0000-0000-000000000001', '__ANTILIA_PHASE_1_5_TEST_SYSTEM__', 'SYSTEM');
select set_config('app.actor_admin_id', 'f1500000-0000-0000-0000-000000000001', true);

insert into public.hods (id, name, mobile_number, department, is_active) values
  ('f1510000-0000-0000-0000-000000000001', '__TEST_ACTIVE_HOD_ONE__', '+91 70000 15001', '__TEST_DEPT__', true),
  ('f1510000-0000-0000-0000-000000000002', '__TEST_ACTIVE_HOD_TWO__', '+91 70000 15002', '__TEST_DEPT__', true),
  ('f1510000-0000-0000-0000-000000000003', '__TEST_INACTIVE_HOD__', '+91 70000 15003', '__TEST_DEPT__', false),
  ('f1510000-0000-0000-0000-000000000004', '__TEST_UNAPPROVED_HOD__', '+91 70000 15004', '__TEST_DEPT__', true);

insert into public.elections (
  id, name, election_month, election_year, created_by
) values
  ('f1520000-0000-0000-0000-000000000001', '__ANTILIA_PHASE_1_5_PRIMARY_TEST__', 12, 2199, 'f1500000-0000-0000-0000-000000000001'),
  ('f1520000-0000-0000-0000-000000000002', '__ANTILIA_PHASE_1_5_OTHER_TEST__', 11, 2199, 'f1500000-0000-0000-0000-000000000001');

insert into public.election_hods (
  election_id, hod_id, is_approved, is_active,
  hod_name_snapshot, department_snapshot, mobile_normalized_snapshot
) values
  ('f1520000-0000-0000-0000-000000000001', 'f1510000-0000-0000-0000-000000000001', true, true, 'placeholder', 'placeholder', '00000000'),
  ('f1520000-0000-0000-0000-000000000001', 'f1510000-0000-0000-0000-000000000002', true, true, 'placeholder', 'placeholder', '00000000'),
  ('f1520000-0000-0000-0000-000000000001', 'f1510000-0000-0000-0000-000000000003', true, true, 'placeholder', 'placeholder', '00000000'),
  ('f1520000-0000-0000-0000-000000000001', 'f1510000-0000-0000-0000-000000000004', false, true, 'placeholder', 'placeholder', '00000000'),
  ('f1520000-0000-0000-0000-000000000002', 'f1510000-0000-0000-0000-000000000001', true, true, 'placeholder', 'placeholder', '00000000');

insert into public.candidates (id, election_id, name, department, category) values
  ('f1530000-0000-0000-0000-000000000001', 'f1520000-0000-0000-0000-000000000001', '__TEST_FOH_A__', '__TEST_FOH__', 'FOH'),
  ('f1530000-0000-0000-0000-000000000002', 'f1520000-0000-0000-0000-000000000001', '__TEST_FOH_B__', '__TEST_FOH__', 'FOH'),
  ('f1530000-0000-0000-0000-000000000003', 'f1520000-0000-0000-0000-000000000001', '__TEST_BOH_A__', '__TEST_BOH__', 'BOH'),
  ('f1530000-0000-0000-0000-000000000004', 'f1520000-0000-0000-0000-000000000001', '__TEST_BOH_B__', '__TEST_BOH__', 'BOH'),
  ('f1530000-0000-0000-0000-000000000005', 'f1520000-0000-0000-0000-000000000002', '__TEST_OTHER_FOH__', '__TEST_OTHER__', 'FOH'),
  ('f1530000-0000-0000-0000-000000000006', 'f1520000-0000-0000-0000-000000000002', '__TEST_OTHER_BOH__', '__TEST_OTHER__', 'BOH');

select pg_temp.assert_true(
  (select not eh.is_active from public.election_hods eh
   where eh.election_id = 'f1520000-0000-0000-0000-000000000001'
     and eh.hod_id = 'f1510000-0000-0000-0000-000000000003'),
  'inactive_hod_snapshot_hardened',
  'Globally inactive HOD was forced inactive in election eligibility'
);

select pg_temp.expect_error(
  $sql$select * from private.submit_ballot(
    'f1520000-0000-0000-0000-000000000001', '+91 70000 15001',
    'f1530000-0000-0000-0000-000000000001', 'f1530000-0000-0000-0000-000000000003'
  )$sql$,
  '55000', 'Election is not OPEN', 'draft_election_rejects_voting'
);

select private.set_election_status(
  'f1520000-0000-0000-0000-000000000001', 'OPEN',
  'f1500000-0000-0000-0000-000000000001'
);
set constraints votes_99_complete_ballot immediate;

select * from private.submit_ballot(
  'f1520000-0000-0000-0000-000000000001', '+91 70000 15001',
  'f1530000-0000-0000-0000-000000000001', 'f1530000-0000-0000-0000-000000000003'
);

select pg_temp.assert_true(
  (select count(*) = 2
     and count(*) filter (where category = 'FOH') = 1
     and count(*) filter (where category = 'BOH') = 1
   from public.votes
   where election_id = 'f1520000-0000-0000-0000-000000000001'
     and hod_id = 'f1510000-0000-0000-0000-000000000001'),
  'open_election_accepts_complete_ballot',
  'Exactly one FOH and one BOH vote were committed'
);

select pg_temp.expect_error(
  $sql$insert into public.votes (
    election_id, hod_id, candidate_id, category, ballot_id
  ) values (
    'f1520000-0000-0000-0000-000000000001', 'f1510000-0000-0000-0000-000000000001',
    'f1530000-0000-0000-0000-000000000002', 'FOH', 'f1540000-0000-0000-0000-000000000001'
  )$sql$,
  '23505',
  'duplicate key value violates unique constraint "votes_election_hod_category_key"',
  'duplicate_foh_vote_rejected'
);

select pg_temp.expect_error(
  $sql$insert into public.votes (
    election_id, hod_id, candidate_id, category, ballot_id
  ) values (
    'f1520000-0000-0000-0000-000000000001', 'f1510000-0000-0000-0000-000000000001',
    'f1530000-0000-0000-0000-000000000004', 'BOH', 'f1540000-0000-0000-0000-000000000002'
  )$sql$,
  '23505',
  'duplicate key value violates unique constraint "votes_election_hod_category_key"',
  'duplicate_boh_vote_rejected'
);

select pg_temp.expect_error(
  $sql$select * from private.submit_ballot(
    'f1520000-0000-0000-0000-000000000001', '+91 70000 15002',
    'f1530000-0000-0000-0000-000000000003', 'f1530000-0000-0000-0000-000000000004'
  )$sql$,
  '23514', 'Invalid FOH candidate', 'wrong_category_candidate_rejected'
);

select pg_temp.expect_error(
  $sql$select * from private.submit_ballot(
    'f1520000-0000-0000-0000-000000000001', '+91 70000 15002',
    'f1530000-0000-0000-0000-000000000005', 'f1530000-0000-0000-0000-000000000003'
  )$sql$,
  '23514', 'Invalid FOH candidate', 'other_election_candidate_rejected'
);

select pg_temp.expect_error(
  $sql$select * from private.submit_ballot(
    'f1520000-0000-0000-0000-000000000001', '+91 70000 15003',
    'f1530000-0000-0000-0000-000000000002', 'f1530000-0000-0000-0000-000000000004'
  )$sql$,
  '42501', 'HOD is unknown, inactive, or not approved for this election',
  'inactive_hod_rejected'
);

select pg_temp.expect_error(
  $sql$select * from private.submit_ballot(
    'f1520000-0000-0000-0000-000000000001', '+91 70000 15004',
    'f1530000-0000-0000-0000-000000000002', 'f1530000-0000-0000-0000-000000000004'
  )$sql$,
  '42501', 'HOD is unknown, inactive, or not approved for this election',
  'unapproved_hod_rejected'
);

select pg_temp.expect_error(
  $sql$select * from private.submit_ballot(
    'f1520000-0000-0000-0000-000000000001', '+91 70000 15002',
    'f1530000-0000-0000-0000-000000000002', 'f1530000-0000-0000-0000-000000000001'
  )$sql$,
  '23514', 'Invalid BOH candidate', 'invalid_boh_aborts_entire_ballot'
);

select pg_temp.assert_true(
  (select count(*) = 0 from public.votes
   where election_id = 'f1520000-0000-0000-0000-000000000001'
     and hod_id = 'f1510000-0000-0000-0000-000000000002'),
  'invalid_ballot_rollback_confirmed',
  'Neither FOH nor BOH vote remains after invalid BOH selection'
);

select * from private.submit_ballot(
  'f1520000-0000-0000-0000-000000000001', '+91 70000 15002',
  'f1530000-0000-0000-0000-000000000002', 'f1530000-0000-0000-0000-000000000004'
);

select pg_temp.expect_error(
  $sql$update public.votes
    set user_agent = '__FORBIDDEN_EDIT__'
    where election_id = 'f1520000-0000-0000-0000-000000000001'
      and hod_id = 'f1510000-0000-0000-0000-000000000001'
      and category = 'FOH'$sql$,
  '55000', 'Vote history is immutable', 'original_votes_cannot_be_edited'
);

select pg_temp.assert_true(
  (select count(*) = 4 and min(vote_count) = 1 and max(vote_count) = 1
   from private.candidate_results
   where election_id = 'f1520000-0000-0000-0000-000000000001'),
  'results_aggregate_correctly',
  'Four candidates each have one vote in the deliberately tied test result'
);

select pg_temp.assert_true(
  (select eligible_hod_count = 2 and voted_hod_count = 2 and turnout_percentage = 100.00
   from private.election_turnout
   where election_id = 'f1520000-0000-0000-0000-000000000001'),
  'turnout_query_works',
  'Two eligible HODs voted, producing 100 percent turnout'
);

select pg_temp.assert_true(
  (select has_voted
     and foh_candidate_id = 'f1530000-0000-0000-0000-000000000001'
     and boh_candidate_id = 'f1530000-0000-0000-0000-000000000003'
   from private.hod_ballots
   where election_id = 'f1520000-0000-0000-0000-000000000001'
     and hod_id = 'f1510000-0000-0000-0000-000000000001'),
  'individual_hod_choice_query_works',
  'Administrative ballot view returns the selected FOH and BOH candidates'
);

select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(tie_detected)
   from private.category_outcomes
   where election_id = 'f1520000-0000-0000-0000-000000000001'),
  'tie_detection_works',
  'FOH and BOH both report a first-place tie'
);

select private.set_election_status(
  'f1520000-0000-0000-0000-000000000001', 'CLOSED',
  'f1500000-0000-0000-0000-000000000001'
);

select pg_temp.expect_error(
  $sql$select * from private.submit_ballot(
    'f1520000-0000-0000-0000-000000000001', '+91 70000 15004',
    'f1530000-0000-0000-0000-000000000001', 'f1530000-0000-0000-0000-000000000003'
  )$sql$,
  '55000', 'Election is not OPEN', 'closed_election_rejects_voting'
);

select check_name, status, detail
from pg_temp.phase_1_5_test_results
order by sequence;

rollback;

