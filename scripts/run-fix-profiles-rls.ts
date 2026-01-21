import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260122_fix_profiles_rls_optimization.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('🔧 Fixing Profiles RLS Optimization...\n');
  console.log('This migration cleans up double-wrapped SELECT statements');
  console.log('in the profiles table RLS policies.\n');

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

    // Show current state
    const before = await client.query(`
      SELECT policyname, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
      ORDER BY policyname;
    `);

    console.log('📊 Current profiles policies:');
    before.rows.forEach(row => {
      console.log(`   • ${row.policyname}`);
    });
    console.log('');

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...\n');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    
    // Verify
    const after = await client.query(`
      SELECT 
        policyname,
        CASE 
          WHEN qual LIKE '%(select auth.uid())%' THEN 'OPTIMIZED ✓'
          WHEN qual LIKE '%auth.uid()%' THEN 'UNOPTIMIZED ✗'
          ELSE 'NO AUTH CALL'
        END as status
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
      ORDER BY policyname;
    `);

    console.log('🔍 Post-Migration Verification:');
    after.rows.forEach(row => {
      console.log(`   ${row.status === 'OPTIMIZED ✓' ? '✅' : row.status === 'NO AUTH CALL' ? 'ℹ️ ' : '❌'} ${row.policyname}: ${row.status}`);
    });
    console.log('');

    console.log('📈 Expected Impact:');
    console.log('   • Supabase linter warnings for profiles table should clear');
    console.log('   • Auth function evaluated once per query vs once per row');
    console.log('   • Improved query performance for multi-row results\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    
    if (error.message.includes('already exists')) {
      console.log('\n💡 Policy may already exist in the desired state');
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
