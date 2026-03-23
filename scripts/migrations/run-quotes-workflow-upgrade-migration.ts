/**
 * Run Quotes Workflow Upgrade Migration
 *
 * Run with:
 * npx tsx scripts/migrations/run-quotes-workflow-upgrade-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260323_quotes_workflow_upgrade.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Quotes Workflow Upgrade Migration...\n');

  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected!\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    console.log('Executing migration from:', sqlFile);
    console.log('---\n');

    await client.query(migrationSQL);

    console.log('---');
    console.log('MIGRATION COMPLETED SUCCESSFULLY!\n');

    const { rows: counts } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'quote_manager_series') AS manager_series_tables,
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'quote_attachments') AS quote_attachments_tables,
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'quote_invoices') AS quote_invoices_tables,
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'quote_invoice_allocations') AS quote_invoice_allocations_tables
    `);

    console.log('Verification:');
    console.log(`  quote_manager_series: ${counts[0]?.manager_series_tables ? 'ok' : 'missing'}`);
    console.log(`  quote_attachments: ${counts[0]?.quote_attachments_tables ? 'ok' : 'missing'}`);
    console.log(`  quote_invoices: ${counts[0]?.quote_invoices_tables ? 'ok' : 'missing'}`);
    console.log(`  quote_invoice_allocations: ${counts[0]?.quote_invoice_allocations_tables ? 'ok' : 'missing'}`);
    console.log('\nDone!\n');
  } catch (err: unknown) {
    const pgErr = err as { message: string; detail?: string; hint?: string };
    console.error('\nMIGRATION FAILED');
    console.error('Error:', pgErr.message);
    if (pgErr.detail) console.error('Details:', pgErr.detail);
    if (pgErr.hint) console.error('Hint:', pgErr.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
