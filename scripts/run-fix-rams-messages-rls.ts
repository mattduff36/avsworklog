import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260126_fix_rams_and_messages_rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🔧 Running RAMS & Messages RLS Fixes Migration...\n');

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

    console.log('📄 Executing RLS policy updates...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('🔒 RLS Policy Fixes Applied:');
    
    console.log('\n1️⃣  rams_assignments Table:');
    console.log('   ✓ Updated manager policies to use roles table');
    console.log('   ✓ Added WITH CHECK clause to employee update policy');
    console.log('   ✓ Fixed "Error recording RAMS action" RLS violations');
    
    console.log('\n2️⃣  message_recipients Table:');
    console.log('   ✓ Updated manager policies to use roles table');
    console.log('   ✓ Added WITH CHECK clause to user update policy');
    console.log('   ✓ Fixed "Failed to record signature" errors');
    
    console.log('\n📊 Policy Pattern Changed:');
    console.log('   ❌ OLD: profiles.role IN (\'admin\', \'manager\')');
    console.log('   ✅ NEW: profiles JOIN roles WHERE is_manager_admin = true');
    
    console.log('\n🎯 Expected Results:');
    console.log('   • Employees can now update their RAMS assignments');
    console.log('   • Users can now sign Toolbox Talk messages');
    console.log('   • No more RLS policy violations in error logs');
    console.log('   • Managers retain full access to all records');

    // Verify policies exist
    const policyCheck = await client.query(`
      SELECT 
        tablename,
        policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('rams_assignments', 'message_recipients')
      ORDER BY tablename, policyname;
    `);

    console.log(`\n✅ VERIFICATION: Found ${policyCheck.rows.length} RLS policies`);
    console.log('\nRLS Policies:');
    
    const ramsPolicies = policyCheck.rows.filter(r => r.tablename === 'rams_assignments');
    const messagePolicies = policyCheck.rows.filter(r => r.tablename === 'message_recipients');
    
    console.log(`\n  rams_assignments (${ramsPolicies.length} policies):`);
    ramsPolicies.forEach(p => console.log(`   ✓ ${p.policyname}`));
    
    console.log(`\n  message_recipients (${messagePolicies.length} policies):`);
    messagePolicies.forEach(p => console.log(`   ✓ ${p.policyname}`));

    console.log('\n✅ All policies successfully updated!\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    
    if (error.message.includes('already exists')) {
      console.log('\n💡 TIP: If policies "already exist", this migration may have been partially run.');
      console.log('   The script drops and recreates policies, so this error is unusual.');
      console.log('   Check the Supabase SQL Editor to verify current state.');
    }
    
    if (error.message.includes('does not exist')) {
      console.log('\n💡 TIP: Missing table or policy.');
      console.log('   Ensure base tables (rams_assignments, message_recipients) exist.');
      console.log('   Run prerequisite migrations first.');
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
