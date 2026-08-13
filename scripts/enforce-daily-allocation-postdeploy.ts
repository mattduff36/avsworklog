import { config } from 'dotenv';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import {
  decideFinaliseMigrationLedgerAction,
  FINALISE_MIGRATION_LEDGER_SQL,
  stripOuterMigrationTransaction,
  type FinaliseMigrationFile,
  type FinaliseMigrationLedgerRow,
} from './finalise-migrations';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260813_zz_daily_allocation_enforcement.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING in .env.local.');
  process.exit(1);
}

const configuredUrl = new URL(connectionString);
const configuredPort = Number.parseInt(configuredUrl.port, 10) || 5432;

if (configuredPort === 6543) {
  console.error('Daily allocation enforcement cannot use Supavisor transaction mode on port 6543. Use direct or session mode on port 5432.');
  process.exit(1);
}

async function runEnforcement(conn: string) {
  const url = new URL(conn);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running daily allocation post-deploy enforcement...');
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    const migration: FinaliseMigrationFile = {
      relativePath: sqlFile,
      checksumSha256: createHash('sha256').update(sql, 'utf8').digest('hex'),
      phase: 'postdeploy',
      sql,
    };

    await client.query('BEGIN');
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('private.finalise_migration_ledger', 0))"
      );
      await client.query(FINALISE_MIGRATION_LEDGER_SQL);
      const ledgerResult = await client.query<FinaliseMigrationLedgerRow>(
        `SELECT filename, checksum_sha256, phase, applied_at
         FROM private.finalise_migration_ledger
         WHERE filename = $1`,
        [sqlFile]
      );
      const decision = decideFinaliseMigrationLedgerAction(
        migration,
        ledgerResult.rows[0] ?? null
      );
      if (decision === 'apply') {
        await client.query(stripOuterMigrationTransaction(sql));
        await client.query(
          `INSERT INTO private.finalise_migration_ledger
             (filename, checksum_sha256, phase)
           VALUES ($1, $2, $3)`,
          [sqlFile, migration.checksumSha256, migration.phase]
        );
      }
      await client.query('COMMIT');
      console.log(
        decision === 'apply'
          ? 'Daily allocation enforcement applied and recorded.'
          : 'Daily allocation enforcement already applied; ledger entry reused.'
      );
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const { rows } = await client.query<{
      enabled_teams: number;
      module_exists: boolean;
      trigger_installed: boolean;
    }>(`
      SELECT
        (
          SELECT COUNT(*)::INTEGER
          FROM public.team_module_permissions
          WHERE module_name = 'daily-allocation'
            AND enabled = TRUE
        ) AS enabled_teams,
        EXISTS (
          SELECT 1
          FROM public.permission_modules
          WHERE module_name = 'daily-allocation'
        ) AS module_exists,
        EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'plant_inspections_job_guard'
            AND NOT tgisinternal
        ) AS trigger_installed
    `);

    if (!rows[0]?.trigger_installed || !rows[0].module_exists) {
      throw new Error('Daily allocation enforcement verification failed.');
    }

    console.log(
      `Daily allocation post-deploy enforcement complete (${rows[0].enabled_teams} enabled team defaults).`
    );
  } finally {
    await client.end();
  }
}

runEnforcement(connectionString).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
