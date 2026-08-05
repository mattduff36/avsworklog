import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260805_squires_payroll_approved_entry_guard.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  process.exit(1);
}

async function runMigration(): Promise<void> {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log(`Applying migration: ${sqlFile}`);
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf-8'));

    const { rows } = await client.query<{ trigger_name: string }>(`
      SELECT tgname AS trigger_name
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'reject_approved_timesheet_entry_mutation',
          'reject_approved_timesheet_entry_job_code_mutation'
        )
    `);

    if (rows.length !== 2) {
      throw new Error(`Verification failed: expected 2 entry-guard triggers, found ${rows.length}`);
    }

    console.log('Approved entry guard migration applied and verified successfully.');
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Migration failed:', pgError.message || String(error));
    if (pgError.detail) console.error('Details:', pgError.detail);
    if (pgError.hint) console.error('Hint:', pgError.hint);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
