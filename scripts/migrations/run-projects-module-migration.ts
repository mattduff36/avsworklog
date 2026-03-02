/**
 * Run Projects Module Migration
 * Adds project_document_types and project_favourites tables,
 * extends rams_documents with document_type_id, backfills default RAMS type.
 *
 * Run with: npx tsx scripts/migrations/run-projects-module-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/add-project-document-types-and-favourites.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Projects Module Migration...\n');

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
    console.log('  - Created project_document_types table');
    console.log('  - Seeded default RAMS document type');
    console.log('  - Added document_type_id to rams_documents');
    console.log('  - Backfilled existing documents to RAMS type');
    console.log('  - Created project_favourites table');
    console.log('  - Created indexes and RLS policies');
    console.log('  - Created updated_at trigger\n');

    // Verify
    console.log('Verifying...\n');

    const { rows: tables } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('project_document_types', 'project_favourites')
      ORDER BY table_name
    `);

    tables.forEach((table: Record<string, string>) => {
      console.log(`  table: ${table.table_name}`);
    });

    const { rows: col } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'rams_documents'
      AND column_name = 'document_type_id'
    `);

    if (col.length > 0) {
      console.log('  column: rams_documents.document_type_id');
    }

    const { rows: types } = await client.query(`
      SELECT name, required_signature FROM project_document_types ORDER BY sort_order
    `);

    console.log('\n  Seeded document types:');
    types.forEach((t: Record<string, string | boolean>) => {
      console.log(`    - ${t.name} (signature required: ${t.required_signature})`);
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
