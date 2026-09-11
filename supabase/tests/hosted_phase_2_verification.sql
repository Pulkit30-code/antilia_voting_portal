-- Read-only hosted verification for Phase 2 authentication structures.
-- Safe for the real Antilia project: this file performs catalog reads only.

with required_functions(name) as (
  values
    ('antilia_auth_bootstrap'),
    ('antilia_auth_get_credential'),
    ('antilia_auth_begin_login_attempt'),
    ('antilia_auth_record_login_failure'),
    ('antilia_auth_create_session'),
    ('antilia_auth_validate_session'),
    ('antilia_auth_revoke_session'),
    ('antilia_auth_change_passcode')
), checks as (
  select
    '01_login_attempt_table_private' as check_name,
    case when to_regclass('private.admin_login_attempts') is not null
      then 'PASS' else 'FAIL' end as status,
    'private.admin_login_attempts must exist' as detail

  union all
  select
    '02_login_attempt_rls',
    case when exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relname = 'admin_login_attempts'
        and c.relrowsecurity
    ) then 'PASS' else 'FAIL' end,
    'persistent rate-limit state must have RLS enabled'

  union all
  select
    '03_required_rpc_gateways',
    case when (
      select count(distinct p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join required_functions rf on rf.name = p.proname
      where n.nspname = 'public'
    ) = 8 then 'PASS' else 'FAIL' end,
    'all 8 service-only authentication RPC gateways must exist'

  union all
  select
    '04_rpc_not_browser_executable',
    case when not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join required_functions rf on rf.name = p.proname
      where n.nspname = 'public'
        and (
          has_function_privilege('public', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
        )
    ) then 'PASS' else 'FAIL' end,
    'PUBLIC, anon, and authenticated must not execute auth gateways'

  union all
  select
    '05_rpc_service_role_only',
    case when (
      select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join required_functions rf on rf.name = p.proname
      where n.nspname = 'public'
        and has_function_privilege('service_role', p.oid, 'execute')
    ) = 8 then 'PASS' else 'FAIL' end,
    'all authentication gateways must be executable by service_role'

  union all
  select
    '06_rpc_search_path_hardened',
    case when not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join required_functions rf on rf.name = p.proname
      where n.nspname = 'public'
        and (
          not p.prosecdef
          or not coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
        )
    ) then 'PASS' else 'FAIL' end,
    'every SECURITY DEFINER gateway must use an empty search_path'

  union all
  select
    '07_session_hash_storage',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'private' and table_name = 'admin_sessions'
        and column_name = 'token_hash' and data_type = 'bytea'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'private' and table_name = 'admin_sessions'
        and column_name in ('token', 'session_token', 'raw_token')
    ) then 'PASS' else 'FAIL' end,
    'sessions store token_hash bytea and no raw-token column'

  union all
  select
    '08_rate_limit_minimizes_ip_data',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'private' and table_name = 'admin_login_attempts'
        and column_name = 'ip_hash' and data_type = 'bytea'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'private' and table_name = 'admin_login_attempts'
        and column_name in ('ip', 'ip_address', 'raw_ip')
    ) then 'PASS' else 'FAIL' end,
    'login throttling stores only a fixed-size IP fingerprint'

  union all
  select
    '09_one_active_principal_per_role',
    case when to_regclass('private.admin_principals_one_active_role_key') is not null
      then 'PASS' else 'FAIL' end,
    'one active shared principal is enforced for each HR/SYSTEM role'

  union all
  select
    '10_auth_audit_actions',
    case when (
      select count(*) from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'audit_action'
        and e.enumlabel in (
          'HR_LOGIN_SUCCESS', 'HR_LOGIN_FAILED',
          'SYSTEM_LOGIN_SUCCESS', 'SYSTEM_LOGIN_FAILED',
          'ADMIN_LOGOUT', 'SESSION_REVOKED'
        )
    ) = 6 then 'PASS' else 'FAIL' end,
    'Phase 2 login/logout/session audit actions must exist'

  union all
  select
    '11_system_change_authorization',
    case when position(
      'v_actor_role <> ''SYSTEM'''
      in pg_get_functiondef('public.antilia_auth_change_passcode(bytea,public.admin_role,text,text)'::regprocedure)
    ) > 0 then 'PASS' else 'FAIL' end,
    'PostgreSQL passcode changes must independently require SYSTEM'

  union all
  select
    '12_rate_limit_index',
    case when to_regclass('private.admin_login_attempts_locked_idx') is not null
      then 'PASS' else 'FAIL' end,
    'expired lockout cleanup/query path must be indexed'
), summary as (
  select
    count(*) filter (where status = 'PASS')::integer as passed_checks,
    count(*) filter (where status = 'FAIL')::integer as failed_checks,
    jsonb_agg(
      jsonb_build_object('check', check_name, 'status', status, 'detail', detail)
      order by check_name
    ) as check_details
  from checks
)
select
  case when failed_checks = 0 then 'PASS' else 'FAIL' end as overall_status,
  passed_checks,
  failed_checks,
  check_details
from summary;
