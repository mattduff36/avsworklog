import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260425_quotes_module_redesign.sql';

if (!connectionString) {
  console.error('Missing database connection string. Set POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local.');
  process.exit(1);
}

async function runMigration(conn: string) {
  const url = new URL(conn);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running quotes module redesign migration...');
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'quotes' AND column_name = 'pricing_mode'
        ) AS quotes_ready,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'rams_documents' AND column_name = 'quote_id'
        ) AS rams_ready,
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'work_calendar_entries'
        ) AS calendar_ready
    `);

    if (!rows[0]?.quotes_ready || !rows[0]?.rams_ready || !rows[0]?.calendar_ready) {
      throw new Error('Migration verification failed.');
    }

    console.log('Quotes module redesign migration complete.');
  } finally {
    await client.end();
  }
}

runMigration(connectionString).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
