import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260806155654_quote_inventory_active_location_stock_guard.sql';

function createClient(): pg.Client {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local');
  }
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });
}

async function main(): Promise<void> {
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', migration: MIGRATION_FILE }, null, 2));
    return;
  }

  const client = createClient();
  await client.connect();
  try {
    await client.query(readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8'));
    const { rows } = await client.query<{ tgname: string }>(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgname IN (
        'trg_inventory_items_require_active_location',
        'trg_inventory_hardware_balances_require_active_location'
      )
      ORDER BY tgname
    `);
    console.log(JSON.stringify({ applied: true, triggers: rows.map((row) => row.tgname) }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
