# Scripts Directory

This directory contains utility scripts for database management, testing, and maintenance.

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
