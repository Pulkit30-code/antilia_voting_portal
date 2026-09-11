-- Antilia Voting Portal - Phase 1 core relational model.
-- All browser-facing objects live in public and are protected by RLS in the
-- following migration. Credentials, audit data, and administrative reporting
-- live in the non-exposed private schema.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.employee_category as enum ('FOH', 'BOH');
create type public.election_status as enum ('DRAFT', 'OPEN', 'CLOSED');
create type public.admin_role as enum ('HR', 'SYSTEM');
create type public.actor_type as enum ('HR', 'SYSTEM', 'HOD', 'SERVICE', 'DATABASE');
create type public.winner_source as enum ('NORMAL', 'TIE_BREAK');
create type public.audit_action as enum (
  'HR_LOGIN',
  'SYSTEM_LOGIN',
  'HOD_CREATED',
  'HOD_UPDATED',
  'HOD_DEACTIVATED',
  'CANDIDATE_CREATED',
  'CANDIDATE_UPDATED',
  'CANDIDATE_DEACTIVATED',
  'ELECTION_CREATED',
  'ELECTION_OPENED',
  'ELECTION_CLOSED',
  'ELECTION_REOPENED',
  'ELECTION_RESET',
  'ELECTION_DELETED',
  'VOTE_SUBMITTED',
  'TIE_BREAK_CREATED',
  'HR_PASSCODE_CHANGED',
  'SYSTEM_PASSCODE_CHANGED'
);

create or replace function private.normalize_mobile(p_mobile text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(btrim(p_mobile), '^00', ''),
    '[^0-9]',
    '',
    'g'
  );
$$;

revoke all on function private.normalize_mobile(text) from public, anon, authenticated;

create table public.hods (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  mobile_number text not null check (length(btrim(mobile_number)) > 0),
  mobile_normalized text generated always as (private.normalize_mobile(mobile_number)) stored,
  department text not null check (length(btrim(department)) between 1 and 160),
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint hods_mobile_normalized_valid check (length(mobile_normalized) between 8 and 15),
  constraint hods_mobile_normalized_key unique (mobile_normalized)
);

create table public.elections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  election_month smallint not null check (election_month between 1 and 12),
  election_year smallint not null check (election_year between 2000 and 2200),
  status public.election_status not null default 'DRAFT',
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  created_by uuid not null,
  deleted_at timestamptz,
  deleted_by uuid,
  supersedes_election_id uuid references public.elections(id) on delete restrict,
  constraint elections_opened_timestamp_check check (status = 'DRAFT' or opened_at is not null),
  constraint elections_closed_timestamp_check check (status <> 'CLOSED' or closed_at is not null),
  constraint elections_deleted_actor_check check (deleted_at is null or deleted_by is not null)
);

-- A reset retains the prior election and creates one new current election for
-- the same month. Therefore uniqueness applies only to non-deleted elections.
create unique index elections_current_month_year_key
  on public.elections (election_year, election_month)
  where deleted_at is null;

create table private.admin_principals (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  role public.admin_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  created_by uuid references private.admin_principals(id) on delete restrict
);

alter table public.elections
  add constraint elections_created_by_fkey
  foreign key (created_by) references private.admin_principals(id) on delete restrict;
alter table public.elections
  add constraint elections_deleted_by_fkey
  foreign key (deleted_by) references private.admin_principals(id) on delete restrict;

create table private.admin_credentials (
  id uuid primary key default gen_random_uuid(),
  role public.admin_role not null unique,
  password_hash text not null,
  hash_algorithm text not null default 'argon2id',
  password_changed_at timestamptz not null default statement_timestamp(),
  password_changed_by uuid references private.admin_principals(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint admin_credentials_hash_not_plaintext check (
    length(password_hash) between 50 and 512
    and (
      (hash_algorithm = 'argon2id' and password_hash like '$argon2id$%')
      or (hash_algorithm = 'bcrypt' and password_hash ~ '^\$2[aby]\$')
    )
  )
);

create table private.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_principal_id uuid not null references private.admin_principals(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  ip_address inet,
  user_agent text,
  constraint admin_sessions_token_hash_length check (octet_length(token_hash) = 32),
  constraint admin_sessions_expiry_check check (expires_at > created_at),
  constraint admin_sessions_revocation_check check (revoked_at is null or revoked_at >= created_at)
);

create table public.election_hods (
  election_id uuid not null references public.elections(id) on delete restrict,
  hod_id uuid not null references public.hods(id) on delete restrict,
  is_approved boolean not null default true,
  is_active boolean not null default true,
  hod_name_snapshot text not null check (length(btrim(hod_name_snapshot)) between 1 and 160),
  department_snapshot text not null check (length(btrim(department_snapshot)) between 1 and 160),
  mobile_normalized_snapshot text not null check (length(mobile_normalized_snapshot) between 8 and 15),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (election_id, hod_id)
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 160),
  department text not null check (length(btrim(department)) between 1 and 160),
  category public.employee_category not null,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint candidates_election_id_id_category_key unique (election_id, id, category)
);

create unique index candidates_election_category_name_key
  on public.candidates (election_id, category, lower(btrim(name)));

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null,
  hod_id uuid not null,
  candidate_id uuid not null,
  category public.employee_category not null,
  ballot_id uuid not null,
  voted_at timestamptz not null default clock_timestamp(),
  request_id uuid,
  ip_address inet,
  user_agent text,
  constraint votes_election_hod_category_key unique (election_id, hod_id, category),
  constraint votes_election_hod_fkey foreign key (election_id, hod_id)
    references public.election_hods(election_id, hod_id) on delete restrict,
  constraint votes_candidate_match_fkey foreign key (election_id, candidate_id, category)
    references public.candidates(election_id, id, category) on delete restrict
);

create unique index votes_ballot_category_key on public.votes (ballot_id, category);

create table public.tie_breaks (
  id uuid primary key default gen_random_uuid(),
  original_election_id uuid not null references public.elections(id) on delete restrict,
  category public.employee_category not null,
  round_number smallint not null default 1 check (round_number > 0),
  status public.election_status not null default 'DRAFT',
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references private.admin_principals(id) on delete restrict,
  constraint tie_breaks_round_key unique (original_election_id, category, round_number),
  constraint tie_breaks_opened_timestamp_check check (status = 'DRAFT' or opened_at is not null),
  constraint tie_breaks_closed_timestamp_check check (status <> 'CLOSED' or closed_at is not null)
);

create unique index tie_breaks_one_active_round_key
  on public.tie_breaks (original_election_id, category)
  where status in ('DRAFT', 'OPEN');

create table public.tie_break_candidates (
  tie_break_id uuid not null references public.tie_breaks(id) on delete restrict,
  candidate_id uuid not null references public.candidates(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (tie_break_id, candidate_id)
);

create table public.tie_break_votes (
  id uuid primary key default gen_random_uuid(),
  tie_break_id uuid not null,
  hod_id uuid not null references public.hods(id) on delete restrict,
  candidate_id uuid not null,
  voted_at timestamptz not null default clock_timestamp(),
  request_id uuid,
  ip_address inet,
  user_agent text,
  constraint tie_break_votes_hod_key unique (tie_break_id, hod_id),
  constraint tie_break_votes_candidate_fkey foreign key (tie_break_id, candidate_id)
    references public.tie_break_candidates(tie_break_id, candidate_id) on delete restrict
);

create table public.election_winners (
  election_id uuid not null references public.elections(id) on delete restrict,
  category public.employee_category not null,
  candidate_id uuid not null,
  source public.winner_source not null,
  tie_break_id uuid references public.tie_breaks(id) on delete restrict,
  finalized_at timestamptz not null default statement_timestamp(),
  finalized_by uuid not null references private.admin_principals(id) on delete restrict,
  primary key (election_id, category),
  constraint election_winners_candidate_fkey foreign key (election_id, candidate_id, category)
    references public.candidates(election_id, id, category) on delete restrict,
  constraint election_winners_source_check check (
    (source = 'NORMAL' and tie_break_id is null)
    or (source = 'TIE_BREAK' and tie_break_id is not null)
  )
);

create table private.audit_logs (
  id bigint generated always as identity primary key,
  action public.audit_action not null,
  actor_type public.actor_type not null,
  actor_admin_id uuid references private.admin_principals(id) on delete set null,
  actor_hod_id uuid references public.hods(id) on delete set null,
  election_id uuid,
  hod_id uuid,
  candidate_id uuid,
  tie_break_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);

-- FK columns and common filtering/aggregation paths. Unique constraints above
-- already index month/year, mobile, ballot uniqueness, and tie-break voter keys.
create index hods_active_idx on public.hods (is_active) where is_active;
create index elections_status_idx on public.elections (status) where deleted_at is null;
create index elections_supersedes_idx on public.elections (supersedes_election_id)
  where supersedes_election_id is not null;
create index election_hods_hod_idx on public.election_hods (hod_id, election_id);
create index election_hods_turnout_eligible_idx
  on public.election_hods (election_id, hod_id) where is_approved and is_active;
create index candidates_election_category_active_idx
  on public.candidates (election_id, category, id) where is_active;
create index votes_election_candidate_category_idx
  on public.votes (election_id, candidate_id, category);
create index votes_hod_election_idx on public.votes (hod_id, election_id);
create index tie_breaks_original_idx on public.tie_breaks (original_election_id, category);
create index tie_break_candidates_candidate_idx on public.tie_break_candidates (candidate_id);
create index tie_break_votes_candidate_idx on public.tie_break_votes (tie_break_id, candidate_id);
create index tie_break_votes_hod_idx on public.tie_break_votes (hod_id, tie_break_id);
create index election_winners_candidate_idx on public.election_winners (candidate_id);
create index admin_principals_role_active_idx
  on private.admin_principals (role, is_active) where is_active;
create index admin_sessions_active_idx
  on private.admin_sessions (admin_principal_id, expires_at) where revoked_at is null;
create index audit_logs_occurred_idx on private.audit_logs (occurred_at desc);
create index audit_logs_action_idx on private.audit_logs (action, occurred_at desc);
create index audit_logs_election_idx on private.audit_logs (election_id, occurred_at desc)
  where election_id is not null;
create index audit_logs_actor_admin_idx on private.audit_logs (actor_admin_id, occurred_at desc)
  where actor_admin_id is not null;

comment on column public.hods.mobile_normalized is
  'Digits-only canonical identifier. Callers must include the country code consistently; formatting punctuation is ignored.';
comment on table public.election_hods is
  'Per-election voter allow-list and immutable historical HOD snapshot once the election opens.';
comment on table private.admin_credentials is
  'Server-only derived password hashes. Plaintext passcodes are rejected by format constraints and must never be stored.';
comment on table private.admin_sessions is
  'Server-only sessions. Only a SHA-256 (32-byte) token digest is stored; raw bearer tokens never enter the database.';
comment on table private.audit_logs is
  'Append-only security audit trail in a schema excluded from the Supabase Data API.';
