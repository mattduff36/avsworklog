import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260409_restore_workshop_manager_draft_access.sql';

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

    const { rows } = await client.query<{
      policy_count: string;
      workshop_exclusion_count: string;
    }>(`
      WITH target_policies AS (
        SELECT lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) AS expr
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (
            (tablename = 'van_inspections' AND policyname = 'Managers can update inspections')
            OR (tablename = 'plant_inspections' AND policyname IN (
              'Users can update own plant inspections',
              'Managers can delete draft plant inspections'
            ))
            OR (tablename = 'hgv_inspections' AND policyname IN (
              'Users can update own hgv inspections',
              'Managers can delete draft hgv inspections'
            ))
            OR (tablename = 'inspection_items' AND policyname = 'Managers can manage all items')
            OR (tablename = 'inspection_daily_hours' AND policyname IN (
              'Managers can delete all inspection daily hours',
              'Managers can insert all inspection daily hours',
              'Managers can update all inspection daily hours'
            ))
            OR (tablename = 'inspection_photos' AND policyname = 'Managers can manage all inspection photos')
          )
      )
      SELECT
        COUNT(*)::text AS policy_count,
        COUNT(*) FILTER (WHERE expr LIKE '%effective_is_workshop_team%')::text AS workshop_exclusion_count
      FROM target_policies;
    `);

    const policyCount = Number(rows[0]?.policy_count || '0');
    const workshopExclusionCount = Number(rows[0]?.workshop_exclusion_count || '0');

    if (policyCount !== 10) {
      throw new Error(`Verification failed: expected 10 updated inspection access policies, found ${policyCount}`);
    }

    if (workshopExclusionCount !== 0) {
      throw new Error('Verification failed: workshop-team exclusions still remain in updated inspection draft policies');
    }

    console.log('Workshop manager draft-access policies verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
