/**
 * Fix error_logs RLS policies to use JWT email instead of auth.users query
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20241201_fix_error_logs_rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Fixing error_logs RLS policies...\n');

  const url = new URL(connectionString);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing RLS policy fixes...');
    await client.query(migrationSQL);

    console.log('✅ RLS POLICIES FIXED!\n');
    
    // Verify policies
    const { rows } = await client.query(`
      SELECT policyname, cmd
      FROM pg_policies
      WHERE tablename = 'error_logs'
      ORDER BY policyname;
    `);

    if (rows.length > 0) {
      console.log('📜 Current RLS policies:');
      rows.forEach(policy => {
        console.log(`   ✓ ${policy.policyname} (${policy.cmd})`);
      });
    }

    console.log('\n🎉 Done! Error logs should now be accessible.');

  } catch (error: any) {
    console.error('❌ FAILED:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

