# Hosted Supabase workflow — no Docker

This is the primary development and database-verification workflow for Antilia Voting Portal. It uses an existing hosted Supabase project and Supabase CLI 2.109.1 or later. Docker, `supabase start`, local reset, and a local Supabase stack are not used.

## Security prerequisite

If a secret key has been pasted into chat, email, logs, or another uncontrolled location, delete it immediately in **Supabase Dashboard → Project Settings → API Keys** and create a replacement. Never pass a secret key to `supabase login`; CLI login uses your Supabase personal access session, not the project API key.

## Information to obtain from the Dashboard

Open the hosted project and collect:

1. **Project ref** — Dashboard URL or the project **Connect** dialog. It is the short identifier used by `supabase link`.
2. **Database password** — use/reset it from the project's database connection settings if unknown. Let `supabase link` prompt for it; do not put it in a command or shell history.
3. **Project URL** — **Connect** dialog, formatted as `https://<project-ref>.supabase.co`.
4. **Publishable key** — **Project Settings → API Keys**, beginning with `sb_publishable_`.
5. **New server secret key** — **Project Settings → API Keys**, beginning with `sb_secret_`. Create a separate key for the future server component.
6. **Transaction pooler URL** — **Connect → ORMs / Transaction pooler**. This is server-only and becomes `SUPABASE_DATABASE_URL` later.

Do not use legacy `anon`/`service_role` JWT keys for new application configuration. Supabase currently recommends publishable and secret keys. The database still maps these to the built-in `anon` and `service_role` PostgreSQL roles, so the migration grants and RLS policies remain correct.

## Safe order of operations

Run these commands from Terminal on macOS:

```bash
cd /Users/devanshkaushik/Documents/ChatGPT/antilia_voting_portal

DO_NOT_TRACK=1 supabase --version
DO_NOT_TRACK=1 supabase login
DO_NOT_TRACK=1 supabase link --project-ref <PROJECT_REF>
```

`supabase link` prompts for the database password and stores link state under ignored `supabase/.temp/`. It does not apply migrations.

### 1. Inspect before changing the hosted database

```bash
DO_NOT_TRACK=1 supabase migration list --linked
DO_NOT_TRACK=1 supabase db query --linked --file supabase/tests/hosted_preflight.sql
DO_NOT_TRACK=1 supabase db push --linked --dry-run
```

Interpret `hosted_preflight.sql` as follows:

- `CLEAN_NO_NAMED_CONFLICTS` and `0` objects: no Phase 1 relation/type/function names conflict. Confirm `migration list --linked` also shows no Phase 1 versions, then proceed.
- `REVIEW_EXISTING_OBJECTS`: stop and compare the returned objects with `migration list --linked`. If all four Phase 1/1.5 migrations are already remote, proceed to verification without pushing. Otherwise, do not reset, repair, drop, or overwrite anything until the mismatch is understood.

The dry run must list only these migrations when the project is empty:

```text
20260910064758_phase_1_voting_architecture.sql
20260910064806_phase_1_security_and_workflows.sql
20260910064807_phase_1_reporting.sql
20260910073529_phase_1_5_hod_eligibility_hardening.sql
```

### 2. Apply the migrations

This is the only database-writing CLI step:

```bash
DO_NOT_TRACK=1 supabase db push --linked
```

Do not add `--include-seed`. The fake `supabase/seed.sql` file is not part of the hosted migration push. Never run `db reset --linked`; it drops the remote schema before replaying migrations.

### 3. Verify the applied schema

```bash
DO_NOT_TRACK=1 supabase migration list --linked
DO_NOT_TRACK=1 supabase db query --linked --file supabase/tests/hosted_verification.sql
DO_NOT_TRACK=1 supabase db advisors --linked --type security --level info
DO_NOT_TRACK=1 supabase db advisors --linked --type performance --level info
```

Expected verification summary:

```text
overall_status | passed_checks | failed_checks
PASS           | 17            | 0
```

The migration list must show all four versions in both the local and remote columns. Review every advisor item; do not dismiss a security warning without understanding it.

You can alternatively paste `supabase/tests/hosted_verification.sql` into **Dashboard → SQL Editor → New query → Run**. It is read-only.

### 4. Optional staging functional test

Run only against a disposable development/staging Supabase project—not the production Antilia project:

```bash
DO_NOT_TRACK=1 supabase db query --linked --file supabase/tests/hosted_functional_test.sql
```

The script uses fake names and fixed test UUIDs inside one transaction, prints PASS rows, and ends with `ROLLBACK`. It contains no `DELETE`, `TRUNCATE`, or `DROP`. Expected: 17 PASS rows and a final `ROLLBACK` status from the SQL client.

The existing pgTAP files under `supabase/tests/database/` are retained as **OPTIONAL LOCAL TESTS / future CI tests**. They are not part of this project's primary workflow and are not required on a developer machine.

## Dashboard object checklist

After a successful push, verify these objects precisely:

1. **Database → Tables → schema `public`**: `hods`, `elections`, `election_hods`, `candidates`, `votes`, `tie_breaks`, `tie_break_candidates`, `tie_break_votes`, `election_winners`.
2. **Database → Tables → schema `private`**: `admin_principals`, `admin_credentials`, `admin_sessions`, `audit_logs`.
3. **Database → Functions → schema `private`**: workflow functions including `submit_ballot`, `submit_tie_break_vote`, `create_election`, `set_election_status`, `reset_election`, `soft_delete_election`, `initiate_tie_break`, `set_tie_break_status`, `finalize_winner`, `set_admin_credential_hash`, and `get_audit_logs`. Trigger/helper functions also appear there.
4. **Database → Policies**: RLS enabled for all nine public application tables. `votes` has only the administrative SELECT policy; it has no browser INSERT/UPDATE/DELETE policy.
5. **Database → Views → schema `private`**: `candidate_results`, `election_turnout`, `hod_ballots`, `category_outcomes`, `tie_break_results`, `final_winners`.
6. **Project Settings → API → Data API exposed schemas**: keep `public` and `graphql_public`; `private` must not be listed.
7. **Database → Extensions**: `pgcrypto` enabled in the `extensions` schema.
8. **Database → Advisors → Security**: inspect all findings after the verification query passes.

No real HOD, candidate, passcode, or election data should be added during Phase 1.5.
