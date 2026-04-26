import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260426_inventory_module.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString!);

  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function runMigration() {
  const client = createClient();

  try {
    console.log('Running Inventory module migration...');
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<{
      table_name: string;
    }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'inventory_locations',
          'inventory_items',
          'inventory_item_movements',
          'inventory_import_batches',
          'inventory_import_exceptions'
        )
      ORDER BY table_name
    `);

    const createdTables = rows.map((row) => row.table_name);
    if (createdTables.length !== 5) {
      throw new Error(`Inventory migration verification failed. Found tables: ${createdTables.join(', ')}`);
    }

    console.log('Inventory migration completed and verified.');
  } catch (error) {
    console.error('Inventory migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
