import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260228_fix_vehicle_inspection_update_with_check.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Van Inspection Update RLS Fix...\n');
  console.log('This adds WITH CHECK clauses to allow status transitions from draft → submitted.\n');

  const url = new URL(connectionString!);

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

    console.log('📄 Applying RLS policy update...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied!\n');

    console.log('🔍 Verifying policies...');
    const { rows: policies } = await client.query(`
      SELECT polname,
             pg_get_expr(polqual, polrelid) AS using_expr,
             pg_get_expr(polwithcheck, polrelid) AS with_check_expr
      FROM pg_policy
      WHERE polrelid = 'van_inspections'::regclass
        AND polname IN ('Employees can update own inspections', 'Managers can update inspections')
      ORDER BY polname
    `);

    for (const policy of policies) {
      console.log(`\n   Policy: "${policy.polname}"`);
      console.log(`   USING:      ${policy.using_expr}`);
      console.log(`   WITH CHECK: ${policy.with_check_expr}`);

      if (policy.with_check_expr && policy.with_check_expr.includes('submitted')) {
        console.log('   ✅ WITH CHECK allows submitted status');
      } else {
        console.log('   ⚠️  WITH CHECK may not allow submitted status');
      }
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
