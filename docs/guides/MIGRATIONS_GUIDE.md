# Database Migrations Guide

## Overview

Migrations are **forward-only dated files** under `supabase/migrations/`. Execution is ledger-backed: filename, SHA-256 checksum, and `finalise-phase` are recorded in `private.finalise_migration_ledger`.

Normal branch execution is `npm run finalise`. The generic one-file runner is for a single explicit predeploy transactional file. Postdeploy and non-transactional SQL stay on a reviewed feature-specific runner.

Dated reports that mention `POSTGRES_URL` fallback, root `scripts/run-migration.ts`, “run all migrations”, dashboard/manual SQL, or rollback scripts are historical and not current authority.

---

## Prerequisites

`.env.local` must contain a session-mode connection. There is **no** `POSTGRES_URL` fallback.

```bash
POSTGRES_URL_NON_POOLING="postgresql://postgres.[project-ref]:[password]@host:5432/postgres"
```

Use **Session mode** (port 5432). Port 6543 is rejected. Never print this value. Never use `SUPABASE_SERVICE_ROLE_KEY` or Supabase RPC to apply SQL.

---

## Running Migrations

### Finalise (normal branch path)

```bash
npm run finalise
```

Finalise discovers dated files from the branch and workspace delta, then applies or reuses each file through the shared lock/ledger executor.

### Generic one-file runner

```bash
# Validation only; no dotenv load, client, or ledger read
npm run migrate -- supabase/migrations/<file>.sql

# Explicit apply; exact target confirmation required before any client is constructed
npm run migrate -- supabase/migrations/<file>.sql --apply --confirm-target <project-ref>
```

Limits: one path, dry-run by default, predeploy only, transactional SQL only, exact `--confirm-target` match. Apply still requires conversational CRITICAL authorization.

### Feature-specific runners

Use `npx tsx scripts/run-<feature>-migration.ts` only for reviewed postdeploy or non-transactional work. Do not treat historical `scripts/migrations/run-migration.ts` or `run-day-of-week-migration.ts` as executable.

---

## Creating a New Migration

1. Add a new dated file under `supabase/migrations/`, for example `20260820_describe_the_change.sql`.
2. Never edit a shipped file. If a live change was wrong, add a forward corrective migration.
3. Optional header metadata:

```sql
-- finalise-phase: predeploy
```

Omit the header to default to `predeploy`. Use `postdeploy` only when a dedicated workflow will apply the file. The generic runner rejects `postdeploy`.

4. Prefer one removable outer transaction if the file owns `BEGIN`/`COMMIT`. Remaining transaction-control statements after that strip are rejected by the generic runner.

```sql
-- finalise-phase: predeploy
BEGIN;
CREATE TABLE IF NOT EXISTS example (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
);
COMMIT;
```

Do not include `CREATE INDEX CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM`, or `CREATE`/`DROP DATABASE` in a generic-runner file.

---

## Ledger and checksum semantics

- Ledger table: `private.finalise_migration_ledger`
- Primary key: canonical repo-relative filename (`supabase/migrations/<file>.sql`)
- `checksum_sha256` is the SHA-256 of the file bytes
- `phase` is `predeploy` or `postdeploy`
- Matching filename + checksum + phase → **reuse** (no SQL executed)
- Checksum or phase mismatch → **drift**; stop. Do not delete or edit ledger rows
- Failed apply rolls back the transaction and must not insert a ledger row

---

## Best practices

### Use IF NOT EXISTS for additive objects

```sql
CREATE TABLE IF NOT EXISTS my_table (...);
CREATE INDEX IF NOT EXISTS idx_name ON my_table(column);
```

### Adding a column

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='my_table' AND column_name='new_column'
  ) THEN
    ALTER TABLE my_table ADD COLUMN new_column TEXT;
  END IF;
END $$;
```

### After rename or drop

Run `npm run db:validate` before commit. See [`HOW_TO_RUN_MIGRATIONS.md`](./HOW_TO_RUN_MIGRATIONS.md).

### Never use pooled transaction-mode connections for DDL

```bash
# Required
POSTGRES_URL_NON_POOLING="postgresql://..."

# Not a migration fallback
# POSTGRES_URL="postgresql://..."
```

---

## Forward-only correction

There is no automatic down path. Do not write rollback scripts that delete ledger evidence or rewrite historical SQL. Add a new dated corrective migration and apply it through finalise or a reviewed runner.

---

## Troubleshooting

### `POSTGRES_URL_NON_POOLING` is not set

Add the session-mode URI to `.env.local`. Do not substitute `POSTGRES_URL`.

### Confirm-target does not match

Pass the exact project ref derived from the connection. CLI flags are not authorization.

### Generic runner rejected the file

Postdeploy, ledger-targeting, leftover transaction control, or non-transactional SQL need a reviewed feature-specific runner.

### Checksum or phase drift

Stop. Investigate. Recover with a new forward file, not by editing the applied file or the ledger.

---

## Related docs

- [`HOW_TO_RUN_MIGRATIONS.md`](./HOW_TO_RUN_MIGRATIONS.md)
- [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md)
- [`.cursor/rules/database-migrations.mdc`](../../.cursor/rules/database-migrations.mdc)
