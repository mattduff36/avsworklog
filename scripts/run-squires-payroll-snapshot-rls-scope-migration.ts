import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260805_squires_payroll_snapshot_rls_scope.sql';

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

    const { rows } = await client.query<{ policyname: string; qual: string | null }>(`
      SELECT policyname, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'timesheet_payroll_snapshots'
        AND policyname = 'Payroll snapshots scoped read'
    `);

    if (rows.length !== 1) {
      throw new Error('Verification failed: scoped snapshot read policy missing');
    }
    if ((rows[0]?.qual || '').includes('effective_is_manager_admin')) {
      throw new Error('Verification failed: snapshot RLS still grants broad manager read');
    }
    if (!(rows[0]?.qual || '').includes('payroll_is_full_admin')) {
      throw new Error('Verification failed: snapshot RLS missing payroll_is_full_admin gate');
    }

    console.log('Payroll snapshot RLS scope migration applied and verified successfully.');
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
