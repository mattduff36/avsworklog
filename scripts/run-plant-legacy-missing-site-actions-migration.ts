import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const sqlFile = 'supabase/migrations/20260817_plant_legacy_missing_site_actions.sql';

function getConnectionString(): string {
  const value = process.env.POSTGRES_URL_NON_POOLING;
  if (!value) {
    throw new Error('Missing POSTGRES_URL_NON_POOLING in .env.local');
  }
  return value;
}

const connectionString = getConnectionString();

async function runMigration() {
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSQL);

    const { rows: columns } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'reminder_actions'
        AND column_name = 'due_at'
    `);
    if (columns.length !== 1) {
      throw new Error('reminder_actions.due_at was not created');
    }

    const { rows: functions } = await client.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname IN (
          'apply_plant_inspection_job_fields',
          'apply_allocation_job_fields',
          'ensure_plant_legacy_missing_site_action',
          'guard_plant_inspection_job_fields'
        )
      ORDER BY p.proname, args
    `);

    const signatures = functions.map((row) => `${row.proname}(${row.args})`);
    if (!signatures.includes('apply_plant_inspection_job_fields(p_source_type text, p_source_id uuid, p_job_code text, p_require_valid boolean)')) {
      throw new Error('apply_plant_inspection_job_fields signature missing');
    }
    if (!signatures.includes('apply_allocation_job_fields(p_source_type text, p_source_id uuid, p_job_code text, p_require_valid boolean)')) {
      throw new Error('apply_allocation_job_fields signature changed');
    }
    if (signatures.filter((signature) => signature.startsWith('apply_allocation_job_fields(')).length !== 1) {
      throw new Error('apply_allocation_job_fields was overloaded');
    }
    if (!signatures.includes('ensure_plant_legacy_missing_site_action()')) {
      throw new Error('ensure_plant_legacy_missing_site_action missing');
    }
    if (!signatures.includes('guard_plant_inspection_job_fields()')) {
      throw new Error('guard_plant_inspection_job_fields missing');
    }

    const { rows: triggers } = await client.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgrelid = 'public.plant_inspections'::regclass
        AND tgname = 'plant_inspections_legacy_missing_site_action'
        AND NOT tgisinternal
    `);
    if (triggers.length !== 1) {
      throw new Error('plant_inspections_legacy_missing_site_action trigger missing');
    }

    console.log('Plant legacy missing-site actions migration completed.');
  } catch (error) {
    console.error(
      'Plant legacy missing-site actions migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
