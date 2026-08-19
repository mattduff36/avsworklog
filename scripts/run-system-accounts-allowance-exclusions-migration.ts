/**
 * Apply live carryover exclusions for system accounts.
 *
 * Usage: npx tsx scripts/run-system-accounts-allowance-exclusions-migration.ts
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const TARGET_PROJECT_REF = 'lrhufzqfzeutgvudcowy';
const sqlFile = 'supabase/migrations/20260819190000_system_accounts_allowance_exclusions.sql';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

if (!connectionString.includes(TARGET_PROJECT_REF)) {
  console.error('Database connection string does not target the approved Supabase project.');
  process.exit(1);
}

async function runMigration() {
  console.log('Running system accounts allowance-exclusions migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'recalculate_financial_year_carryover_for_profile'
    `);
    const definition = rows[0]?.definition || '';
    if (!definition.includes('is_system_account')) {
      throw new Error('Carryover function does not exclude system accounts');
    }
    if (!definition.includes('THEN COALESCE(annual_holiday_allowance_days, 0)')) {
      throw new Error('System-account allowance must not coalesce null to 28');
    }

    const { rows: kioskRows } = await client.query<{ carryover_count: string }>(`
      SELECT COUNT(*)::TEXT AS carryover_count
      FROM public.absence_allowance_carryovers AS carryover
      JOIN public.inventory_kiosk_config AS config
        ON config.kiosk_user_id = carryover.profile_id
      WHERE config.id = 1
    `);
    if (Number.parseInt(kioskRows[0]?.carryover_count || '0', 10) !== 0) {
      throw new Error('Configured kiosk still has leave carryover rows');
    }

    console.log('System accounts allowance-exclusions migration completed and verified.');
  } catch (error) {
    console.error(
      'System accounts allowance-exclusions migration failed:',
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
