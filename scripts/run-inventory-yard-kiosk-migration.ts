import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260714_inventory_yard_kiosk.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory Yard kiosk migration...');

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

    const { rows: yardRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::TEXT AS count
      FROM public.inventory_locations
      WHERE is_active = TRUE
        AND location_type = 'yard'
    `);
    if (Number(yardRows[0]?.count || 0) !== 1) {
      throw new Error('Exactly one active Yard location is required before enabling the kiosk');
    }

    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const [{ rows: tableRows }, { rows: functionRows }, { rows: indexRows }] = await Promise.all([
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'inventory_kiosk_config',
            'inventory_kiosk_transfer_batches'
          )
      `),
      client.query<{ routine_name: string }>(`
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = 'public'
          AND routine_name = 'inventory_kiosk_execute_transfer_basket'
      `),
      client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'inventory_locations_one_active_yard_idx'
      `),
    ]);

    if (tableRows.length !== 2) {
      throw new Error('Inventory Yard kiosk tables were not fully created');
    }
    if (functionRows.length !== 1) {
      throw new Error('Inventory Yard kiosk transfer function was not created');
    }
    if (indexRows.length !== 1) {
      throw new Error('Inventory active Yard uniqueness index was not created');
    }

    console.log('Inventory Yard kiosk migration completed.');
    console.log('The kiosk remains disabled until inventory_kiosk_config is populated.');
  } catch (error) {
    console.error(
      'Inventory Yard kiosk migration failed:',
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
