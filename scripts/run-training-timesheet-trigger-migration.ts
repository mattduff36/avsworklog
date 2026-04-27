import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260427_exclude_training_from_timesheet_absence_coercion.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log(`Applying migration: ${sqlFile}`);
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<{ function_body: string }>(`
      SELECT pg_get_functiondef('public.enforce_timesheet_entry_absence_rules()'::regprocedure) AS function_body;
    `);

    const functionBody = rows[0]?.function_body || '';
    if (!functionBody.toLowerCase().includes("<> 'training'")) {
      throw new Error('Verification failed: Training exclusion is missing from timesheet absence trigger');
    }

    console.log('Migration applied and verified successfully.');
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Migration failed:', pgError.message || String(error));
    if (pgError.detail) {
      console.error('Details:', pgError.detail);
    }
    if (pgError.hint) {
      console.error('Hint:', pgError.hint);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
