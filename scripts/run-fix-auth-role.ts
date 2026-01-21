import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260122_fix_auth_role_optimization.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('🔧 Fixing auth.role() Optimization...\n');

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
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    await client.query(migrationSQL);

    console.log('✅ Migration completed!\n');
    
    // Verify the specific policy
    const result = await client.query(`
      SELECT policyname, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
        AND policyname = 'Authenticated users can view all profiles';
    `);

    if (result.rows.length > 0) {
      const policy = result.rows[0];
      console.log('📊 Updated Policy:');
      console.log(`   Name: ${policy.policyname}`);
      console.log(`   USING: ${policy.qual}`);
      
      if (policy.qual.includes('select auth.role()')) {
        console.log('   ✅ Policy properly optimized with (select auth.role())');
      }
    }

    console.log('\n🎯 Expected Result:');
    console.log('   The Supabase linter warning for "auth_rls_initplan"');
    console.log('   on the profiles table should now be cleared.');

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

runMigration();
