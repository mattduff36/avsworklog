import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260407_tune_performance_indexes.sql';

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

    const { rows: indexRows } = await client.query<{ index_count: string }>(`
      SELECT COUNT(*)::text AS index_count
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY (ARRAY[
          'idx_actions_actioned_by',
          'idx_actions_created_by',
          'idx_actions_logged_by',
          'idx_actions_inspection_item_id',
          'idx_absences_approved_by',
          'idx_absences_created_by',
          'idx_absences_processed_by',
          'idx_timesheets_adjusted_by',
          'idx_timesheets_reviewed_by',
          'idx_van_inspections_reviewed_by',
          'idx_rams_assignments_assigned_by',
          'idx_vehicle_maintenance_last_updated_by'
        ]);
    `);

    const indexCount = Number(indexRows[0]?.index_count || '0');
    if (indexCount !== 12) {
      throw new Error(`Verification failed: expected 12 performance indexes, found ${indexCount}`);
    }

    const { rows: duplicateRows } = await client.query<{
      inspection_constraint_count: string;
      quote_dup_index_count: string;
    }>(`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM pg_constraint
          WHERE conrelid = 'public.inspection_items'::regclass
            AND contype = 'u'
            AND conname IN (
              'inspection_items_inspection_id_item_number_day_key',
              'inspection_items_inspection_id_item_number_day_of_week_key'
            )
        ) AS inspection_constraint_count,
        (
          SELECT COUNT(*)::text
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'quote_manager_series'
            AND indexname = 'idx_quote_manager_series_initials'
        ) AS quote_dup_index_count;
    `);

    const inspectionConstraintCount = Number(duplicateRows[0]?.inspection_constraint_count || '0');
    const quoteDupIndexCount = Number(duplicateRows[0]?.quote_dup_index_count || '0');

    if (inspectionConstraintCount !== 1) {
      throw new Error(
        `Verification failed: expected 1 inspection_items unique constraint for the duplicate key set, found ${inspectionConstraintCount}`
      );
    }

    if (quoteDupIndexCount !== 0) {
      throw new Error('Verification failed: duplicate quote manager initials index still exists');
    }

    console.log('Performance index anchors verified.');
    console.log('Duplicate inspection/quote indexes remediated.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
