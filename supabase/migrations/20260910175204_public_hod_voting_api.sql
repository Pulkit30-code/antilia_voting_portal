-- Public voting API support. Browser callers never receive database access;
-- Next.js uses these narrow service-role-only gateways. The existing
-- private.submit_ballot function remains the single atomic ballot authority.

create table private.hod_voter_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  election_id uuid not null,
  hod_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint hod_voter_sessions_election_hod_fkey
    foreign key (election_id, hod_id)
    references public.election_hods(election_id, hod_id) on delete restrict,
  constraint hod_voter_sessions_token_hash_length
    check (octet_length(token_hash) = 32),
  constraint hod_voter_sessions_expiry_check
    check (expires_at > created_at),
  constraint hod_voter_sessions_used_check
    check (used_at is null or used_at >= created_at)
);

create index hod_voter_sessions_active_idx
  on private.hod_voter_sessions (expires_at)
  where used_at is null;

create table private.public_voting_rate_limits (
  scope text not null check (scope in ('VERIFY', 'SUBMIT')),
  ip_hash bytea not null,
  request_count smallint not null default 0
    check (request_count between 0 and 1000),
  window_started_at timestamptz not null default clock_timestamp(),
  blocked_until timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (scope, ip_hash),
  constraint public_voting_rate_limits_ip_hash_length
    check (octet_length(ip_hash) = 32),
  constraint public_voting_rate_limits_block_check
    check (blocked_until is null or blocked_until >= window_started_at)
);

create index public_voting_rate_limits_blocked_idx
  on private.public_voting_rate_limits (blocked_until)
  where blocked_until is not null;

alter table private.hod_voter_sessions enable row level security;
alter table private.public_voting_rate_limits enable row level security;

revoke all on private.hod_voter_sessions from public, anon, authenticated;
revoke all on private.public_voting_rate_limits from public, anon, authenticated;

-- SECURITY INVOKER is intentional. Only service_role receives EXECUTE and the
-- minimum private-table grants needed by these gateways.
create or replace function public.antilia_voting_consume_rate_limit(
  p_scope text,
  p_ip_hash bytea
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row private.public_voting_rate_limits%rowtype;
  v_limit smallint;
  v_next_count smallint;
begin
  if p_scope not in ('VERIFY', 'SUBMIT') then
    raise exception using errcode = '22023', message = 'Invalid rate-limit scope';
  end if;
  if octet_length(p_ip_hash) <> 32 then
    raise exception using errcode = '22023', message = 'Invalid IP fingerprint';
  end if;

  v_limit := case p_scope when 'VERIFY' then 10 else 10 end;

  loop
    select rl.* into v_row
    from private.public_voting_rate_limits rl
    where rl.scope = p_scope and rl.ip_hash = p_ip_hash
    for update;

    if not found then
      begin
        insert into private.public_voting_rate_limits (
          scope, ip_hash, request_count, window_started_at
        ) values (p_scope, p_ip_hash, 1, v_now);
        return query select true, 0;
        return;
      exception when unique_violation then
        -- A concurrent request inserted first; retry and lock its row.
      end;
    else
      if v_row.blocked_until is not null and v_row.blocked_until > v_now then
        return query select false,
          greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
        return;
      end if;

      if v_row.window_started_at <= v_now - interval '15 minutes' then
        update private.public_voting_rate_limits rl
        set request_count = 1,
            window_started_at = v_now,
            blocked_until = null,
            updated_at = statement_timestamp()
        where rl.scope = p_scope and rl.ip_hash = p_ip_hash;
        return query select true, 0;
        return;
      end if;

      v_next_count := v_row.request_count + 1;
      update private.public_voting_rate_limits rl
      set request_count = v_next_count,
          blocked_until = case
            when v_next_count > v_limit then v_now + interval '15 minutes'
            else null
          end,
          updated_at = statement_timestamp()
      where rl.scope = p_scope and rl.ip_hash = p_ip_hash;

      if v_next_count > v_limit then
        return query select false, 900;
      else
        return query select true, 0;
      end if;
      return;
    end if;
  end loop;
end;
$$;

create or replace function public.antilia_voting_verify_hod(
  p_name text,
  p_mobile_number text,
  p_department text,
  p_token_hash bytea
)
returns table (
  verification_status text,
  election_id uuid,
  election_name text,
  election_month smallint,
  election_year smallint,
  opened_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_election public.elections;
  v_hod_id uuid;
  v_expires_at timestamptz := clock_timestamp() + interval '10 minutes';
begin
  if octet_length(p_token_hash) <> 32 then
    raise exception using errcode = '22023', message = 'Invalid verification token';
  end if;

  select e.* into v_election
  from public.elections e
  where e.status = 'OPEN' and e.deleted_at is null
  order by e.opened_at desc, e.created_at desc
  limit 1;

  if not found then
    return query select 'ELECTION_NOT_OPEN'::text, null::uuid, null::text,
      null::smallint, null::smallint, null::timestamptz, null::timestamptz;
    return;
  end if;

  select h.id into v_hod_id
  from public.hods h
  join public.election_hods eh
    on eh.hod_id = h.id and eh.election_id = v_election.id
  where h.is_active
    and eh.is_active
    and eh.is_approved
    and eh.mobile_normalized_snapshot = private.normalize_mobile(p_mobile_number)
    and lower(btrim(eh.hod_name_snapshot)) = lower(btrim(p_name))
    and lower(btrim(eh.department_snapshot)) = lower(btrim(p_department))
  limit 1;

  if v_hod_id is null then
    return query select 'HOD_NOT_VERIFIED'::text, null::uuid, null::text,
      null::smallint, null::smallint, null::timestamptz, null::timestamptz;
    return;
  end if;

  if exists (
    select 1 from public.votes v
    where v.election_id = v_election.id and v.hod_id = v_hod_id
  ) then
    return query select 'ALREADY_VOTED'::text, v_election.id, v_election.name,
      v_election.election_month, v_election.election_year,
      v_election.opened_at, null::timestamptz;
    return;
  end if;

  insert into private.hod_voter_sessions (
    token_hash, election_id, hod_id, expires_at
  ) values (
    p_token_hash, v_election.id, v_hod_id, v_expires_at
  );

  return query select 'VERIFIED'::text, v_election.id, v_election.name,
    v_election.election_month, v_election.election_year,
    v_election.opened_at, v_expires_at;
end;
$$;

create or replace function public.antilia_voting_submit_verified_ballot(
  p_token_hash bytea,
  p_foh_candidate_id uuid,
  p_boh_candidate_id uuid,
  p_request_id uuid default null,
  p_user_agent text default null
)
returns table (ballot_id uuid, foh_vote_id uuid, boh_vote_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session private.hod_voter_sessions;
  v_mobile_number text;
begin
  if octet_length(p_token_hash) <> 32 then
    raise exception using errcode = '42501', message = 'HOD not verified';
  end if;

  select s.* into v_session
  from private.hod_voter_sessions s
  where s.token_hash = p_token_hash
    and s.used_at is null
    and s.expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'HOD not verified';
  end if;

  select h.mobile_number into v_mobile_number
  from public.hods h
  where h.id = v_session.hod_id;

  return query
  select b.ballot_id, b.foh_vote_id, b.boh_vote_id
  from private.submit_ballot(
    v_session.election_id,
    v_mobile_number,
    p_foh_candidate_id,
    p_boh_candidate_id,
    p_request_id,
    null,
    p_user_agent
  ) b;

  update private.hod_voter_sessions s
  set used_at = clock_timestamp()
  where s.id = v_session.id;
end;
$$;

revoke execute on function public.antilia_voting_consume_rate_limit(text, bytea)
  from public, anon, authenticated;
revoke execute on function public.antilia_voting_verify_hod(text, text, text, bytea)
  from public, anon, authenticated;
revoke execute on function public.antilia_voting_submit_verified_ballot(bytea, uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant select, insert, update on private.hod_voter_sessions to service_role;
grant select, insert, update on private.public_voting_rate_limits to service_role;

grant execute on function public.antilia_voting_consume_rate_limit(text, bytea)
  to service_role;
grant execute on function public.antilia_voting_verify_hod(text, text, text, bytea)
  to service_role;
grant execute on function public.antilia_voting_submit_verified_ballot(bytea, uuid, uuid, uuid, text)
  to service_role;

comment on table private.hod_voter_sessions is
  'Short-lived HOD verification sessions. Only SHA-256 token hashes are stored; browser tokens remain opaque HttpOnly cookies.';
comment on table private.public_voting_rate_limits is
  'Persistent 15-minute public voting throttles keyed by HMAC-SHA-256 IP fingerprints. Raw IP addresses are not stored.';
comment on function public.antilia_voting_submit_verified_ballot(bytea, uuid, uuid, uuid, text) is
  'Service-only SECURITY INVOKER gateway. It consumes a verified HOD session and delegates both vote inserts atomically to private.submit_ballot.';
