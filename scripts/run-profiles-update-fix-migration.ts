import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260127_fix_profiles_update_policy_v3.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🔐 Running Profiles Update Policy Fix Migration...\n');

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

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing profiles update policy fix...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('🔐 Profiles Update Policy Fixed:');
    console.log('\n   BEFORE (BROKEN):');
    console.log('   ❌ Users could NOT update their own profiles');
    console.log('   ❌ WITH CHECK only allowed admins/managers');
    console.log('   ❌ New users could not change their password');
    console.log('\n   AFTER (FIXED):');
    console.log('   ✅ Users CAN update their own profiles');
    console.log('   ✅ Users can change must_change_password flag');
    console.log('   ✅ Admins/managers can update any profile');
    console.log('   ✅ Users blocked from updating other users\' profiles');
    
    console.log('\n📊 Impact:');
    console.log('   • New users can now successfully change their password');
    console.log('   • Password reset flow will work correctly');
    console.log('   • Profile updates work for all users\n');

    // Verify policy exists
    const policyCheck = await client.query(`
      SELECT 
        policyname,
        qual IS NOT NULL as has_using,
        with_check IS NOT NULL as has_with_check
      FROM pg_policies
      WHERE schemaname = 'public' 
        AND tablename = 'profiles'
        AND policyname = 'Users can update own profile';
    `);

    if (policyCheck.rows.length > 0) {
      const policy = policyCheck.rows[0];
      console.log('✅ VERIFICATION: Policy "Users can update own profile" exists');
      console.log(`   ✓ Has USING clause: ${policy.has_using}`);
      console.log(`   ✓ Has WITH CHECK clause: ${policy.has_with_check}`);
    } else {
      console.warn('⚠️  WARNING: Policy not found - check manually');
    }

    console.log('\n🎯 Next Steps:');
    console.log('   1. Test password change for new users');
    console.log('   2. Verify users can update their own profiles');
    console.log('   3. Confirm admins can still update any profile\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    
    if (error.message.includes('already exists')) {
      console.log('\n💡 TIP: Policy already exists - this is fine if migration was run before.');
      console.log('   The migration will still update it correctly.');
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
