# Antilia Voting Portal — Phase 1.5 Hosted Database

This repository contains the production-oriented Supabase PostgreSQL architecture from Phase 1 plus the hosted connection and verification workflow from Phase 1.5. It does not contain frontend, authentication screens, charts, voting pages, or deployment configuration.

The primary workflow uses a hosted Supabase project. **Docker and a local Supabase stack are not required.** Follow [docs/HOSTED_SUPABASE.md](docs/HOSTED_SUPABASE.md) to inspect, dry-run, apply, and verify the migrations safely.

## Entity model

- `hods` stores the current HOD directory. `mobile_normalized` is a stored generated value (digits only, with an initial international `00` removed) and is unique. Inputs should use a country-code-qualified number; local and international forms are not guessed to be equivalent.
- `elections` stores one current monthly election per `(year, month)`. A partial unique index permits only a history-preserving reset replacement after the prior record is soft-deleted.
- `election_hods` is the election-specific approval/eligibility list and retains name, department, and normalized-mobile snapshots for history.
- `candidates` belongs to one election and one `FOH`/`BOH` category.
- `votes` stores the immutable candidate votes. A composite FK guarantees candidate election/category alignment; another composite FK guarantees election eligibility. `UNIQUE(election_id, hod_id, category)` is the final duplicate-vote guard.
- `tie_breaks`, `tie_break_candidates`, and `tie_break_votes` represent independent, normalized rounds linked to the original election. Original votes are never overwritten.
- `election_winners` stores explicitly finalized normal or tie-break winners. Private reporting views also expose provisional ranking/tie detection.
- `private.admin_principals`, `admin_credentials`, and `admin_sessions` provide the future HR/SYSTEM authorization and server-session structure. Passcodes are never stored; only Argon2id or bcrypt hash strings and SHA-256-sized session token hashes are accepted.
- `private.audit_logs` records security and business events. Entity IDs are intentionally not all foreign keys so a durable audit reference survives soft deletion or future retention operations.

## State and transaction guarantees

Only DRAFT elections permit candidate and election-HOD changes. Row locks serialize configuration changes against opening. `OPEN` enables voting; `CLOSED` rejects voting. Only the private SYSTEM workflow functions can change status through the intended server path.

`private.submit_ballot` locks the election and HOD eligibility rows, resolves the normalized mobile number without exposing the HOD directory, validates both candidates, and inserts FOH + BOH in one statement. Any error aborts the whole function call. A deferred constraint trigger also rejects any privileged/direct database operation that leaves an incomplete or mixed ballot. The exact category uniqueness constraint prevents races and duplicate category votes.

Votes are immutable. Reset does not erase them: `private.reset_election` retires the original election and creates a fresh DRAFT replacement with copied HOD/candidate configuration. This preserves every original result and timestamp.

## Security decisions

- RLS is enabled on every public table and on private tables as defense in depth.
- `anon` has no table access, no private-schema access, and cannot execute vote functions.
- Authenticated HR/SYSTEM users can access public tables only when their `auth.uid()` exists in the private active admin allow-list. HR/SYSTEM candidate writes are still blocked by state triggers after opening.
- Votes, tie-break administration, election state changes, credentials, sessions, audits, and result views use a non-exposed `private` schema or private workflow functions.
- Privileged functions use `SECURITY DEFINER` only where RLS/private-table access requires it, set `search_path = ''`, fully qualify relations, revoke default PUBLIC execution, and grant specific entry points only to `service_role`.
- The future Next.js server must call private workflows over a server-only pooled Postgres connection. Never expose the database password, Supabase secret/service-role key, or any value derived from them in browser code or `NEXT_PUBLIC_*` variables.
- `private` is deliberately absent from `api.schemas` in `supabase/config.toml`; do not expose it through PostgREST.

## Reporting

The private `security_invoker` views are:

- `candidate_results`: totals, percentages, FOH/BOH dense ranking, tie flag
- `election_turnout`: eligible, voted, and turnout percentage
- `hod_ballots`: voted/not-voted plus individual FOH and BOH choices
- `category_outcomes`: provisional winner and tie detection
- `tie_break_results`: independent tie-break totals and ranking
- `final_winners`: finalized FOH/BOH winners

Because the views are `security_invoker`, underlying RLS remains effective. They are also outside the exposed schemas.

## Migration layout

1. `20260910064758_phase_1_voting_architecture.sql` — enums, tables, constraints, FKs, and core indexes
2. `20260910064806_phase_1_security_and_workflows.sql` — triggers, RLS, grants/revokes, audit capture, atomic voting, SYSTEM workflows, and tie-break creation
3. `20260910064807_phase_1_reporting.sql` — private admin views and reporting/audit indexes
4. `20260910073529_phase_1_5_hod_eligibility_hardening.sql` — forward-only inactive-HOD eligibility correction
5. `seed.sql` — fake demo data only; never pass `--include-seed` during a hosted push
6. `tests/hosted_preflight.sql` — read-only conflict detection before migration
7. `tests/hosted_verification.sql` — read-only hosted schema/security verification
8. `tests/hosted_functional_test.sql` — staging-only transactional test that ends in `ROLLBACK`
9. `tests/database/*.sql` — OPTIONAL LOCAL TESTS retained for future CI; not required by the hosted workflow

## Verify Phase 1.5 without Docker

After linking to a hosted development project, the primary verification commands are:

```bash
DO_NOT_TRACK=1 supabase db query --linked --file supabase/tests/hosted_preflight.sql
DO_NOT_TRACK=1 supabase db push --linked --dry-run
DO_NOT_TRACK=1 supabase db push --linked
DO_NOT_TRACK=1 supabase db query --linked --file supabase/tests/hosted_verification.sql
```

Do not push when preflight returns `REVIEW_REQUIRED`. Do not use `supabase db reset --linked`, and do not pass `--include-seed`. Full sequencing and Dashboard checks are in [docs/HOSTED_SUPABASE.md](docs/HOSTED_SUPABASE.md).

## Assumptions and bootstrap

- Mobile values are normalized by removing punctuation and an initial international `00`; callers must include a consistent country code. The database does not guess a country for local numbers.
- Eligibility is election-specific. HR prepares `election_hods` while the election is DRAFT; opening freezes that list and its historical snapshots.
- A trusted deployment/bootstrap step creates the first `private.admin_principals` SYSTEM row. Its optional `auth_user_id` links a future Supabase Auth identity; server-managed passcode sessions can instead use the hash/session tables.
- Server code authenticates the caller before supplying `p_actor_admin_id` to service-role-only functions. The functions independently require that ID to be an active HR/SYSTEM principal, but the service-role credential itself remains a trusted server secret.
- “Reset” means retire-and-replace, not destructive vote deletion. “Delete” is a soft delete. Both choices are intentional so election history remains available.
