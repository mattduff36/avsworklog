import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260804_absence_historic_delete_guard.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running absence historic delete guard migration...\n');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSQL);
    console.log('Migration executed');

    const triggerCheck = await client.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgrelid = 'public.absences'::regclass
        AND NOT tgisinternal
        AND tgname = 'trg_guard_absence_historic_delete';
    `);

    if (triggerCheck.rows.length === 0) {
      throw new Error('Verification failed: trg_guard_absence_historic_delete not found');
    }

    const functionCheck = await client.query(`
      SELECT
        p.proname,
        pg_get_function_identity_arguments(p.oid) AS args,
        pg_get_functiondef(p.oid) AS definition,
        COALESCE(p.proconfig, ARRAY[]::text[]) AS config
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'guard_absence_historic_delete',
          'can_actor_run_absence_global_delete',
          'delete_absences_for_bulk_batch',
          'delete_latest_generated_financial_year_absences'
        )
      ORDER BY p.proname;
    `);

    const expected = new Set([
      'guard_absence_historic_delete',
      'can_actor_run_absence_global_delete',
      'delete_absences_for_bulk_batch',
      'delete_latest_generated_financial_year_absences',
    ]);
    const found = new Set(functionCheck.rows.map((row: { proname: string }) => row.proname));
    for (const name of expected) {
      if (!found.has(name)) {
        throw new Error(`Verification failed: missing function ${name}`);
      }
    }

    const superseded = await client.query(`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'delete_absences_for_financial_year_undo'
    `);
    if (superseded.rows.length > 0) {
      throw new Error('Verification failed: superseded delete_absences_for_financial_year_undo still present');
    }

    for (const row of functionCheck.rows as Array<{
      proname: string;
      args: string;
      definition: string;
      config: string[];
    }>) {
      const searchPathOk = (row.config || []).some((entry) =>
        entry.includes('search_path=public, pg_temp') || entry.includes('search_path="public, pg_temp"')
      );
      if (!searchPathOk) {
        throw new Error(`Verification failed: ${row.proname} missing search_path=public, pg_temp`);
      }

      if (row.proname === 'guard_absence_historic_delete') {
        if (row.definition.includes('OLD.auto_generated')) {
          throw new Error('Verification failed: historic delete guard must not blanket-exempt auto_generated rows');
        }
        if (!row.definition.includes('effective_is_admin()')) {
          throw new Error('Verification failed: historic delete guard must use effective_is_admin()');
        }
      }

      if (row.proname === 'can_actor_run_absence_global_delete') {
        if (!row.definition.includes('view_as_role_id()')) {
          throw new Error('Verification failed: can_actor_run_absence_global_delete must be view-as safe');
        }
        if (!row.definition.includes('see_manage_overview_all')) {
          throw new Error('Verification failed: can_actor_run_absence_global_delete missing overview-all check');
        }
      }

      if (
        row.proname === 'delete_absences_for_bulk_batch' ||
        row.proname === 'delete_latest_generated_financial_year_absences'
      ) {
        if (!row.definition.includes('can_actor_run_absence_global_delete()')) {
          throw new Error(`Verification failed: ${row.proname} missing can_actor_run_absence_global_delete()`);
        }
      }

      if (row.proname === 'delete_latest_generated_financial_year_absences') {
        if (row.definition.includes('p_fy_start') || row.definition.includes('p_fy_end')) {
          throw new Error('Verification failed: year undo must not accept caller-controlled date bounds');
        }
        if (!row.definition.includes('absence_financial_year_generations')) {
          throw new Error('Verification failed: year undo must derive bounds from generation table');
        }
      }
    }

    const closedFyStillPresent = await client.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgrelid = 'public.absences'::regclass
        AND NOT tgisinternal
        AND tgname = 'trg_guard_absence_closed_fy_delete'
    `);
    if (closedFyStillPresent.rows.length === 0) {
      throw new Error('Verification failed: closed FY delete guard missing after migration');
    }

    console.log('Verified trigger:');
    triggerCheck.rows.forEach((row: { tgname: string }) => {
      console.log(`  - ${row.tgname}`);
    });
    console.log('Verified functions:');
    functionCheck.rows.forEach((row: { proname: string; args: string; config: string[] }) => {
      console.log(`  - ${row.proname}(${row.args}) config=${JSON.stringify(row.config)}`);
    });
    console.log('Closed FY delete guard still present');
  } catch (error) {
    console.error('Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
