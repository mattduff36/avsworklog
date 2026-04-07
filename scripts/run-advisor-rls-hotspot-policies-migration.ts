import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260407_optimize_rls_hotspot_policies.sql';

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const migrationSql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8');
    console.log(`Applying ${MIGRATION_FILE}...`);
    await client.query(migrationSql);

    const { rows: anchorRows } = await client.query<{ touched_count: string }>(`
      SELECT COUNT(*)::text AS touched_count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname = ANY (ARRAY[
          'Absence editors can create scoped absences',
          'Managers can view all actions',
          'Managers can view all inspections',
          'Managers can view all plant inspections',
          'Users can view own hgv inspections',
          'Managers can view all inspection daily hours',
          'Managers can view all inspection items',
          'Managers can view all messages'
        ]);
    `);

    const anchorCount = Number(anchorRows[0]?.touched_count || '0');
    if (anchorCount !== 8) {
      throw new Error(`Verification failed: expected 8 anchor policies, found ${anchorCount}`);
    }

    const { rows: patternRows } = await client.query<{
      direct_auth_uid: string;
      direct_mgr_helper: string;
      direct_workshop_helper: string;
      direct_supervisor_helper: string;
      direct_module_helper: string;
      direct_absence_editor_helper: string;
    }>(`
      WITH target_policies AS (
        SELECT lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) AS expr
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY (ARRAY[
            'absences',
            'actions',
            'van_inspections',
            'plant_inspections',
            'hgv_inspections',
            'inspection_daily_hours',
            'inspection_items',
            'messages'
          ])
      )
      SELECT
        COUNT(*) FILTER (
          WHERE expr ~ 'auth\\.uid\\(\\)'
            AND expr !~ '\\(\\s*select\\s+auth\\.uid\\(\\)'
        )::text AS direct_auth_uid,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_is_manager_admin\\(\\)'
            AND expr !~ '\\(\\s*select\\s+effective_is_manager_admin\\(\\)'
        )::text AS direct_mgr_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_is_workshop_team\\(\\)'
            AND expr !~ '\\(\\s*select\\s+effective_is_workshop_team\\(\\)'
        )::text AS direct_workshop_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_is_supervisor\\(\\)'
            AND expr !~ '\\(\\s*select\\s+effective_is_supervisor\\(\\)'
        )::text AS direct_supervisor_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'effective_has_module_permission\\('
            AND expr !~ '\\(\\s*select\\s+effective_has_module_permission\\('
        )::text AS direct_module_helper,
        COUNT(*) FILTER (
          WHERE expr ~ 'is_actor_absence_secondary_editor\\('
            AND expr !~ '\\(\\s*select\\s+is_actor_absence_secondary_editor\\('
        )::text AS direct_absence_editor_helper
      FROM target_policies;
    `);

    const patternRow = patternRows[0];
    const remainingDirectCalls = [
      Number(patternRow?.direct_auth_uid || '0'),
      Number(patternRow?.direct_mgr_helper || '0'),
      Number(patternRow?.direct_workshop_helper || '0'),
      Number(patternRow?.direct_supervisor_helper || '0'),
      Number(patternRow?.direct_module_helper || '0'),
      Number(patternRow?.direct_absence_editor_helper || '0'),
    ].reduce((sum, value) => sum + value, 0);

    if (remainingDirectCalls !== 0) {
      throw new Error(
        `Verification failed: found ${remainingDirectCalls} remaining direct auth/helper patterns in hotspot policies`
      );
    }

    console.log('Hotspot policy anchors verified.');
    console.log('Direct auth/helper hotspot patterns remaining: 0');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
