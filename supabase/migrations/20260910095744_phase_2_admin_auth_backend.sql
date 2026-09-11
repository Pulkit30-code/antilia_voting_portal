-- Antilia Voting Portal - Phase 2 shared-admin authentication backend.
--
-- The private schema remains outside the Data API. Narrow public RPC gateways
-- are required so a Next.js server can use the Supabase secret key without a
-- direct database password. Every gateway revokes PUBLIC/anon/authenticated
-- execution and grants only service_role.

alter type public.audit_action add value if not exists 'HR_LOGIN_SUCCESS';
alter type public.audit_action add value if not exists 'HR_LOGIN_FAILED';
alter type public.audit_action add value if not exists 'SYSTEM_LOGIN_SUCCESS';
alter type public.audit_action add value if not exists 'SYSTEM_LOGIN_FAILED';
alter type public.audit_action add value if not exists 'ADMIN_LOGOUT';
alter type public.audit_action add value if not exists 'SESSION_REVOKED';

-- The application intentionally has one active shared administrative identity
-- per role. Historical/inactive principals may remain for audit retention.
create unique index admin_principals_one_active_role_key
  on private.admin_principals (role)
  where is_active;

alter table private.admin_sessions
  add column ip_hash bytea,
  add column user_agent_hash bytea,
  add constraint admin_sessions_ip_hash_length
    check (ip_hash is null or octet_length(ip_hash) = 32),
  add constraint admin_sessions_user_agent_hash_length
    check (user_agent_hash is null or octet_length(user_agent_hash) = 32);

create table private.admin_login_attempts (
  role public.admin_role not null,
  ip_hash bytea not null,
  attempt_count smallint not null default 0 check (attempt_count between 0 and 1000),
  window_started_at timestamptz not null default clock_timestamp(),
  locked_until timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (role, ip_hash),
  constraint admin_login_attempts_ip_hash_length check (octet_length(ip_hash) = 32),
  constraint admin_login_attempts_lock_check
    check (locked_until is null or locked_until >= window_started_at)
);

create index admin_login_attempts_locked_idx
  on private.admin_login_attempts (locked_until)
  where locked_until is not null;

create trigger admin_login_attempts_90_updated_at
before update on private.admin_login_attempts
for each row execute function private.set_updated_at();

alter table private.admin_login_attempts enable row level security;
revoke all on private.admin_login_attempts from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

create or replace function public.antilia_auth_bootstrap(
  p_hr_password_hash text,
  p_system_password_hash text,
  p_hash_algorithm text default 'argon2id'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system_id uuid;
  v_hr_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('antilia-auth-bootstrap', 0)
  );

  if exists (select 1 from private.admin_credentials) then
    raise exception using errcode = '55000',
      message = 'Administrative credentials have already been bootstrapped';
  end if;

  select ap.id into v_system_id
  from private.admin_principals ap
  where ap.role = 'SYSTEM' and ap.is_active
  for update;

  if v_system_id is null then
    insert into private.admin_principals (display_name, role)
    values ('System Administration', 'SYSTEM')
    returning id into v_system_id;
  end if;

  select ap.id into v_hr_id
  from private.admin_principals ap
  where ap.role = 'HR' and ap.is_active
  for update;

  if v_hr_id is null then
    insert into private.admin_principals (display_name, role, created_by)
    values ('Human Resources', 'HR', v_system_id)
    returning id into v_hr_id;
  end if;

  perform set_config('app.actor_admin_id', v_system_id::text, true);

  insert into private.admin_credentials (
    role,
    password_hash,
    hash_algorithm,
    password_changed_by
  ) values
    ('HR', p_hr_password_hash, p_hash_algorithm, v_system_id),
    ('SYSTEM', p_system_password_hash, p_hash_algorithm, v_system_id);
end;
$$;

create or replace function public.antilia_auth_get_credential(
  p_role public.admin_role
)
returns table (
  admin_principal_id uuid,
  password_hash text,
  hash_algorithm text
)
language sql
stable
security definer
set search_path = ''
as $$
  select ap.id, ac.password_hash, ac.hash_algorithm
  from private.admin_credentials ac
  join private.admin_principals ap on ap.role = ac.role and ap.is_active
  where ac.role = p_role;
$$;

create or replace function public.antilia_auth_begin_login_attempt(
  p_role public.admin_role,
  p_ip_hash bytea
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.admin_login_attempts%rowtype;
  v_now timestamptz := clock_timestamp();
  v_next_count smallint;
begin
  if octet_length(p_ip_hash) <> 32 then
    raise exception using errcode = '22023', message = 'Invalid IP fingerprint';
  end if;

  loop
    select la.* into v_row
    from private.admin_login_attempts la
    where la.role = p_role and la.ip_hash = p_ip_hash
    for update;

    if not found then
      begin
        insert into private.admin_login_attempts (
          role, ip_hash, attempt_count, window_started_at
        ) values (p_role, p_ip_hash, 1, v_now);
        return query select true, 0;
        return;
      exception when unique_violation then
        -- A concurrent first request won the insert; lock and inspect it.
      end;
    else
      if v_row.locked_until is not null and v_row.locked_until > v_now then
        return query select false,
          greatest(1, ceil(extract(epoch from (v_row.locked_until - v_now)))::integer);
        return;
      end if;

      if v_row.window_started_at <= v_now - interval '15 minutes' then
        update private.admin_login_attempts la
        set attempt_count = 1,
            window_started_at = v_now,
            locked_until = null
        where la.role = p_role and la.ip_hash = p_ip_hash;
        return query select true, 0;
        return;
      end if;

      v_next_count := v_row.attempt_count + 1;
      update private.admin_login_attempts la
      set attempt_count = v_next_count,
          locked_until = case
            when v_next_count >= 5 then v_now + interval '15 minutes'
            else null
          end
      where la.role = p_role and la.ip_hash = p_ip_hash;

      -- The fifth attempt is evaluated. Its failure locks subsequent attempts;
      -- a success clears the row when the session is created.
      return query select true, 0;
      return;
    end if;
  end loop;
end;
$$;

create or replace function public.antilia_auth_record_login_failure(
  p_role public.admin_role,
  p_rate_limited boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.audit_logs (action, actor_type, metadata)
  values (
    case p_role
      when 'HR' then 'HR_LOGIN_FAILED'::public.audit_action
      else 'SYSTEM_LOGIN_FAILED'::public.audit_action
    end,
    'SERVICE',
    jsonb_build_object('role', p_role, 'rate_limited', p_rate_limited)
  );
end;
$$;

create or replace function public.antilia_auth_create_session(
  p_role public.admin_role,
  p_ip_hash bytea,
  p_token_hash bytea,
  p_expires_at timestamptz,
  p_user_agent_hash bytea default null
)
returns table (
  session_id uuid,
  admin_principal_id uuid,
  role public.admin_role,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  v_session_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if octet_length(p_ip_hash) <> 32
     or octet_length(p_token_hash) <> 32
     or (p_user_agent_hash is not null and octet_length(p_user_agent_hash) <> 32) then
    raise exception using errcode = '22023', message = 'Invalid security fingerprint';
  end if;
  if p_expires_at <= v_now or p_expires_at > v_now + interval '8 hours 1 minute' then
    raise exception using errcode = '22023', message = 'Invalid session expiration';
  end if;

  select ap.id into v_admin_id
  from private.admin_principals ap
  join private.admin_credentials ac on ac.role = ap.role
  where ap.role = p_role and ap.is_active
  for share of ap, ac;
  if v_admin_id is null then
    raise exception using errcode = '42501', message = 'Administrative credential unavailable';
  end if;

  delete from private.admin_login_attempts la
  where la.role = p_role and la.ip_hash = p_ip_hash;

  insert into private.admin_sessions (
    admin_principal_id,
    token_hash,
    expires_at,
    ip_hash,
    user_agent_hash
  ) values (
    v_admin_id,
    p_token_hash,
    p_expires_at,
    p_ip_hash,
    p_user_agent_hash
  ) returning id into v_session_id;

  insert into private.audit_logs (
    action, actor_type, actor_admin_id, metadata
  ) values (
    case p_role
      when 'HR' then 'HR_LOGIN_SUCCESS'::public.audit_action
      else 'SYSTEM_LOGIN_SUCCESS'::public.audit_action
    end,
    p_role::text::public.actor_type,
    v_admin_id,
    jsonb_build_object('session_id', v_session_id)
  );

  return query select v_session_id, v_admin_id, p_role, p_expires_at;
end;
$$;

create or replace function public.antilia_auth_validate_session(
  p_token_hash bytea
)
returns table (
  session_id uuid,
  admin_principal_id uuid,
  role public.admin_role,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, ap.id, ap.role, s.expires_at
  from private.admin_sessions s
  join private.admin_principals ap on ap.id = s.admin_principal_id
  join private.admin_credentials ac on ac.role = ap.role
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > clock_timestamp()
    and ap.is_active;
$$;

create or replace function public.antilia_auth_revoke_session(
  p_token_hash bytea
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_admin_id uuid;
  v_role public.admin_role;
begin
  select s.id, ap.id, ap.role
    into v_session_id, v_admin_id, v_role
  from private.admin_sessions s
  join private.admin_principals ap on ap.id = s.admin_principal_id
  where s.token_hash = p_token_hash and s.revoked_at is null
  for update of s;

  if v_session_id is null then
    return false;
  end if;

  update private.admin_sessions s
  set revoked_at = clock_timestamp()
  where s.id = v_session_id;

  insert into private.audit_logs (
    action, actor_type, actor_admin_id, metadata
  ) values (
    'ADMIN_LOGOUT',
    v_role::text::public.actor_type,
    v_admin_id,
    jsonb_build_object('session_id', v_session_id)
  );
  return true;
end;
$$;

create or replace function public.antilia_auth_change_passcode(
  p_actor_token_hash bytea,
  p_target_role public.admin_role,
  p_password_hash text,
  p_hash_algorithm text
)
returns table (
  revoked_session_count integer,
  current_session_retained boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_session_id uuid;
  v_actor_admin_id uuid;
  v_actor_role public.admin_role;
  v_revoked_count integer;
begin
  select s.id, ap.id, ap.role
    into v_actor_session_id, v_actor_admin_id, v_actor_role
  from private.admin_sessions s
  join private.admin_principals ap on ap.id = s.admin_principal_id
  where s.token_hash = p_actor_token_hash
    and s.revoked_at is null
    and s.expires_at > clock_timestamp()
    and ap.is_active
  for update of s, ap;

  if v_actor_session_id is null or v_actor_role <> 'SYSTEM' then
    raise exception using errcode = '42501', message = 'Active SYSTEM session required';
  end if;

  perform set_config('app.actor_admin_id', v_actor_admin_id::text, true);

  update private.admin_credentials ac
  set password_hash = p_password_hash,
      hash_algorithm = p_hash_algorithm,
      password_changed_at = clock_timestamp(),
      password_changed_by = v_actor_admin_id
  where ac.role = p_target_role;
  if not found then
    raise exception using errcode = 'P0002', message = 'Administrative credential unavailable';
  end if;

  with revoked as (
    update private.admin_sessions s
    set revoked_at = clock_timestamp()
    from private.admin_principals ap
    where ap.id = s.admin_principal_id
      and ap.role = p_target_role
      and s.revoked_at is null
      and (p_target_role = 'HR' or s.id <> v_actor_session_id)
    returning s.id
  )
  select count(*)::integer into v_revoked_count from revoked;

  if v_revoked_count > 0 then
    insert into private.audit_logs (
      action, actor_type, actor_admin_id, metadata
    ) values (
      'SESSION_REVOKED',
      'SYSTEM',
      v_actor_admin_id,
      jsonb_build_object(
        'target_role', p_target_role,
        'revoked_session_count', v_revoked_count,
        'current_system_session_retained', p_target_role = 'SYSTEM'
      )
    );
  end if;

  return query select v_revoked_count, (p_target_role = 'SYSTEM');
end;
$$;

revoke execute on function public.antilia_auth_bootstrap(text, text, text)
  from public, anon, authenticated;
revoke execute on function public.antilia_auth_get_credential(public.admin_role)
  from public, anon, authenticated;
revoke execute on function public.antilia_auth_begin_login_attempt(public.admin_role, bytea)
  from public, anon, authenticated;
revoke execute on function public.antilia_auth_record_login_failure(public.admin_role, boolean)
  from public, anon, authenticated;
revoke execute on function public.antilia_auth_create_session(
  public.admin_role, bytea, bytea, timestamptz, bytea
) from public, anon, authenticated;
revoke execute on function public.antilia_auth_validate_session(bytea)
  from public, anon, authenticated;
revoke execute on function public.antilia_auth_revoke_session(bytea)
  from public, anon, authenticated;
revoke execute on function public.antilia_auth_change_passcode(
  bytea, public.admin_role, text, text
) from public, anon, authenticated;

grant execute on function public.antilia_auth_bootstrap(text, text, text)
  to service_role;
grant execute on function public.antilia_auth_get_credential(public.admin_role)
  to service_role;
grant execute on function public.antilia_auth_begin_login_attempt(public.admin_role, bytea)
  to service_role;
grant execute on function public.antilia_auth_record_login_failure(public.admin_role, boolean)
  to service_role;
grant execute on function public.antilia_auth_create_session(
  public.admin_role, bytea, bytea, timestamptz, bytea
) to service_role;
grant execute on function public.antilia_auth_validate_session(bytea)
  to service_role;
grant execute on function public.antilia_auth_revoke_session(bytea)
  to service_role;
grant execute on function public.antilia_auth_change_passcode(
  bytea, public.admin_role, text, text
) to service_role;

comment on table private.admin_login_attempts is
  'Persistent server-side login throttling keyed by HMAC-SHA-256 IP fingerprint and role. Raw IP addresses are not stored.';
comment on function public.antilia_auth_bootstrap(text, text, text) is
  'One-time service-role bootstrap. Accepts pre-hashed credentials only, fails after credentials exist, and never accepts plaintext passcodes.';
comment on function public.antilia_auth_get_credential(public.admin_role) is
  'Service-role-only credential verifier input for the Next.js server. Never callable by browser roles.';
comment on function public.antilia_auth_begin_login_attempt(public.admin_role, bytea) is
  'Persistent per-role/IP-fingerprint throttling: five evaluated attempts per 15-minute window, followed by a 15-minute lockout.';
comment on function public.antilia_auth_create_session(public.admin_role, bytea, bytea, timestamptz, bytea) is
  'Creates an eight-hour-or-shorter session from SHA-256 token and minimized request fingerprints. Raw bearer tokens are never stored.';
comment on function public.antilia_auth_change_passcode(bytea, public.admin_role, text, text) is
  'Requires a live SYSTEM session in PostgreSQL. HR changes revoke all HR sessions; SYSTEM changes retain only the calling SYSTEM session.';
