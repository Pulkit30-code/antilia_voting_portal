-- READ-ONLY HOSTED PREFLIGHT
-- Run before `supabase db push`. Any existing Antilia object without matching
-- migration history is a conflict that must be reviewed; do not push blindly.

with expected_objects(schema_name, object_name, expected_kind) as (
  values
    ('public', 'hods', 'table'),
    ('public', 'elections', 'table'),
    ('public', 'election_hods', 'table'),
    ('public', 'candidates', 'table'),
    ('public', 'votes', 'table'),
    ('public', 'tie_breaks', 'table'),
    ('public', 'tie_break_candidates', 'table'),
    ('public', 'tie_break_votes', 'table'),
    ('public', 'election_winners', 'table'),
    ('private', 'admin_principals', 'table'),
    ('private', 'admin_credentials', 'table'),
    ('private', 'admin_sessions', 'table'),
    ('private', 'audit_logs', 'table'),
    ('private', 'candidate_results', 'view'),
    ('private', 'election_turnout', 'view'),
    ('private', 'hod_ballots', 'view'),
    ('private', 'category_outcomes', 'view'),
    ('private', 'tie_break_results', 'view'),
    ('private', 'final_winners', 'view')
), expected_types(schema_name, object_name, expected_kind) as (
  values
    ('public', 'employee_category', 'type'),
    ('public', 'election_status', 'type'),
    ('public', 'admin_role', 'type'),
    ('public', 'actor_type', 'type'),
    ('public', 'winner_source', 'type'),
    ('public', 'audit_action', 'type')
), expected_functions(schema_name, object_name, expected_kind) as (
  values
    ('private', 'submit_ballot', 'function'),
    ('private', 'submit_tie_break_vote', 'function'),
    ('private', 'set_election_status', 'function'),
    ('private', 'reset_election', 'function'),
    ('private', 'initiate_tie_break', 'function'),
    ('private', 'finalize_winner', 'function')
), existing_relations as (
  select
    e.schema_name,
    e.object_name,
    e.expected_kind,
    case c.relkind when 'r' then 'table' when 'v' then 'view'
      when 'm' then 'materialized view' else c.relkind::text end as actual_kind
  from expected_objects e
  join pg_namespace n on n.nspname = e.schema_name
  join pg_class c on c.relnamespace = n.oid and c.relname = e.object_name
), existing_types as (
  select e.schema_name, e.object_name, e.expected_kind, 'type'::text as actual_kind
  from expected_types e
  join pg_namespace n on n.nspname = e.schema_name
  join pg_type t on t.typnamespace = n.oid and t.typname = e.object_name
), existing_functions as (
  select distinct e.schema_name, e.object_name, e.expected_kind, 'function'::text as actual_kind
  from expected_functions e
  join pg_namespace n on n.nspname = e.schema_name
  join pg_proc p on p.pronamespace = n.oid and p.proname = e.object_name
), existing_objects as (
  select * from existing_relations
  union all select * from existing_types
  union all select * from existing_functions
)
select
  case
    when (select count(*) from existing_objects) = 0 then 'CLEAN_NO_NAMED_CONFLICTS'
    else 'REVIEW_EXISTING_OBJECTS'
  end as preflight_status,
  (select count(*) from existing_objects) as existing_named_objects,
  coalesce(
    (select jsonb_agg(to_jsonb(x) order by x.schema_name, x.object_name) from existing_objects x),
    '[]'::jsonb
  ) as existing_object_details;
