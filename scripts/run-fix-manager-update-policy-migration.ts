// @ts-nocheck
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260224_fix_manager_update_policy.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Manager Update Policy Hotfix...\n');

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

    console.log('📄 Replacing deprecated profiles.role pattern with effective_is_manager_admin()...');
    await client.query(migrationSQL);

    console.log('✅ HOTFIX APPLIED!\n');

    console.log('🔍 Verifying...');
    const { rows: policies } = await client.query(`
      SELECT polname, pg_get_expr(polqual, polrelid) AS policy_expr
      FROM pg_policy
      WHERE polrelid = 'vehicle_inspections'::regclass
        AND polname = 'Managers can update inspections'
    `);

    if (policies.length > 0) {
      const expr = policies[0].policy_expr;
      if (expr.includes('effective_is_manager_admin')) {
        console.log('   ✅ Policy uses effective_is_manager_admin() — correct');
      } else if (expr.includes("role IN ('manager'")) {
        console.log('   ❌ Policy STILL uses deprecated profiles.role pattern');
      }
      console.log(`   Expression: ${expr}`);
    } else {
      console.log('   ⚠️ Policy not found');
    }

    console.log('\n✅ All done!');

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
