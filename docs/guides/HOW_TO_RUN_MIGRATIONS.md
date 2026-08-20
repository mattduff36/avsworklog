# How To Run Database Migrations

## TL;DR

```bash
# Normal branch path: finalise discovers dated files and applies them through the ledger
npm run finalise

# Generic one-file runner: validation only (no connection)
npm run migrate -- supabase/migrations/<file>.sql

# Generic one-file apply: still requires conversational CRITICAL authorization
npm run migrate -- supabase/migrations/<file>.sql --apply --confirm-target <project-ref>

# After a rename/drop of a column or table
npm run db:validate
```

The generic runner is **predeploy and transaction-only**. It accepts exactly one file under `supabase/migrations/`, defaults to dry-run, and requires an exact `--confirm-target` project ref before it will construct a client.

Postdeploy and non-transactional SQL (for example `CREATE INDEX CONCURRENTLY`) stay on a reviewed feature-specific runner. Dated reports that mention dashboard SQL, `POSTGRES_URL` fallback, `scripts/migrations/run-migration.ts`, or “run all migrations” are historical.

Load `.cursor/rules/database-migrations.mdc` before running anything against a live database.

---

## Why db:validate Is Mandatory After Rename/Drop

PostgreSQL trigger functions store column names as plain text. When you rename a column (`vehicle_id → van_id`), **the trigger is not updated automatically** and PostgreSQL won't warn you — the error only appears when a user fires the trigger in production.

`npm run db:validate` catches this by:

- Scanning every trigger function body for `NEW.col` / `OLD.col` references and checking those columns exist on the trigger's table
- Checking that all required columns exist on core tables (`van_inspections`, `vehicle_maintenance`, etc.)
- Verifying critical FK relationships (`plant.category_id → van_categories`, etc.)

**Rule:** If your migration renames a column, renames a table, or drops a column — run `npm run db:validate` before committing.

---

## What You Need

Your `.env.local` file must have a session-mode connection on port 5432:

```bash
POSTGRES_URL_NON_POOLING="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"
```

**Where to get this:**

1. Supabase Dashboard → Settings → Database
2. Connection string → URI → Session mode
3. Copy and paste into `.env.local`

Never use `POSTGRES_URL`, port 6543, `SUPABASE_SERVICE_ROLE_KEY`, or dashboard/manual SQL as a migration fallback. Never print the connection string.

The `--confirm-target` value is the bare project ref (the `postgres.<ref>` or `db.<ref>.supabase.co` identifier), not a URL.

---

## How Branch Execution Works

`npm run finalise` is the normal path for migrations that land on a branch:

1. Discovers dated SQL under `supabase/migrations/` from the branch/workspace delta
2. Loads checksum and `finalise-phase` metadata
3. Connects with `POSTGRES_URL_NON_POOLING`
4. Acquires the ledger locks, rereads `private.finalise_migration_ledger`, and either applies or reuses
5. Records filename, checksum, and phase in the ledger

Do not edit a shipped migration. Recovery is a new forward corrective file.

---

## Generic One-File Runner Limits

`npm run migrate` validates or applies **one explicit file**. It will reject:

- missing, multiple, unknown, or conflicting arguments
- absolute, drive-qualified, UNC, traversal, symlink-escape, or non-`.sql` paths
- `postdeploy` phase
- SQL that targets `private.finalise_migration_ledger`
- remaining transaction-control statements after one removable outer `BEGIN`/`COMMIT`
- known non-transactional operations (`CREATE INDEX CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM`, `CREATE`/`DROP DATABASE`)

Dry-run prints only the canonical path, phase, checksum prefix, and `validated`. It does not load dotenv, construct a client, or inspect the ledger.

---

## Feature-Specific Runners

Use a reviewed `scripts/run-<feature>-migration.ts` only when the generic runner cannot: postdeploy work, non-transactional statements, or an already-approved dedicated workflow. Those scripts are not a “run all” tool.

---

## Common Issues

### "Missing database connection string" / `POSTGRES_URL_NON_POOLING is not set`

**Fix:** Add `POSTGRES_URL_NON_POOLING` to `.env.local`. Do not fall back to `POSTGRES_URL`.

### Confirm-target mismatch

**Fix:** Pass the exact project ref from the session-mode connection. CLI flags do not replace conversational CRITICAL authorization.

### Non-transactional or postdeploy rejection

**Fix:** Use a reviewed feature-specific runner. Do not force the generic runner.

---

## More Details

See [`MIGRATIONS_GUIDE.md`](./MIGRATIONS_GUIDE.md) for file layout, ledger/checksum semantics, and forward-only correction.

**Remember:** Run migrations with `POSTGRES_URL_NON_POOLING` and exact target confirmation. Do not execute SQL in the dashboard.
