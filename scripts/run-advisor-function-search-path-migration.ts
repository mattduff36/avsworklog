import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260407_fix_remaining_function_search_paths.sql';

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

    const { rows } = await client.query<{ configured_count: string }>(`
      SELECT COUNT(*)::text AS configured_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = ANY (ARRAY[
          'absence_financial_year_start_year',
          'absence_is_closed_financial_year',
          'get_archive_eligible_financial_years',
          'guard_absence_closed_financial_year_mutation',
          'is_absence_financial_year_closed',
          'update_customers_updated_at',
          'update_inspection_daily_hours_updated_at',
          'update_plant_updated_at',
          'update_project_document_types_updated_at',
          'update_quote_invoices_updated_at',
          'update_quote_line_items_updated_at',
          'update_quote_manager_series_updated_at',
          'update_quotes_updated_at',
          'update_workshop_attachment_field_responses_updated_at',
          'update_workshop_attachment_template_versions_updated_at',
          'update_workshop_attachment_templates_updated_at',
          'validate_absence_conflict'
        ])
        AND EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS setting
          WHERE setting = 'search_path=public, pg_temp'
        );
    `);

    const configuredCount = Number(rows[0]?.configured_count || '0');
    if (configuredCount !== 17) {
      throw new Error(`Verification failed: expected 17 hardened functions, found ${configuredCount}`);
    }

    console.log(`Configured search_path for ${configuredCount} functions.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
