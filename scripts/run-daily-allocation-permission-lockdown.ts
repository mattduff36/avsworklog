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
const sqlFile =
  'supabase/migrations/20260813102922_daily_allocation_admin_only_permissions.sql';

try {
  requireSafeMigrationConnectionString(connectionString);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function runPermissionLockdown(conn: string) {
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
    console.log('Running Daily Allocation admin-only permission lockdown...');
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
          ? 'Daily Allocation permission lockdown applied and recorded.'
          : 'Daily Allocation permission lockdown already applied; ledger entry reused.'
      );
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const { rows } = await client.query<{
      module_level: number | null;
      enabled_teams: number;
      positive_direct_rows: number;
      effective_non_admins: number;
      admin_profiles: number;
      effective_level_five_admins: number;
      snapshot_exists: boolean;
    }>(`
      SELECT
        (
          SELECT roles.hierarchy_rank
          FROM public.permission_modules
          JOIN public.roles
            ON roles.id = permission_modules.minimum_role_id
          WHERE permission_modules.module_name = 'daily-allocation'
            AND permission_modules.access_mode = 'team'
        ) AS module_level,
        (
          SELECT COUNT(*)::INTEGER
          FROM public.team_module_permissions
          WHERE module_name = 'daily-allocation'
            AND enabled = TRUE
        ) AS enabled_teams,
        (
          SELECT COUNT(*)::INTEGER
          FROM public.user_module_permissions
          WHERE module_name = 'daily-allocation'
            AND access_level > 0
        ) AS positive_direct_rows,
        (
          SELECT COUNT(*)::INTEGER
          FROM public.profiles
          JOIN public.roles ON roles.id = profiles.role_id
          WHERE NOT (
            COALESCE(roles.is_super_admin, FALSE)
            OR roles.name = 'admin'
            OR roles.role_class = 'admin'
          )
            AND public.user_module_access_level(
              profiles.id,
              profiles.role_id,
              profiles.team_id,
              'daily-allocation'
            ) > 0
        ) AS effective_non_admins,
        (
          SELECT COUNT(*)::INTEGER
          FROM public.profiles
          JOIN public.roles ON roles.id = profiles.role_id
          WHERE COALESCE(roles.is_super_admin, FALSE)
            OR roles.name = 'admin'
            OR roles.role_class = 'admin'
        ) AS admin_profiles,
        (
          SELECT COUNT(*)::INTEGER
          FROM public.profiles
          JOIN public.roles ON roles.id = profiles.role_id
          WHERE (
            COALESCE(roles.is_super_admin, FALSE)
            OR roles.name = 'admin'
            OR roles.role_class = 'admin'
          )
            AND public.user_module_access_level(
              profiles.id,
              profiles.role_id,
              profiles.team_id,
              'daily-allocation'
            ) = 5
        ) AS effective_level_five_admins,
        EXISTS (
          SELECT 1
          FROM private.daily_allocation_permission_lockdown_snapshots
          WHERE snapshot_key = '20260813102922_admin_only_permissions'
        ) AS snapshot_exists
    `);

    const result = rows[0];
    if (
      result?.module_level !== 2
      || result.enabled_teams !== 0
      || result.positive_direct_rows !== 0
      || result.effective_non_admins !== 0
      || result.admin_profiles < 1
      || result.effective_level_five_admins !== result.admin_profiles
      || !result.snapshot_exists
    ) {
      throw new Error('Daily Allocation permission lockdown verification failed.');
    }

    console.log(
      `Daily Allocation permissions verified: ${result.admin_profiles} admins at Level 5; all non-admins at Level 0.`
    );
  } finally {
    await client.end();
  }
}

runPermissionLockdown(connectionString!).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
