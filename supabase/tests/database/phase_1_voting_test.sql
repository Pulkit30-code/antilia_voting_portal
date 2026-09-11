begin;
select plan(17);

insert into private.admin_principals (id, display_name, role)
values ('a0000000-0000-0000-0000-000000000001', 'Test System', 'SYSTEM');

insert into public.hods (id, name, mobile_number, department, is_active) values
  ('a1000000-0000-0000-0000-000000000001', 'Active HOD One', '+91 81111 11111', 'Operations', true),
  ('a1000000-0000-0000-0000-000000000002', 'Active HOD Two', '+91 82222 22222', 'Hospitality', true),
  ('a1000000-0000-0000-0000-000000000003', 'Inactive HOD', '+91 83333 33333', 'Finance', false);

insert into public.elections (id, name, election_month, election_year, created_by) values
  ('a2000000-0000-0000-0000-000000000001', 'Primary Test Election', 1, 2098, 'a0000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000002', 'Other Test Election', 2, 2098, 'a0000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000003', 'Tie Test Election', 3, 2098, 'a0000000-0000-0000-0000-000000000001');

insert into public.election_hods (
  election_id, hod_id, is_approved, is_active,
  hod_name_snapshot, department_snapshot, mobile_normalized_snapshot
) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', true, true, 'x', 'x', '00000000'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', true, true, 'x', 'x', '00000000'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', true, true, 'x', 'x', '00000000'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', true, true, 'x', 'x', '00000000'),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', true, true, 'x', 'x', '00000000'),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', true, true, 'x', 'x', '00000000');

insert into public.candidates (id, election_id, name, department, category) values
  ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Primary FOH A', 'FOH A', 'FOH'),
  ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'Primary FOH B', 'FOH B', 'FOH'),
  ('a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'Primary BOH A', 'BOH A', 'BOH'),
  ('a3000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', 'Primary BOH B', 'BOH B', 'BOH'),
  ('a3000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000002', 'Other FOH', 'Other', 'FOH'),
  ('a3000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000002', 'Other BOH', 'Other', 'BOH'),
  ('a3000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000003', 'Tie FOH A', 'Tie A', 'FOH'),
  ('a3000000-0000-0000-0000-000000000008', 'a2000000-0000-0000-0000-000000000003', 'Tie FOH B', 'Tie B', 'FOH'),
  ('a3000000-0000-0000-0000-000000000009', 'a2000000-0000-0000-0000-000000000003', 'Tie BOH', 'Tie BOH', 'BOH');

select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 81111 11111', 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000003')$$,
  '55000', 'Election is not OPEN',
  'DRAFT election cannot receive votes'
);

select private.set_election_status('a2000000-0000-0000-0000-000000000001', 'OPEN', 'a0000000-0000-0000-0000-000000000001');
set constraints votes_99_complete_ballot immediate;

select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 83333 33333', 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000003')$$,
  '42501', 'HOD is unknown, inactive, or not approved for this election',
  'inactive HOD cannot vote'
);
select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 89999 99999', 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000003')$$,
  '42501', 'HOD is unknown, inactive, or not approved for this election',
  'unknown HOD cannot vote'
);
select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 81111 11111', 'a3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000004')$$,
  '23514', 'Invalid FOH candidate',
  'BOH candidate cannot be submitted as FOH'
);
select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 81111 11111', 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002')$$,
  '23514', 'Invalid BOH candidate',
  'FOH candidate cannot be submitted as BOH'
);
select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 81111 11111', 'a3000000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-000000000003')$$,
  '23514', 'Invalid FOH candidate',
  'candidate from another election cannot be selected'
);

select lives_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 81111 11111', 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000003')$$,
  'OPEN election accepts a valid atomic ballot'
);
select is(
  (select count(*) from public.votes where election_id = 'a2000000-0000-0000-0000-000000000001' and hod_id = 'a1000000-0000-0000-0000-000000000001'),
  2::bigint,
  'same HOD has exactly one FOH and one BOH vote'
);
select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 81111 11111', 'a3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000004')$$,
  '23505', 'HOD has already submitted a ballot for this election',
  'HOD cannot vote twice for FOH'
);
select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 81111 11111', 'a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000004')$$,
  '23505', 'HOD has already submitted a ballot for this election',
  'HOD cannot vote twice for BOH'
);

select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 82222 22222', 'a3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001')$$,
  '23514', 'Invalid BOH candidate',
  'one invalid category aborts the ballot'
);
select is(
  (select count(*) from public.votes where election_id = 'a2000000-0000-0000-0000-000000000001' and hod_id = 'a1000000-0000-0000-0000-000000000002'),
  0::bigint,
  'transaction rollback leaves neither category vote'
);
select throws_ok(
  $$update public.candidates set name = 'Forbidden Change' where id = 'a3000000-0000-0000-0000-000000000001'$$,
  '55000', 'Candidate configuration is locked after an election opens',
  'HR cannot modify candidates after election becomes OPEN'
);

select private.set_election_status('a2000000-0000-0000-0000-000000000001', 'CLOSED', 'a0000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from private.submit_ballot('a2000000-0000-0000-0000-000000000001', '+91 82222 22222', 'a3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000004')$$,
  '55000', 'Election is not OPEN',
  'CLOSED election cannot receive votes'
);

select private.set_election_status('a2000000-0000-0000-0000-000000000003', 'OPEN', 'a0000000-0000-0000-0000-000000000001');
select private.submit_ballot('a2000000-0000-0000-0000-000000000003', '+91 81111 11111', 'a3000000-0000-0000-0000-000000000007', 'a3000000-0000-0000-0000-000000000009');
select private.submit_ballot('a2000000-0000-0000-0000-000000000003', '+91 82222 22222', 'a3000000-0000-0000-0000-000000000008', 'a3000000-0000-0000-0000-000000000009');
select private.set_election_status('a2000000-0000-0000-0000-000000000003', 'CLOSED', 'a0000000-0000-0000-0000-000000000001');
create temporary table original_vote_count as
select count(*)::bigint as count from public.votes where election_id = 'a2000000-0000-0000-0000-000000000003';
select lives_ok(
  $$select private.initiate_tie_break('a2000000-0000-0000-0000-000000000003', 'FOH', 'a0000000-0000-0000-0000-000000000001')$$,
  'SYSTEM can initiate a real first-place tie-break'
);
select is(
  (select count(*) from public.tie_break_candidates tbc join public.tie_breaks tb on tb.id = tbc.tie_break_id where tb.original_election_id = 'a2000000-0000-0000-0000-000000000003'),
  2::bigint,
  'tie-break includes only tied leaders'
);
select is(
  (select count(*) from public.votes where election_id = 'a2000000-0000-0000-0000-000000000003'),
  (select count from original_vote_count),
  'tie-break preserves original election votes/results'
);

select * from finish();
rollback;
