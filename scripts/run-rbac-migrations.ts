/**
 * Run RBAC migrations: expand_management_modules + manager_module_permissions_and_hierarchy
 * Run with: npx tsx scripts/run-rbac-migrations.ts
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

const migrations = [
  'supabase/migrations/20260309_expand_management_modules.sql',
  'supabase/migrations/20260309_manager_module_permissions_and_hierarchy.sql',
];

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

    for (const file of migrations) {
      const name = file.split('/').pop();
      console.log(`📄 Running ${name}...`);
      const sql = readFileSync(resolve(process.cwd(), file), 'utf-8');
      await client.query(sql);
      console.log(`✅ ${name} done\n`);
    }

    console.log('🎉 RBAC migrations complete!\n');
  } catch (err: unknown) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
