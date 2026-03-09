/**
 * Run Customers & Quotes Module Migration
 * Creates customers, quotes, quote_line_items, and quote_sequences tables.
 * Seeds 5 placeholder customers.
 *
 * Run with: npx tsx scripts/migrations/run-customers-quotes-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260309_customers_quotes_module.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Customers & Quotes Module Migration...\n');

  const url = new URL(connectionString as string);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
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

    console.log('Database changes applied:');
    console.log('  - Created customers table');
    console.log('  - Created quote_sequences table');
    console.log('  - Created quotes table');
    console.log('  - Created quote_line_items table');
    console.log('  - Created indexes and RLS policies');
    console.log('  - Created updated_at triggers');
    console.log('  - Seeded 5 placeholder customers\n');

    // Verify tables
    console.log('Verifying...\n');

    const { rows: tables } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('customers', 'quotes', 'quote_line_items', 'quote_sequences')
      ORDER BY table_name
    `);

    tables.forEach((table: Record<string, string>) => {
      console.log(`  table: ${table.table_name}`);
    });

    const { rows: customers } = await client.query(`
      SELECT company_name FROM customers ORDER BY company_name
    `);

    console.log(`\n  Seeded customers (${customers.length}):`);
    customers.forEach((c: Record<string, string>) => {
      console.log(`    - ${c.company_name}`);
    });

    console.log('\nDone!\n');
  } catch (err: unknown) {
    const pgErr = err as { message: string; detail?: string; hint?: string };
    console.error('\nMIGRATION FAILED');
    console.error('Error:', pgErr.message);
    if (pgErr.detail) console.error('Details:', pgErr.detail);
    if (pgErr.hint) console.error('Hint:', pgErr.hint);

    if (pgErr.message?.includes('already exists')) {
      console.log('\nTables already exist - no action needed!');
      process.exit(0);
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
