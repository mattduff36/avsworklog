import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260715_inventory_kiosk_device_pairing.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory Yard kiosk device pairing migration...');

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

    const [{ rows: tableRows }, { rows: sessionColumnRows }, { rows: constraintRows }] =
      await Promise.all([
        client.query<{ table_name: string }>(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'inventory_kiosk_pairing_sessions',
              'inventory_kiosk_devices'
            )
        `),
        client.query<{ column_name: string }>(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'app_auth_sessions'
            AND column_name = 'kiosk_device_id'
        `),
        client.query<{ definition: string }>(`
          SELECT pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid = 'public.app_auth_sessions'::regclass
            AND conname = 'check__app_auth_sessions__session_source'
        `),
      ]);

    if (tableRows.length !== 2) {
      throw new Error('Inventory Yard kiosk pairing tables were not fully created');
    }
    if (sessionColumnRows.length !== 1) {
      throw new Error('app_auth_sessions.kiosk_device_id was not created');
    }
    if (!constraintRows[0]?.definition.includes('kiosk_device')) {
      throw new Error('The kiosk_device app session source was not enabled');
    }

    console.log('Inventory Yard kiosk device pairing migration completed.');
  } catch (error) {
    console.error(
      'Inventory Yard kiosk device pairing migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
