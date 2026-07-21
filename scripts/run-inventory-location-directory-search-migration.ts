import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260721_inventory_location_directory_search.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory location directory search migration...');

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

    const { rows } = await client.query<{ function_name: string }>(`
      SELECT routine_name AS function_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name = 'inventory_search_locations'
    `);

    if (rows.length !== 1) {
      throw new Error('inventory_search_locations function was not created');
    }

    const { rows: resultRows } = await client.query<{ total_count: string }>(`
      SELECT total_count
      FROM public.inventory_search_locations('', FALSE, 1, 0)
      LIMIT 1
    `);

    if (resultRows.length > 0 && Number.parseInt(resultRows[0].total_count, 10) < 1) {
      throw new Error('inventory_search_locations returned an invalid total count');
    }

    console.log('Inventory location directory search migration completed.');
  } catch (error) {
    console.error(
      'Inventory location directory search migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
