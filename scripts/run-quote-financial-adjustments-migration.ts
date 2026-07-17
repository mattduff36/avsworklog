import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260717_quote_financial_adjustments.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

async function runMigration() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running quote financial adjustments migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf-8'));

    const [tableResult, triggerResult, policyResult] = await Promise.all([
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'quote_financial_adjustments'
      `),
      client.query<{ trigger_name: string }>(`
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE event_object_schema = 'public'
          AND event_object_table = 'quote_financial_adjustments'
          AND trigger_name = 'enforce_quote_financial_adjustment_append_only'
      `),
      client.query<{ policyname: string }>(`
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'quote_financial_adjustments'
          AND policyname = 'quote_financial_adjustments_select'
      `),
    ]);

    if (tableResult.rowCount !== 1) {
      throw new Error('quote_financial_adjustments table was not created');
    }
    if ((triggerResult.rowCount || 0) < 1) {
      throw new Error('append-only trigger was not created');
    }
    if (policyResult.rowCount !== 1) {
      throw new Error('read policy was not created');
    }

    console.log('Quote financial adjustments migration completed.');
  } catch (error) {
    console.error(
      'Quote financial adjustments migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
