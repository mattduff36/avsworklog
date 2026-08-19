/**
 * Apply snapshot-order and team-permission trigger closure fixes.
 *
 * Usage: npx tsx scripts/run-system-accounts-review-fixes-migration.ts
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const TARGET_PROJECT_REF = 'lrhufzqfzeutgvudcowy';
const sqlFile = 'supabase/migrations/20260819180000_system_accounts_review_fixes.sql';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

if (!connectionString.includes(TARGET_PROJECT_REF)) {
  console.error('Database connection string does not target the approved Supabase project.');
  process.exit(1);
}

async function runMigration() {
  console.log('Running system accounts review-fixes migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows: triggerRows } = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname = 'protect_system_team_permissions'
    `);
    const definition = triggerRows[0]?.definition || '';
    if (!definition.includes('OLD.team_id') || !definition.includes('cannot be moved')) {
      throw new Error('System team permission trigger does not block row moves');
    }

    const { rows: snapshotRows } = await client.query<{
      team_before: unknown;
      team_permissions_before: unknown;
      snapshot_rows: string;
    }>(`
      SELECT
        snapshot.team_before,
        snapshot.team_permissions_before,
        (
          SELECT COUNT(*)::TEXT
          FROM private.system_account_absence_snapshots
          WHERE snapshot_key = 'yard-kiosk-system-accounts-v1'
        ) AS snapshot_rows
      FROM private.system_account_migration_snapshots AS snapshot
      WHERE snapshot.snapshot_key = 'yard-kiosk-system-accounts-v1'
    `);
    if (snapshotRows.length !== 1) {
      throw new Error('Expected the v1 kiosk migration snapshot');
    }
    if (snapshotRows[0]?.team_before !== null) {
      throw new Error('v1 team snapshot must record the pre-seed empty state');
    }
    if (Number.parseInt(snapshotRows[0]?.snapshot_rows || '0', 10) !== 6) {
      throw new Error('v1 absence snapshots must remain intact');
    }

    console.log('System accounts review-fixes migration completed and verified.');
  } catch (error) {
    console.error(
      'System accounts review-fixes migration failed:',
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
