import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260805_squires_payroll_rename_lorries_display.sql';

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

    const { rows } = await client.query<{ name: string }>(`
      SELECT name
      FROM public.payroll_rule_sets
      WHERE rule_key = 'lorries'
    `);

    if (rows[0]?.name !== 'Transport') {
      throw new Error(`Verification failed: expected Transport, found ${rows[0]?.name || 'missing'}`);
    }

    console.log('Payroll Transport display-name migration applied and verified successfully.');
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
