import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260720_inventory_kiosk_remote_recovery.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory Yard kiosk remote recovery migration...');

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

    const [{ rows: columnRows }, { rows: tableRows }] = await Promise.all([
      client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inventory_kiosk_devices'
          AND column_name IN (
            'last_heartbeat_at',
            'last_phase',
            'last_error_code',
            'diagnostics'
          )
      `),
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'inventory_kiosk_device_commands',
            'inventory_kiosk_device_events'
          )
      `),
    ]);

    if (columnRows.length !== 4) {
      throw new Error('inventory_kiosk_devices heartbeat columns were not fully created');
    }
    if (tableRows.length !== 2) {
      throw new Error('Yard kiosk remote recovery tables were not fully created');
    }

    console.log('Inventory Yard kiosk remote recovery migration completed.');
  } catch (error) {
    console.error(
      'Inventory Yard kiosk remote recovery migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
