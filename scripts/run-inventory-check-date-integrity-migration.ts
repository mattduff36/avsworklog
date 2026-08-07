import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260807155000_inventory_check_date_integrity.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory check date integrity migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows: functionRows } = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE specific_schema = 'public'
        AND routine_name = 'inventory_record_check'
    `);

    if (functionRows.length === 0) {
      throw new Error('inventory_record_check function was not created');
    }

    const { rows: columnRows } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'inventory_check_history'
        AND column_name = 'submission_id'
    `);

    if (columnRows.length === 0) {
      throw new Error('inventory_check_history.submission_id was not created');
    }

    const { rows: triggerRows } = await client.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'trg_inventory_check_history_sync_last_checked',
          'trg_inventory_items_last_checked_history_guard',
          'trg_inventory_check_history_append_only_update',
          'trg_inventory_check_history_append_only_delete'
        )
      ORDER BY tgname
    `);

    if (triggerRows.length !== 4) {
      throw new Error(`Expected 4 inventory check integrity triggers, found ${triggerRows.length}`);
    }

    console.log('Inventory check date integrity migration completed.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Inventory check date integrity migration failed:', message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
