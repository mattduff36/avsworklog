# Scripts Directory

This directory contains utility scripts for database management, testing, and maintenance.

## Fixerrors analysis and review

The `.cursor/commands/fixerrors.md` contract permits the premium parent or its assigned premium worker to analyze the captured snapshot and implement authorized repairs. It does not require a separate analysis Task or a second model review for every code change. The root selects independent review for material risk, unresolved uncertainty, an owner request or an applicable repository gate; workers never delegate. Keep targeted tests, parent acceptance, candidate-bound evidence and unresolved review blockers. The legacy review marker is emitted only when that selected review actually ran. Snapshot/decision validation, privacy, production authorization, recovery artifacts and release gates are unchanged; generated evidence stays under ignored `docs_private/`. Follow the command for project-specific mutation and recovery behavior.

`npm run fixerrors` now requires clean local `main` at run start and investigates new exact groups through scoped **MPDEE Worker** requests before revisiting held cases oldest-first. It uses the same checkout, never a worktree. Routine bounded repairs run named isolated checks without generic approval; critical scopes and unsafe candidate drift remain blocked. No automatic staging, commits, push or deployment. `npm run fixerrors -- --capture-only` keeps the legacy read-only capture/explicit finalization workflow.

`fixerrors-lifecycle.ts` uses existing triage columns plus sanitized `additional_data.fixerrorsLifecycle` history: awaiting-evidence/actionable/awaiting-deployment remain active/outstanding; no-fix resolutions are archived separately from fixed-live. Only evidence gaps expire after 30 days without exact matching new evidence; reviewed actionable defects/local repairs do not. Transactions bind exact IDs/current-row hashes, preserve diagnostics, and verify pre/post receipts. Account-merge or other unreviewed triggers fail closed; their side effects need separately approved investigation, not a migration/SQL workaround or a weaker v5 guard. Local repairs retain the verified candidate and require separately approved deployment and relevant live verification.

The private `fixerrors-auto-outcome.json`, run-specific outcomes/decisions/failures, lifecycle plan/receipts and refreshed exact-row summary retain blocked attempts and oldest/expiry evidence. `npm run fixerrors -- --resume-lifecycle=<plan-hash> --confirm-target=<database-target-fingerprint>` replays only the saved hash-bound pre-receipt, without workers or app edits; committed identical plans are idempotently verifiable after expiry, whereas unapplied expired/mixed/drifted plans fail closed. The default summary has no generic "Say fix" approval loop. No new schema is required. Isolated regressions are `tests/unit/fixerrors-auto.test.ts`, `fixerrors-lifecycle.test.ts`, and disposable PostgreSQL `fixerrors-lifecycle-postgres.test.ts` through `local-native-test-postgres.ts one-shot --target tests/unit/fixerrors-lifecycle-postgres.test.ts`.

## Directory Structure

### `/migrations`
Historical feature runners and one-off scripts. They are **not** a “run in order / run all” tool.
- **Pattern:** `run-*-migration.ts`, `add-*-migration.ts`, `migrate-*.ts`
- **Current execution:** `npm run finalise` for branch files; `npm run migrate -- supabase/migrations/<file>.sql` for one explicit predeploy transactional file
- **Do not use:** `scripts/migrations/run-migration.ts` and `scripts/migrations/run-day-of-week-migration.ts` are historical, unwired, and must not be run against a live database

### `/seed`
Data seeding scripts for development and testing.
- **Pattern:** `seed-*.ts`, `create-*.ts`
- **Usage:** `npm run seed:sample-data` or `tsx scripts/seed/<script-name>.ts`

### `/maintenance`
Operational maintenance scripts.
- **Pattern:** `setup-*.ts`, `clear-*.ts`, `cleanup-*.ts`, `backup-*.ts`
- **Purpose:** Database cleanup, backups, configuration setup
- **Usage:** `tsx scripts/maintenance/<script-name>.ts`

### `/testing`
Testing and verification scripts.
- **Pattern:** `test-*.ts`, `check-*.ts`, `verify-*.ts`, `diagnose-*.ts`
- **Purpose:** Test features, verify configurations, check data integrity
- **Usage:** `tsx scripts/testing/<script-name>.ts`

### `/archived`
Historical fix scripts kept for reference.
- **Pattern:** `fix-*.ts`, `emergency-*.ts`, `URGENT-*.ts`, `restore-*.ts`
- **Purpose:** Archive of one-time fixes
- **Note:** These scripts are kept for historical reference only

## Common Commands

```bash
# Validate one explicit predeploy migration (no connection)
npm run migrate -- supabase/migrations/<file>.sql

# Seed sample data
npm run seed:sample-data

# Create test users
tsx scripts/seed/create-test-users.ts

# Clear inspections
tsx scripts/maintenance/clear-inspections.ts

# Test features
tsx scripts/testing/test-reports.ts
```

## Guidelines

1. **Migrations:** Forward-only dated files under `supabase/migrations/`. Do not edit shipped SQL or ledger evidence; add a corrective migration. The generic runner is predeploy/transaction-only and requires `--apply --confirm-target <project-ref>` before it will connect.
2. **Seed scripts:** Should check for existing data before inserting
3. **Maintenance:** Should require confirmation for destructive operations
4. **Testing:** Should not modify production data
5. **Archived:** Should not be modified or run in production

## Environment Variables

Finalise and generic-runner **apply** require `.env.local` with:
- `POSTGRES_URL_NON_POOLING` - session-mode database connection

The generic runner's default dry-run does not load `.env.local` or any connection configuration.

Other operational scripts may also need:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key

## Best Practices

- Always test scripts on staging/dev first
- Use `--dry-run` flags where available
- Log all operations for audit trail
- Handle errors gracefully
- Document what each script does

Monthly advisor follow-ups now produce a premium lead handoff. Approval/rejection remains explicit, and non-interactive runs leave undecided suggestions pending. Approved plans stay repository-local; resolving a follow-up does not open Cursor, dispatch a worker or activate a schedule. The lead may dispatch only approved, scoped implementation through the installed premium runner, retains operational/release authority, and checks its completion evidence. Legacy Cursor stop-hook telemetry remains editor-specific and is not required for worker receipts.
