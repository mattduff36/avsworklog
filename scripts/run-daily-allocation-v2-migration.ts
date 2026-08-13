import { config } from 'dotenv';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import {
  decideFinaliseMigrationLedgerAction,
  FINALISE_MIGRATION_LEDGER_SQL,
  requireSafeMigrationConnectionString,
  stripOuterMigrationTransaction,
  type FinaliseMigrationFile,
  type FinaliseMigrationLedgerRow,
} from './finalise-migrations';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260813_zzz_daily_allocation_v2_visit_model.sql';

try {
  requireSafeMigrationConnectionString(connectionString);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function runMigration(conn: string) {
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
    console.log('Running daily allocation v2 visit-model migration...');
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    const migration: FinaliseMigrationFile = {
      relativePath: sqlFile,
      checksumSha256: createHash('sha256').update(sql, 'utf8').digest('hex'),
      phase: 'predeploy',
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
          ? 'Daily allocation v2 visit-model migration applied and recorded.'
          : 'Daily allocation v2 visit-model migration already applied; ledger entry reused.'
      );
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const { rows } = await client.query<{
      plan_days: boolean;
      visits: boolean;
      visit_labour: boolean;
      visit_plant: boolean;
      published_visits: boolean;
      published_labour: boolean;
      published_plant: boolean;
      notifications: boolean;
      snapshot_version: boolean;
      v1_publications: boolean;
      v2_gated: boolean;
      publish_rpc: boolean;
    }>(`
      SELECT
        to_regclass('public.daily_allocation_plan_days') IS NOT NULL AS plan_days,
        to_regclass('public.daily_allocation_visits') IS NOT NULL AS visits,
        to_regclass('public.daily_allocation_visit_labour') IS NOT NULL AS visit_labour,
        to_regclass('public.daily_allocation_visit_plant') IS NOT NULL AS visit_plant,
        to_regclass('public.daily_allocation_published_visits') IS NOT NULL AS published_visits,
        to_regclass('public.daily_allocation_published_labour') IS NOT NULL AS published_labour,
        to_regclass('public.daily_allocation_published_plant') IS NOT NULL AS published_plant,
        to_regclass('public.daily_allocation_publication_notifications') IS NOT NULL AS notifications,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'daily_allocation_publications'
            AND column_name = 'snapshot_version'
        ) AS snapshot_version,
        to_regclass('public.daily_allocation_publications') IS NOT NULL AS v1_publications,
        EXISTS (
          SELECT 1
          FROM private.daily_allocation_v2_runtime
          WHERE singleton = TRUE
            AND writes_enabled = FALSE
            AND board_enabled = FALSE
        ) AS v2_gated,
        to_regprocedure(
          'public.publish_daily_allocation_plan_v2(uuid,integer,text,boolean)'
        ) IS NOT NULL AS publish_rpc
    `);

    const result = rows[0];
    if (
      !result?.plan_days
      || !result.visits
      || !result.visit_labour
      || !result.visit_plant
      || !result.published_visits
      || !result.published_labour
      || !result.published_plant
      || !result.notifications
      || !result.snapshot_version
      || !result.v1_publications
      || !result.v2_gated
      || !result.publish_rpc
    ) {
      throw new Error('Daily allocation v2 visit-model migration verification failed.');
    }

    console.log('Daily allocation v2 visit-model migration complete.');
  } finally {
    await client.end();
  }
}

runMigration(connectionString!).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
