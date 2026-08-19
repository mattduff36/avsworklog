import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260819143000_inventory_kiosk_unallocated_take.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory kiosk unallocated take migration...');

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

    const [
      { rows: transferRows },
      { rows: functionRows },
      { rows: grantRows },
    ] = await Promise.all([
      client.query<{ id: string; name: string; location_type: string }>(`
        SELECT id, name, location_type
        FROM public.inventory_locations
        WHERE is_active = TRUE
          AND location_type = 'transfer'
      `),
      client.query<{ routine_name: string }>(`
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = 'public'
          AND routine_name IN (
            'inventory_kiosk_execute_unallocated_take',
            'inventory_allocate_unallocated_kiosk_take',
            'inventory_kiosk_execute_transfer_basket'
          )
      `),
      client.query<{ proname: string; public_execute: boolean; authenticated_execute: boolean }>(`
        SELECT
          p.proname,
          has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'inventory_kiosk_execute_unallocated_take',
            'inventory_allocate_unallocated_kiosk_take'
          )
      `),
    ]);

    if (transferRows.length !== 1 || transferRows[0]?.name !== 'In transfer') {
      throw new Error('Expected exactly one active In transfer location');
    }
    if (functionRows.length !== 3) {
      throw new Error('Expected unallocated take, allocate, and kiosk transfer functions');
    }
    if (grantRows.some((row) => row.public_execute || row.authenticated_execute)) {
      throw new Error('Unallocated take RPCs must be service_role only');
    }

    console.log('Inventory kiosk unallocated take migration verified.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Inventory kiosk unallocated take migration failed:', message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
