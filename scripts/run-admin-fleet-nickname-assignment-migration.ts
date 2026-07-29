import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260729120000_admin_fleet_nickname_assignment.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running admin fleet nickname assignment migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<{
      clear_fn: string | null;
      ensure_fn: string | null;
      apply_fn: string | null;
      van_trigger: string | null;
      hgv_trigger: string | null;
      plant_trigger: string | null;
    }>(`
      SELECT
        to_regprocedure('public.clear_fleet_assignment_for_asset(text,uuid,uuid)')::text AS clear_fn,
        to_regprocedure('public.ensure_fleet_inventory_location(text,uuid,uuid)')::text AS ensure_fn,
        to_regprocedure('public.admin_apply_fleet_asset_nickname_assignment(text,uuid,text,text,uuid,uuid,uuid)')::text AS apply_fn,
        (
          SELECT tgname::text
          FROM pg_trigger
          WHERE tgname = 'trg_clear_fleet_assignment_on_van_inactive'
          LIMIT 1
        ) AS van_trigger,
        (
          SELECT tgname::text
          FROM pg_trigger
          WHERE tgname = 'trg_clear_fleet_assignment_on_hgv_inactive'
          LIMIT 1
        ) AS hgv_trigger,
        (
          SELECT tgname::text
          FROM pg_trigger
          WHERE tgname = 'trg_clear_fleet_assignment_on_plant_inactive'
          LIMIT 1
        ) AS plant_trigger
    `);

    const verification = rows[0];
    if (!verification?.clear_fn || !verification.ensure_fn || !verification.apply_fn) {
      throw new Error('Expected admin nickname assignment RPCs were not created');
    }
    if (!verification.van_trigger || !verification.hgv_trigger || !verification.plant_trigger) {
      throw new Error('Expected retirement clear triggers were not created');
    }

    console.log('Migration completed successfully.');
    console.log('Verified RPCs:', verification.clear_fn, verification.ensure_fn, verification.apply_fn);
    console.log('Verified triggers:', verification.van_trigger, verification.hgv_trigger, verification.plant_trigger);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
