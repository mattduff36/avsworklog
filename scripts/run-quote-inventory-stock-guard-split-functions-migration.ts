import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260806160234_quote_inventory_stock_guard_split_functions.sql';

async function main(): Promise<void> {
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', migration: MIGRATION_FILE }, null, 2));
    return;
  }
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local');
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8'));
    console.log(JSON.stringify({ applied: true, migration: MIGRATION_FILE }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
