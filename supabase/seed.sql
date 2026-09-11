-- Local/demo data only. This file is not a production migration.
-- It intentionally creates a DRAFT election so no accidental voting is enabled.

select set_config('app.actor_admin_id', '10000000-0000-0000-0000-000000000001', true);

insert into private.admin_principals (id, display_name, role)
values ('10000000-0000-0000-0000-000000000001', 'Demo System Administrator', 'SYSTEM')
on conflict (id) do nothing;

insert into public.hods (id, name, mobile_number, department) values
  ('20000000-0000-0000-0000-000000000001', 'Aarav Mehta', '+91 90000 00001', 'Operations'),
  ('20000000-0000-0000-0000-000000000002', 'Diya Shah', '+91 90000 00002', 'Hospitality')
on conflict (id) do nothing;

insert into public.elections (
  id, name, election_month, election_year, created_by
) values (
  '30000000-0000-0000-0000-000000000001',
  'September 2026 Best Employee', 9, 2026,
  '10000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.election_hods (
  election_id, hod_id, is_approved, is_active,
  hod_name_snapshot, department_snapshot, mobile_normalized_snapshot
) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', true, true, 'placeholder', 'placeholder', '00000000'),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', true, true, 'placeholder', 'placeholder', '00000000')
on conflict (election_id, hod_id) do nothing;

insert into public.candidates (id, election_id, name, department, category) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Demo FOH Candidate', 'Guest Relations', 'FOH'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'Demo BOH Candidate', 'Engineering', 'BOH')
on conflict (id) do nothing;

