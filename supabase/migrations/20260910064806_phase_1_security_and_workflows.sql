-- Antilia Voting Portal - Phase 1 integrity, workflow, RLS, and privileges.

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create or replace function private.assert_admin(
  p_admin_id uuid,
  p_allowed_roles public.admin_role[]
)
returns public.admin_role
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.admin_role;
begin
  select ap.role into v_role
  from private.admin_principals ap
  where ap.id = p_admin_id and ap.is_active;

  if v_role is null or not (v_role = any(p_allowed_roles)) then
    raise exception using errcode = '42501', message = 'Active administrator with the required role not found';
  end if;
  return v_role;
end;
$$;

create or replace function private.current_admin_has_role(p_allowed_roles public.admin_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.admin_principals ap
    where ap.auth_user_id = (select auth.uid())
      and ap.is_active
      and ap.role = any(p_allowed_roles)
  );
$$;

create or replace function private.current_audit_actor(
  out actor_admin_id uuid,
  out actor_type public.actor_type
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_configured_id text;
  v_role public.admin_role;
begin
  v_configured_id := nullif(current_setting('app.actor_admin_id', true), '');
  if v_configured_id is not null then
    actor_admin_id := v_configured_id::uuid;
    select ap.role into v_role
    from private.admin_principals ap
    where ap.id = actor_admin_id and ap.is_active;
  else
    select ap.id, ap.role into actor_admin_id, v_role
    from private.admin_principals ap
    where ap.auth_user_id = (select auth.uid()) and ap.is_active;
  end if;

  actor_type := case v_role
    when 'HR' then 'HR'::public.actor_type
    when 'SYSTEM' then 'SYSTEM'::public.actor_type
    else 'DATABASE'::public.actor_type
  end;
end;
$$;

create or replace function private.protect_hod_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    -- Serialize this change with election opening. Without the row lock, an
    -- opener could count the old HOD state while a concurrent deactivation commits.
    perform 1
    from public.election_hods eh
    join public.elections e on e.id = eh.election_id
    where eh.hod_id = old.id and e.deleted_at is null
    for share of e;
    if exists (
      select 1
      from public.election_hods eh
      join public.elections e on e.id = eh.election_id
      where eh.hod_id = old.id and e.status = 'OPEN' and e.deleted_at is null
    ) then
      raise exception using errcode = '55000', message = 'HOD configuration is locked while a linked election is OPEN';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.protect_candidate_configuration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_election_id uuid := case when tg_op = 'DELETE' then old.election_id else new.election_id end;
  v_status public.election_status;
begin
  select e.status into v_status
  from public.elections e
  where e.id = v_election_id and e.deleted_at is null
  for share;

  if v_status is null then
    raise exception using errcode = '23503', message = 'Active election not found';
  end if;
  if v_status <> 'DRAFT' then
    raise exception using errcode = '55000', message = 'Candidate configuration is locked after an election opens';
  end if;
  if tg_op = 'UPDATE' and new.election_id <> old.election_id then
    raise exception using errcode = '55000', message = 'A candidate cannot be moved to another election';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.protect_election_hod_configuration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_election_id uuid := case when tg_op = 'DELETE' then old.election_id else new.election_id end;
  v_status public.election_status;
  v_hod public.hods%rowtype;
begin
  select e.status into v_status
  from public.elections e
  where e.id = v_election_id and e.deleted_at is null
  for share;

  if v_status is null then
    raise exception using errcode = '23503', message = 'Active election not found';
  end if;
  if v_status <> 'DRAFT' then
    raise exception using errcode = '55000', message = 'Election HOD configuration is locked after an election opens';
  end if;
  if tg_op = 'UPDATE' and (new.election_id, new.hod_id) is distinct from (old.election_id, old.hod_id) then
    raise exception using errcode = '55000', message = 'Election/HOD identity cannot be changed';
  end if;

  if tg_op = 'INSERT' then
    select h.* into v_hod from public.hods h where h.id = new.hod_id;
    if not found then
      raise exception using errcode = '23503', message = 'HOD not found';
    end if;
    new.hod_name_snapshot := v_hod.name;
    new.department_snapshot := v_hod.department;
    new.mobile_normalized_snapshot := v_hod.mobile_normalized;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.validate_election_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_eligible_hods integer;
  v_foh_candidates integer;
  v_boh_candidates integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' or new.opened_at is not null or new.closed_at is not null then
      raise exception using errcode = '23514', message = 'New elections must start in DRAFT';
    end if;
    return new;
  end if;

  if old.status <> 'DRAFT' and (
    new.name is distinct from old.name
    or new.election_month is distinct from old.election_month
    or new.election_year is distinct from old.election_year
  ) then
    raise exception using errcode = '55000', message = 'Core election configuration is locked after opening';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'DRAFT' and new.status = 'OPEN')
      or (old.status = 'OPEN' and new.status = 'CLOSED')
      or (old.status = 'CLOSED' and new.status = 'OPEN')
    ) then
      raise exception using errcode = '23514', message = 'Invalid election status transition';
    end if;

    if new.status = 'OPEN' then
      select count(*) into v_eligible_hods
      from public.election_hods eh
      join public.hods h on h.id = eh.hod_id
      where eh.election_id = old.id and eh.is_approved and eh.is_active and h.is_active;
      select count(*) filter (where c.category = 'FOH'),
             count(*) filter (where c.category = 'BOH')
        into v_foh_candidates, v_boh_candidates
      from public.candidates c
      where c.election_id = old.id and c.is_active;

      if v_eligible_hods = 0 or v_foh_candidates = 0 or v_boh_candidates = 0 then
        raise exception using errcode = '23514',
          message = 'An election requires an eligible HOD and active FOH and BOH candidates before opening';
      end if;
      new.opened_at := coalesce(old.opened_at, clock_timestamp());
      new.closed_at := null;
    elsif new.status = 'CLOSED' then
      new.closed_at := clock_timestamp();
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.validate_vote()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.election_status;
begin
  select e.status into v_status
  from public.elections e
  where e.id = new.election_id and e.deleted_at is null
  for share;
  if v_status <> 'OPEN' or v_status is null then
    raise exception using errcode = '55000', message = 'Votes are accepted only for an OPEN election';
  end if;
  if not exists (
    select 1 from public.election_hods eh
    join public.hods h on h.id = eh.hod_id
    where eh.election_id = new.election_id and eh.hod_id = new.hod_id
      and eh.is_approved and eh.is_active and h.is_active
  ) then
    raise exception using errcode = '42501', message = 'HOD is not active and approved for this election';
  end if;
  if not exists (
    select 1 from public.candidates c
    where c.id = new.candidate_id and c.election_id = new.election_id
      and c.category = new.category and c.is_active
  ) then
    raise exception using errcode = '23514', message = 'Candidate is inactive or does not match the election/category';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_complete_ballot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows integer;
  v_elections integer;
  v_hods integer;
  v_categories integer;
begin
  select count(*), count(distinct v.election_id), count(distinct v.hod_id), count(distinct v.category)
    into v_rows, v_elections, v_hods, v_categories
  from public.votes v where v.ballot_id = new.ballot_id;
  if v_rows <> 2 or v_elections <> 1 or v_hods <> 1 or v_categories <> 2 then
    raise exception using errcode = '23514', message = 'A ballot must contain exactly one FOH and one BOH vote for one HOD/election';
  end if;
  return null;
end;
$$;

create or replace function private.prevent_vote_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Vote history is immutable';
end;
$$;

create or replace function private.validate_tie_break_candidate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tie_break_id uuid := case when tg_op = 'DELETE' then old.tie_break_id else new.tie_break_id end;
  v_candidate_id uuid := case when tg_op = 'DELETE' then old.candidate_id else new.candidate_id end;
  v_status public.election_status;
begin
  select tb.status into v_status
  from public.tie_breaks tb where tb.id = v_tie_break_id for share;
  if v_status <> 'DRAFT' or v_status is null then
    raise exception using errcode = '55000', message = 'Tie-break candidates are locked after opening';
  end if;
  if not exists (
    select 1 from public.tie_breaks tb
    join public.candidates c on c.id = new.candidate_id
    where tb.id = v_tie_break_id
      and c.id = v_candidate_id and c.election_id = tb.original_election_id
      and c.category = tb.category
  ) then
    raise exception using errcode = '23514', message = 'Tie-break candidate must match the original election and category';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.validate_tie_break_vote()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.tie_breaks tb
    join public.tie_break_candidates tbc on tbc.tie_break_id = tb.id and tbc.candidate_id = new.candidate_id
    join public.election_hods eh on eh.election_id = tb.original_election_id and eh.hod_id = new.hod_id
    join public.hods h on h.id = eh.hod_id
    where tb.id = new.tie_break_id and tb.status = 'OPEN'
      and eh.is_approved and eh.is_active and h.is_active
  ) then
    raise exception using errcode = '42501', message = 'Invalid tie-break, candidate, or HOD eligibility';
  end if;
  return new;
end;
$$;

create or replace function private.audit_entity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_admin_id uuid;
  v_actor_type public.actor_type;
  v_action public.audit_action;
  v_election_id uuid;
  v_hod_id uuid;
  v_candidate_id uuid;
  v_tie_break_id uuid;
begin
  select a.actor_admin_id, a.actor_type into v_actor_admin_id, v_actor_type
  from private.current_audit_actor() a;

  if tg_table_name = 'hods' then
    v_hod_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_action := case
      when tg_op = 'INSERT' then 'HOD_CREATED'
      when old.is_active and not new.is_active then 'HOD_DEACTIVATED'
      else 'HOD_UPDATED' end;
  elsif tg_table_name = 'candidates' then
    v_candidate_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_election_id := case when tg_op = 'DELETE' then old.election_id else new.election_id end;
    v_action := case
      when tg_op = 'INSERT' then 'CANDIDATE_CREATED'
      when old.is_active and not new.is_active then 'CANDIDATE_DEACTIVATED'
      else 'CANDIDATE_UPDATED' end;
  elsif tg_table_name = 'elections' then
    v_election_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_action := case
      when tg_op = 'INSERT' then 'ELECTION_CREATED'
      when new.deleted_at is not null and old.deleted_at is null then 'ELECTION_DELETED'
      when old.status = 'DRAFT' and new.status = 'OPEN' then 'ELECTION_OPENED'
      when old.status = 'OPEN' and new.status = 'CLOSED' then 'ELECTION_CLOSED'
      when old.status = 'CLOSED' and new.status = 'OPEN' then 'ELECTION_REOPENED'
      else null end;
  elsif tg_table_name = 'tie_breaks' and tg_op = 'INSERT' then
    v_tie_break_id := new.id;
    v_election_id := new.original_election_id;
    v_action := 'TIE_BREAK_CREATED';
  elsif tg_table_name = 'admin_credentials' and tg_op in ('INSERT', 'UPDATE') then
    v_action := case new.role when 'HR' then 'HR_PASSCODE_CHANGED' else 'SYSTEM_PASSCODE_CHANGED' end;
  end if;

  if v_action is not null then
    insert into private.audit_logs (
      action, actor_type, actor_admin_id, election_id, hod_id, candidate_id, tie_break_id,
      metadata
    ) values (
      v_action, v_actor_type, v_actor_admin_id, v_election_id, v_hod_id, v_candidate_id, v_tie_break_id,
      jsonb_build_object('operation', tg_op)
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger hods_10_protect before update or delete on public.hods
for each row execute function private.protect_hod_changes();
create trigger hods_90_updated_at before update on public.hods
for each row execute function private.set_updated_at();
create trigger hods_99_audit after insert or update or delete on public.hods
for each row execute function private.audit_entity_change();

create trigger elections_10_validate before insert or update on public.elections
for each row execute function private.validate_election_change();
create trigger elections_90_updated_at before update on public.elections
for each row execute function private.set_updated_at();
create trigger elections_99_audit after insert or update or delete on public.elections
for each row execute function private.audit_entity_change();

create trigger election_hods_10_protect before insert or update or delete on public.election_hods
for each row execute function private.protect_election_hod_configuration();
create trigger election_hods_90_updated_at before update on public.election_hods
for each row execute function private.set_updated_at();

create trigger candidates_10_protect before insert or update or delete on public.candidates
for each row execute function private.protect_candidate_configuration();
create trigger candidates_90_updated_at before update on public.candidates
for each row execute function private.set_updated_at();
create trigger candidates_99_audit after insert or update or delete on public.candidates
for each row execute function private.audit_entity_change();

create trigger votes_10_validate before insert on public.votes
for each row execute function private.validate_vote();
create trigger votes_10_immutable before update or delete on public.votes
for each row execute function private.prevent_vote_mutation();
create constraint trigger votes_99_complete_ballot
after insert on public.votes deferrable initially deferred
for each row execute function private.enforce_complete_ballot();

create trigger tie_breaks_90_updated_at before update on public.tie_breaks
for each row execute function private.set_updated_at();
create trigger tie_breaks_99_audit after insert on public.tie_breaks
for each row execute function private.audit_entity_change();
create trigger tie_break_candidates_10_validate before insert or update or delete on public.tie_break_candidates
for each row execute function private.validate_tie_break_candidate();
create trigger tie_break_votes_10_validate before insert on public.tie_break_votes
for each row execute function private.validate_tie_break_vote();
create trigger tie_break_votes_10_immutable before update or delete on public.tie_break_votes
for each row execute function private.prevent_vote_mutation();
create trigger admin_credentials_90_updated_at before update on private.admin_credentials
for each row execute function private.set_updated_at();
create trigger admin_credentials_99_audit after insert or update on private.admin_credentials
for each row execute function private.audit_entity_change();
create trigger admin_principals_90_updated_at before update on private.admin_principals
for each row execute function private.set_updated_at();

create or replace function private.submit_ballot(
  p_election_id uuid,
  p_mobile_number text,
  p_foh_candidate_id uuid,
  p_boh_candidate_id uuid,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns table (ballot_id uuid, foh_vote_id uuid, boh_vote_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hod_id uuid;
  v_ballot_id uuid := gen_random_uuid();
  v_foh_vote_id uuid := gen_random_uuid();
  v_boh_vote_id uuid := gen_random_uuid();
  v_status public.election_status;
begin
  select e.status into v_status
  from public.elections e
  where e.id = p_election_id and e.deleted_at is null
  for update;
  if v_status <> 'OPEN' or v_status is null then
    raise exception using errcode = '55000', message = 'Election is not OPEN';
  end if;

  select h.id into v_hod_id
  from public.hods h
  join public.election_hods eh on eh.hod_id = h.id and eh.election_id = p_election_id
  where h.mobile_normalized = private.normalize_mobile(p_mobile_number)
    and h.is_active and eh.is_active and eh.is_approved
  for update of h, eh;
  if v_hod_id is null then
    raise exception using errcode = '42501', message = 'HOD is unknown, inactive, or not approved for this election';
  end if;

  if p_foh_candidate_id = p_boh_candidate_id then
    raise exception using errcode = '23514', message = 'FOH and BOH selections must be different category candidates';
  end if;
  if not exists (
    select 1 from public.candidates c
    where c.id = p_foh_candidate_id and c.election_id = p_election_id
      and c.category = 'FOH' and c.is_active
  ) then
    raise exception using errcode = '23514', message = 'Invalid FOH candidate';
  end if;
  if not exists (
    select 1 from public.candidates c
    where c.id = p_boh_candidate_id and c.election_id = p_election_id
      and c.category = 'BOH' and c.is_active
  ) then
    raise exception using errcode = '23514', message = 'Invalid BOH candidate';
  end if;
  if exists (
    select 1 from public.votes v
    where v.election_id = p_election_id and v.hod_id = v_hod_id
  ) then
    raise exception using errcode = '23505', message = 'HOD has already submitted a ballot for this election';
  end if;

  insert into public.votes (
    id, election_id, hod_id, candidate_id, category, ballot_id,
    request_id, ip_address, user_agent
  ) values
    (v_foh_vote_id, p_election_id, v_hod_id, p_foh_candidate_id, 'FOH', v_ballot_id,
      p_request_id, p_ip_address, left(p_user_agent, 1000)),
    (v_boh_vote_id, p_election_id, v_hod_id, p_boh_candidate_id, 'BOH', v_ballot_id,
      p_request_id, p_ip_address, left(p_user_agent, 1000));

  insert into private.audit_logs (
    action, actor_type, actor_hod_id, election_id, hod_id, metadata
  ) values (
    'VOTE_SUBMITTED', 'HOD', v_hod_id, p_election_id, v_hod_id,
    jsonb_build_object('ballot_id', v_ballot_id, 'request_id', p_request_id)
  );

  return query select v_ballot_id, v_foh_vote_id, v_boh_vote_id;
end;
$$;

create or replace function private.set_election_status(
  p_election_id uuid,
  p_status public.election_status,
  p_actor_admin_id uuid
)
returns public.elections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.elections;
begin
  perform private.assert_admin(p_actor_admin_id, array['SYSTEM']::public.admin_role[]);
  perform set_config('app.actor_admin_id', p_actor_admin_id::text, true);
  if p_status = 'DRAFT' then
    raise exception using errcode = '23514', message = 'Elections cannot transition back to DRAFT';
  end if;
  update public.elections e set status = p_status
  where e.id = p_election_id and e.deleted_at is null
  returning e.* into v_result;
  if not found then
    raise exception using errcode = 'P0002', message = 'Election not found';
  end if;
  return v_result;
end;
$$;

create or replace function private.create_election(
  p_name text,
  p_month smallint,
  p_year smallint,
  p_actor_admin_id uuid
)
returns public.elections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.elections;
begin
  perform private.assert_admin(p_actor_admin_id, array['SYSTEM']::public.admin_role[]);
  perform set_config('app.actor_admin_id', p_actor_admin_id::text, true);
  insert into public.elections (name, election_month, election_year, created_by)
  values (p_name, p_month, p_year, p_actor_admin_id)
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function private.soft_delete_election(
  p_election_id uuid,
  p_actor_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_actor_admin_id, array['SYSTEM']::public.admin_role[]);
  perform set_config('app.actor_admin_id', p_actor_admin_id::text, true);
  update public.elections e
  set deleted_at = clock_timestamp(), deleted_by = p_actor_admin_id,
      status = case when e.status = 'OPEN' then 'CLOSED' else e.status end,
      closed_at = case when e.status = 'OPEN' then clock_timestamp() else e.closed_at end
  where e.id = p_election_id and e.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Election not found';
  end if;
end;
$$;

create or replace function private.reset_election(
  p_election_id uuid,
  p_actor_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.elections;
  v_new_id uuid := gen_random_uuid();
begin
  perform private.assert_admin(p_actor_admin_id, array['SYSTEM']::public.admin_role[]);
  perform set_config('app.actor_admin_id', p_actor_admin_id::text, true);
  select e.* into v_old from public.elections e
  where e.id = p_election_id and e.deleted_at is null for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Election not found';
  end if;

  update public.elections e
  set deleted_at = clock_timestamp(), deleted_by = p_actor_admin_id,
      status = case when e.status = 'OPEN' then 'CLOSED' else e.status end,
      closed_at = case when e.status = 'OPEN' then clock_timestamp() else e.closed_at end
  where e.id = p_election_id;

  insert into public.elections (
    id, name, election_month, election_year, created_by, supersedes_election_id
  ) values (
    v_new_id, v_old.name, v_old.election_month, v_old.election_year,
    p_actor_admin_id, v_old.id
  );
  insert into public.election_hods (
    election_id, hod_id, is_approved, is_active,
    hod_name_snapshot, department_snapshot, mobile_normalized_snapshot
  )
  select v_new_id, eh.hod_id, eh.is_approved, eh.is_active,
         eh.hod_name_snapshot, eh.department_snapshot, eh.mobile_normalized_snapshot
  from public.election_hods eh where eh.election_id = v_old.id;
  insert into public.candidates (election_id, name, department, category, is_active)
  select v_new_id, c.name, c.department, c.category, c.is_active
  from public.candidates c where c.election_id = v_old.id;

  insert into private.audit_logs (
    action, actor_type, actor_admin_id, election_id, metadata
  ) values (
    'ELECTION_RESET', 'SYSTEM', p_actor_admin_id, v_old.id,
    jsonb_build_object('replacement_election_id', v_new_id)
  );
  return v_new_id;
end;
$$;

create or replace function private.initiate_tie_break(
  p_election_id uuid,
  p_category public.employee_category,
  p_actor_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tie_break_id uuid := gen_random_uuid();
  v_round smallint;
  v_tied_count integer;
begin
  perform private.assert_admin(p_actor_admin_id, array['SYSTEM']::public.admin_role[]);
  perform set_config('app.actor_admin_id', p_actor_admin_id::text, true);
  perform 1 from public.elections e
  where e.id = p_election_id and e.status = 'CLOSED' and e.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'Original election must be CLOSED';
  end if;
  if exists (
    select 1 from public.tie_breaks tb
    where tb.original_election_id = p_election_id and tb.category = p_category
      and tb.status in ('DRAFT', 'OPEN')
  ) then
    raise exception using errcode = '23505', message = 'An active tie-break already exists';
  end if;

  with totals as (
    select c.id, count(v.id)::bigint as vote_count
    from public.candidates c
    left join public.votes v on v.candidate_id = c.id and v.election_id = c.election_id
    where c.election_id = p_election_id and c.category = p_category and c.is_active
    group by c.id
  ), leaders as (
    select t.id from totals t where t.vote_count = (select max(t2.vote_count) from totals t2)
  ) select count(*) into v_tied_count from leaders;
  if v_tied_count < 2 then
    raise exception using errcode = '23514', message = 'No first-place tie exists for this category';
  end if;

  select (coalesce(max(tb.round_number), 0) + 1)::smallint into v_round
  from public.tie_breaks tb
  where tb.original_election_id = p_election_id and tb.category = p_category;
  insert into public.tie_breaks (
    id, original_election_id, category, round_number, created_by
  ) values (v_tie_break_id, p_election_id, p_category, v_round, p_actor_admin_id);

  with totals as (
    select c.id, count(v.id)::bigint as vote_count
    from public.candidates c
    left join public.votes v on v.candidate_id = c.id and v.election_id = c.election_id
    where c.election_id = p_election_id and c.category = p_category and c.is_active
    group by c.id
  )
  insert into public.tie_break_candidates (tie_break_id, candidate_id)
  select v_tie_break_id, t.id from totals t
  where t.vote_count = (select max(t2.vote_count) from totals t2);
  return v_tie_break_id;
end;
$$;

create or replace function private.set_tie_break_status(
  p_tie_break_id uuid,
  p_status public.election_status,
  p_actor_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_status public.election_status;
begin
  perform private.assert_admin(p_actor_admin_id, array['SYSTEM']::public.admin_role[]);
  select tb.status into v_old_status from public.tie_breaks tb
  where tb.id = p_tie_break_id for update;
  if v_old_status is null then raise exception using errcode = 'P0002', message = 'Tie-break not found'; end if;
  if not ((v_old_status = 'DRAFT' and p_status = 'OPEN')
      or (v_old_status = 'OPEN' and p_status = 'CLOSED')
      or (v_old_status = 'CLOSED' and p_status = 'OPEN')) then
    raise exception using errcode = '23514', message = 'Invalid tie-break status transition';
  end if;
  if p_status = 'OPEN' and (select count(*) from public.tie_break_candidates tbc where tbc.tie_break_id = p_tie_break_id) < 2 then
    raise exception using errcode = '23514', message = 'Tie-break requires at least two candidates';
  end if;
  update public.tie_breaks tb set status = p_status,
    opened_at = case when p_status = 'OPEN' then coalesce(tb.opened_at, clock_timestamp()) else tb.opened_at end,
    closed_at = case when p_status = 'CLOSED' then clock_timestamp() when p_status = 'OPEN' then null else tb.closed_at end
  where tb.id = p_tie_break_id;
end;
$$;

create or replace function private.submit_tie_break_vote(
  p_tie_break_id uuid,
  p_mobile_number text,
  p_candidate_id uuid,
  p_request_id uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hod_id uuid;
  v_vote_id uuid := gen_random_uuid();
  v_original_election_id uuid;
begin
  select tb.original_election_id into v_original_election_id
  from public.tie_breaks tb where tb.id = p_tie_break_id and tb.status = 'OPEN' for update;
  if not found then raise exception using errcode = '55000', message = 'Tie-break is not OPEN'; end if;
  select h.id into v_hod_id
  from public.hods h
  join public.election_hods eh on eh.hod_id = h.id and eh.election_id = v_original_election_id
  where h.mobile_normalized = private.normalize_mobile(p_mobile_number)
    and h.is_active and eh.is_active and eh.is_approved
  for update of h, eh;
  if not found then raise exception using errcode = '42501', message = 'HOD is not eligible'; end if;
  insert into public.tie_break_votes (
    id, tie_break_id, hod_id, candidate_id, request_id, ip_address, user_agent
  ) values (
    v_vote_id, p_tie_break_id, v_hod_id, p_candidate_id,
    p_request_id, p_ip_address, left(p_user_agent, 1000)
  );
  return v_vote_id;
end;
$$;

create or replace function private.record_admin_login(
  p_admin_id uuid,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.admin_role;
begin
  v_role := private.assert_admin(p_admin_id, array['HR', 'SYSTEM']::public.admin_role[]);
  insert into private.audit_logs (action, actor_type, actor_admin_id, metadata)
  values (
    case v_role when 'HR' then 'HR_LOGIN' else 'SYSTEM_LOGIN' end,
    v_role::text::public.actor_type,
    p_admin_id,
    jsonb_build_object('ip_address', p_ip_address, 'user_agent', left(p_user_agent, 1000))
  );
end;
$$;

create or replace function private.set_admin_credential_hash(
  p_role public.admin_role,
  p_password_hash text,
  p_hash_algorithm text,
  p_actor_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_actor_admin_id, array['SYSTEM']::public.admin_role[]);
  perform set_config('app.actor_admin_id', p_actor_admin_id::text, true);
  insert into private.admin_credentials (
    role, password_hash, hash_algorithm, password_changed_at, password_changed_by
  ) values (
    p_role, p_password_hash, p_hash_algorithm, clock_timestamp(), p_actor_admin_id
  )
  on conflict (role) do update
  set password_hash = excluded.password_hash,
      hash_algorithm = excluded.hash_algorithm,
      password_changed_at = excluded.password_changed_at,
      password_changed_by = excluded.password_changed_by;
end;
$$;

create or replace function private.get_audit_logs(
  p_actor_admin_id uuid,
  p_election_id uuid default null,
  p_limit integer default 200
)
returns setof private.audit_logs
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_actor_admin_id, array['SYSTEM']::public.admin_role[]);
  if p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'Audit limit must be between 1 and 1000';
  end if;
  return query
  select al.* from private.audit_logs al
  where p_election_id is null or al.election_id = p_election_id
  order by al.occurred_at desc, al.id desc
  limit p_limit;
end;
$$;

-- RLS is enabled on every exposed table and on private tables as defense in depth.
alter table public.hods enable row level security;
alter table public.elections enable row level security;
alter table public.election_hods enable row level security;
alter table public.candidates enable row level security;
alter table public.votes enable row level security;
alter table public.tie_breaks enable row level security;
alter table public.tie_break_candidates enable row level security;
alter table public.tie_break_votes enable row level security;
alter table public.election_winners enable row level security;
alter table private.admin_principals enable row level security;
alter table private.admin_credentials enable row level security;
alter table private.admin_sessions enable row level security;
alter table private.audit_logs enable row level security;

create policy hods_admin_select on public.hods for select to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy hods_admin_insert on public.hods for insert to authenticated
with check ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy hods_admin_update on public.hods for update to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])))
with check ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy hods_admin_delete on public.hods for delete to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));

create policy elections_admin_select on public.elections for select to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy election_hods_admin_select on public.election_hods for select to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy election_hods_admin_insert on public.election_hods for insert to authenticated
with check ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy election_hods_admin_update on public.election_hods for update to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])))
with check ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy election_hods_admin_delete on public.election_hods for delete to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));

create policy candidates_admin_select on public.candidates for select to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy candidates_admin_insert on public.candidates for insert to authenticated
with check ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy candidates_admin_update on public.candidates for update to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])))
with check ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy candidates_admin_delete on public.candidates for delete to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));

create policy votes_admin_select on public.votes for select to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy tie_breaks_admin_select on public.tie_breaks for select to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy tie_break_candidates_admin_select on public.tie_break_candidates for select to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy tie_break_votes_admin_select on public.tie_break_votes for select to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));
create policy election_winners_admin_select on public.election_winners for select to authenticated
using ((select private.current_admin_has_role(array['HR', 'SYSTEM']::public.admin_role[])));

-- Remove implicit Data API privileges, then grant only the admin operations that
-- have matching RLS policies. anon receives no table or function privileges.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant usage on schema public to authenticated;
grant usage on schema private to authenticated, service_role;
grant select, insert, update, delete on public.hods to authenticated;
grant select on public.elections to authenticated;
grant select, insert, update, delete on public.election_hods to authenticated;
grant select, insert, update, delete on public.candidates to authenticated;
grant select on public.votes, public.tie_breaks, public.tie_break_candidates,
  public.tie_break_votes, public.election_winners to authenticated;
grant select on public.hods, public.elections, public.election_hods, public.candidates,
  public.votes, public.tie_breaks, public.tie_break_candidates,
  public.tie_break_votes, public.election_winners to service_role;

grant execute on function private.current_admin_has_role(public.admin_role[]) to authenticated;
grant execute on function private.normalize_mobile(text) to authenticated, service_role;
grant execute on function private.submit_ballot(uuid, text, uuid, uuid, uuid, inet, text) to service_role;
grant execute on function private.submit_tie_break_vote(uuid, text, uuid, uuid, inet, text) to service_role;
grant execute on function private.create_election(text, smallint, smallint, uuid) to service_role;
grant execute on function private.set_election_status(uuid, public.election_status, uuid) to service_role;
grant execute on function private.soft_delete_election(uuid, uuid) to service_role;
grant execute on function private.reset_election(uuid, uuid) to service_role;
grant execute on function private.initiate_tie_break(uuid, public.employee_category, uuid) to service_role;
grant execute on function private.set_tie_break_status(uuid, public.election_status, uuid) to service_role;
grant execute on function private.record_admin_login(uuid, inet, text) to service_role;
grant execute on function private.set_admin_credential_hash(public.admin_role, text, text, uuid) to service_role;
grant execute on function private.get_audit_logs(uuid, uuid, integer) to service_role;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;

comment on function private.submit_ballot(uuid, text, uuid, uuid, uuid, inet, text) is
  'SECURITY DEFINER is required to insert into RLS-protected votes without granting browser roles table writes. It is in a non-exposed schema, has an empty search_path, is executable only by service_role, locks election/HOD rows, and inserts both categories atomically.';
comment on function private.current_admin_has_role(public.admin_role[]) is
  'Small SECURITY DEFINER authorization helper required by RLS to read the private admin allow-list. It exposes only a boolean for auth.uid(), uses an empty search_path, and is granted only to authenticated.';
comment on function private.reset_election(uuid, uuid) is
  'Preserving reset: soft-deletes the prior election and creates a replacement DRAFT with copied configuration. Original votes and results remain immutable and queryable.';
