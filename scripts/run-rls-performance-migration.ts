import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260121_optimize_rls_performance.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('⚡ Running RLS Performance Optimization Migration...\n');
  console.log('This migration optimizes 121 RLS policies across 33 tables');
  console.log('to evaluate auth functions once per query instead of per row.\n');

  // Parse connection string with SSL config
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

    // Count policies before optimization
    const beforeCount = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          qual LIKE '%auth.uid()%' 
          OR qual LIKE '%auth.jwt()%'
          OR with_check LIKE '%auth.uid()%'
          OR with_check LIKE '%auth.jwt()%'
        );
    `);

    console.log(`📊 Found ${beforeCount.rows[0].count} policies using auth functions\n`);

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing performance optimization migration...\n');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    
    // Verify optimization
    const unoptimizedCount = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          (qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
          OR (qual LIKE '%auth.jwt()%' AND qual NOT LIKE '%(select auth.jwt())%')
          OR (with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
          OR (with_check LIKE '%auth.jwt()%' AND with_check NOT LIKE '%(select auth.jwt())%')
        );
    `);

    console.log('🔍 Post-Migration Verification:');
    if (parseInt(unoptimizedCount.rows[0].count) === 0) {
      console.log('   ✅ All auth functions properly optimized!');
      console.log('   ✅ No unoptimized policies remaining\n');
    } else {
      console.warn(`   ⚠️  ${unoptimizedCount.rows[0].count} policies may need manual review\n`);
    }

    console.log('📈 Performance Impact:');
    console.log('   • Auth functions now evaluated ONCE per query');
    console.log('   • Previously evaluated ONCE PER ROW');
    console.log('   • Expect significant speedup for multi-row queries\n');

    console.log('🎯 Next Steps:');
    console.log('   1. Test application functionality');
    console.log('   2. Monitor query performance improvements');
    console.log('   3. Check Supabase linter dashboard (should clear all warnings)\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    
    if (error.message.includes('already exists')) {
      console.log('\n💡 TIP: If policies "already exist", the migration may have been partially run.');
      console.log('   Check policy definitions manually or restore from backup.');
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
