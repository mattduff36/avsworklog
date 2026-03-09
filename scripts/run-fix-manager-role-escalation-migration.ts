/**
 * Fix manager privilege-escalation: block creating/assigning roles with
 * is_manager_admin = TRUE from a manager actor.
 *
 * Run with: npx tsx scripts/run-fix-manager-role-escalation-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

const MIGRATION_FILE = 'supabase/migrations/20260309_fix_manager_role_escalation.sql';

async function runMigration() {
  const url = new URL(connectionString!);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const sql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
    console.log('📄 Running fix_manager_role_escalation migration...');
    await client.query(sql);
    console.log('✅ Migration applied!\n');

    console.log('🎉 Manager role-escalation fix complete!\n');
  } catch (err: unknown) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
