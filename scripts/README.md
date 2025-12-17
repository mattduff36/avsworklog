# Scripts Directory

This directory contains utility scripts for database management, testing, and maintenance.

## Directory Structure

### `/migrations`
Database migration scripts. These should be run in order.
- **Pattern:** `run-*-migration.ts`, `add-*-migration.ts`, `migrate-*.ts`
- **Usage:** `npm run migrate` or `tsx scripts/migrations/<script-name>.ts`

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
# Run a migration
tsx scripts/migrations/run-migration.ts

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

1. **Migrations:** Should be idempotent and include rollback logic
2. **Seed scripts:** Should check for existing data before inserting
3. **Maintenance:** Should require confirmation for destructive operations
4. **Testing:** Should not modify production data
5. **Archived:** Should not be modified or run in production

## Environment Variables

All scripts require `.env.local` with:
- `POSTGRES_URL_NON_POOLING` - Direct database connection
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key

## Best Practices

- Always test scripts on staging/dev first
- Use `--dry-run` flags where available
- Log all operations for audit trail
- Handle errors gracefully
- Document what each script does
