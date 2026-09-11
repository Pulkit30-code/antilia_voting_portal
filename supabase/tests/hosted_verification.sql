-- READ-ONLY HOSTED VERIFICATION
-- Expected result: overall_status = PASS and failed_checks = 0.

with checks(check_name, passed, detail) as (
  select
    '01_required_application_tables',
    count(*) = 13,
    format('%s of 13 required tables found', count(*))
  from (values
    ('public.hods'), ('public.elections'), ('public.election_hods'),
    ('public.candidates'), ('public.votes'), ('public.tie_breaks'),
    ('public.tie_break_candidates'), ('public.tie_break_votes'),
    ('public.election_winners'), ('private.admin_principals'),
    ('private.admin_credentials'), ('private.admin_sessions'),
    ('private.audit_logs')
  ) expected(qualified_name)
  where to_regclass(expected.qualified_name) is not null

  union all
  select
    '02_rls_enabled_on_public_application_tables',
    count(*) = 9 and bool_and(c.relrowsecurity),
    format('%s public application tables found; %s have RLS', count(*), count(*) filter (where c.relrowsecurity))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname = any(array[
      'hods', 'elections', 'election_hods', 'candidates', 'votes',
      'tie_breaks', 'tie_break_candidates', 'tie_break_votes', 'election_winners'
    ])

  union all
  select
    '03_anon_cannot_read_sensitive_relations',
    not has_table_privilege('anon', 'public.hods', 'SELECT')
      and not has_table_privilege('anon', 'public.votes', 'SELECT')
      and not has_table_privilege('anon', 'private.admin_credentials', 'SELECT')
      and not has_table_privilege('anon', 'private.audit_logs', 'SELECT')
      and not has_schema_privilege('anon', 'private', 'USAGE'),
    'anon must have no SELECT on HODs/votes/credentials/audits and no private schema usage'

  union all
  select
    '04_anon_cannot_insert_votes',
    not has_table_privilege('anon', 'public.votes', 'INSERT'),
    'anon INSERT privilege on public.votes must be false'

  union all
  select
    '05_vote_category_uniqueness',
    exists (
      select 1 from pg_constraint con
      where con.conrelid = 'public.votes'::regclass
        and con.contype = 'u'
        and pg_get_constraintdef(con.oid) = 'UNIQUE (election_id, hod_id, category)'
    ),
    'UNIQUE(election_id, hod_id, category) must exist on votes'

  union all
  select
    '06_vote_referential_constraints',
    count(*) = 2,
    format('%s of 2 required composite vote foreign keys found', count(*))
  from pg_constraint con
  where con.conrelid = 'public.votes'::regclass
    and con.contype = 'f'
    and con.conname = any(array['votes_election_hod_fkey', 'votes_candidate_match_fkey'])

  union all
  select
    '07_no_public_privileged_function_execution',
    count(*) = 0,
    format('%s private SECURITY DEFINER functions executable by PUBLIC', count(*))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where n.nspname = 'private' and p.prosecdef
    and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'

  union all
  select
    '08_security_definer_search_path',
    count(*) > 0 and bool_and(coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'),
    format('%s private SECURITY DEFINER functions checked', count(*))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prosecdef

  union all
  select
    '09_reporting_views_are_private_security_invoker',
    count(*) = 6 and bool_and(coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true']),
    format('%s of 6 private reporting views found', count(*))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relkind = 'v'
    and c.relname = any(array[
      'candidate_results', 'election_turnout', 'hod_ballots',
      'category_outcomes', 'tie_break_results', 'final_winners'
    ])

  union all
  select
    '10_election_status_enum',
    array_agg(e.enumlabel::text order by e.enumsortorder) = array['DRAFT', 'OPEN', 'CLOSED']::text[],
    array_to_string(array_agg(e.enumlabel::text order by e.enumsortorder), ',')
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typname = 'election_status'

  union all
  select
    '11_employee_category_enum',
    array_agg(e.enumlabel::text order by e.enumsortorder) = array['FOH', 'BOH']::text[],
    array_to_string(array_agg(e.enumlabel::text order by e.enumsortorder), ',')
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typname = 'employee_category'

  union all
  select
    '12_required_query_indexes',
    count(*) = 10,
    format('%s of 10 required indexes found', count(*))
  from pg_indexes i
  where (i.schemaname, i.indexname) in (
    ('public', 'elections_current_month_year_key'),
    ('public', 'elections_status_idx'),
    ('public', 'election_hods_hod_idx'),
    ('public', 'election_hods_turnout_eligible_idx'),
    ('public', 'candidates_election_category_active_idx'),
    ('public', 'votes_election_hod_category_key'),
    ('public', 'votes_election_candidate_category_idx'),
    ('public', 'votes_hod_election_idx'),
    ('public', 'tie_break_votes_candidate_idx'),
    ('private', 'audit_logs_election_idx')
  )

  union all
  select
    '13_credentials_are_hash_only',
    exists (
      select 1 from pg_constraint con
      where con.conrelid = 'private.admin_credentials'::regclass
        and con.conname = 'admin_credentials_hash_not_plaintext'
    )
    and not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'private' and c.table_name = 'admin_credentials'
        and c.column_name ilike '%passcode%'
    )
    and not exists (
      select 1 from private.admin_credentials ac
      where length(ac.password_hash) not between 50 and 512
        or not (
          (ac.hash_algorithm = 'argon2id' and ac.password_hash like '$argon2id$%')
          or (ac.hash_algorithm = 'bcrypt' and ac.password_hash ~ '^\$2[aby]\$')
        )
    ),
    'credential table has a hash-format CHECK, no passcode column, and no invalid stored hashes'

  union all
  select
    '14_audit_logs_unauthorized_dml_denied',
    not has_table_privilege('anon', 'private.audit_logs', 'INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated', 'private.audit_logs', 'INSERT,UPDATE,DELETE'),
    'anon/authenticated must have no audit INSERT, UPDATE, or DELETE privileges'

  union all
  select
    '15_votes_immutable_for_application_roles',
    not has_table_privilege('anon', 'public.votes', 'INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated', 'public.votes', 'INSERT,UPDATE,DELETE'),
    'anon/authenticated must have no direct vote write privileges'

  union all
  select
    '16_vote_immutability_trigger',
    exists (
      select 1 from pg_trigger t
      where t.tgrelid = 'public.votes'::regclass
        and t.tgname = 'votes_10_immutable' and not t.tgisinternal
    ),
    'votes_10_immutable trigger must exist'

  union all
  select
    '17_phase_1_5_migration_history',
    count(*) = 4,
    format('%s of 4 Phase 1/1.5 migrations recorded', count(*))
  from supabase_migrations.schema_migrations sm
  where sm.version in ('20260910064758', '20260910064806', '20260910064807', '20260910073529')
)
select
  case when bool_and(c.passed) then 'PASS' else 'FAIL' end as overall_status,
  count(*) filter (where c.passed) as passed_checks,
  count(*) filter (where not c.passed) as failed_checks,
  jsonb_pretty(
    jsonb_agg(
      jsonb_build_object(
        'check', c.check_name,
        'status', case when c.passed then 'PASS' else 'FAIL' end,
        'detail', c.detail
      ) order by c.check_name
    )
  ) as check_details
from checks c;
