-- Phase 1.5 forward-only correctness hardening.
-- An inactive global HOD must not be counted as active in a new election
-- eligibility snapshot, even if a caller submits is_active = true.

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
    new.is_active := new.is_active and v_hod.is_active;
    new.hod_name_snapshot := v_hod.name;
    new.department_snapshot := v_hod.department;
    new.mobile_normalized_snapshot := v_hod.mobile_normalized;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function private.protect_election_hod_configuration()
  from public, anon, authenticated;

comment on function private.protect_election_hod_configuration() is
  'Locks election eligibility after DRAFT and snapshots identity. New election eligibility cannot mark a globally inactive HOD active.';

-- A complete ballot has two vote rows. Count distinct HODs in both numerator
-- and denominator so the vote join cannot double the eligible-voter count.
create or replace view private.election_turnout
with (security_invoker = true)
as
select
  e.id as election_id,
  count(distinct eh.hod_id) filter (
    where eh.is_approved and eh.is_active
  )::bigint as eligible_hod_count,
  count(distinct v.hod_id) filter (
    where eh.is_approved and eh.is_active
  )::bigint as voted_hod_count,
  case
    when count(distinct eh.hod_id) filter (where eh.is_approved and eh.is_active) = 0 then 0::numeric
    else round(
      count(distinct v.hod_id) filter (where eh.is_approved and eh.is_active)::numeric
      * 100
      / count(distinct eh.hod_id) filter (where eh.is_approved and eh.is_active),
      2
    )
  end as turnout_percentage
from public.elections e
left join public.election_hods eh on eh.election_id = e.id
left join public.votes v on v.election_id = e.id and v.hod_id = eh.hod_id
group by e.id;

revoke all on private.election_turnout from public, anon;
grant select on private.election_turnout to authenticated, service_role;

comment on view private.election_turnout is
  'Admin-only voter turnout. Distinct HOD counts prevent a two-row FOH/BOH ballot from doubling the eligible denominator.';
