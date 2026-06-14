import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260614_legacy_quote_totals_from_csv_only.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL in .env.local');
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString as string);

  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function runMigration() {
  const client = createClient();

  try {
    console.log('Normalizing legacy quote totals from CSV value column only...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const result = await client.query<{ inferred_total_count: string }>(`
      SELECT COUNT(*)::text AS inferred_total_count
      FROM public.legacy_quotes
      WHERE NULLIF(BTRIM(COALESCE(raw_data ->> 'Quote Value / Total Amount', '')), '') IS NULL
        AND quote_value_text IS NOT NULL
    `);

    if (Number(result.rows[0]?.inferred_total_count || 0) > 0) {
      throw new Error('Verification failed: totals still exist for rows with blank CSV total values');
    }

    console.log('Legacy quote total normalization complete.');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
