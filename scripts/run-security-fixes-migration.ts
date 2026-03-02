import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260121_fix_supabase_linter_security_findings.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🔒 Running Supabase Linter Security Fixes Migration...\n');

  // Parse connection string with SSL config
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

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing security fixes migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('🔒 Security Fixes Applied:');
    console.log('\n1️⃣  Row Level Security (RLS):');
    console.log('   ✓ Enabled RLS on public.roles table');
    console.log('   ✓ All policies now properly enforced');
    
    console.log('\n2️⃣  Removed Insecure user_metadata References:');
    console.log('   ✓ Replaced auth.jwt()->user_metadata checks in audit_log policies');
    console.log('   ✓ Now using secure DB RBAC (profiles → roles tables)');
    console.log('   ✓ Users cannot fake admin access by editing their metadata');
    
    console.log('\n3️⃣  Tightened INSERT Policies:');
    console.log('   ✓ audit_log: Users can only insert logs for themselves');
    console.log('   ✓ error_logs: Users can only insert error logs for themselves');
    console.log('   ✓ Removed overly permissive WITH CHECK (true) policies');
    
    console.log('\n4️⃣  Hardened Function search_path:');
    console.log('   ✓ Set fixed search_path for 18 functions');
    console.log('   ✓ Prevents search_path hijacking attacks');
    console.log('   ✓ Critical for SECURITY DEFINER functions');
    
    console.log('\n📊 Functions Hardened:');
    console.log('   • Trigger functions (12): sync_vehicle_type_from_category, update_*_updated_at, etc.');
    console.log('   • Permission checks (3): user_has_permission, get_user_permissions, has_maintenance_permission');
    console.log('   • Query functions (3): get_latest_mot_test, get_latest_passed_mot, count_mot_defects_by_type');

    console.log('\n🎯 Next Steps:');
    console.log('   1. Test application functionality (audit logs, error reporting)');
    console.log('   2. Monitor Supabase linter dashboard for confirmation');
    console.log('   3. (Optional) Enable leaked password protection in Supabase Auth settings');
    console.log('   4. (Optional) Add MFA options in Supabase Auth settings\n');

    // Verify RLS is enabled on roles table
    const rlsCheck = await client.query(`
      SELECT 
        schemaname,
        tablename,
        rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public' 
        AND tablename = 'roles';
    `);

    if (rlsCheck.rows.length > 0 && rlsCheck.rows[0].rowsecurity) {
      console.log('✅ VERIFICATION: RLS is enabled on public.roles');
    } else {
      console.warn('⚠️  WARNING: RLS might not be enabled on public.roles - check manually');
    }

    // Count policies
    const policyCount = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (tablename = 'roles' OR tablename = 'audit_log' OR tablename = 'error_logs');
    `);

    console.log(`✅ VERIFICATION: ${policyCount.rows[0].count} RLS policies found for roles/audit_log/error_logs\n`);

  } catch (err: unknown) {
    console.error('\n❌ Migration failed:');
    console.error((err instanceof Error ? err.message : String(err)));
    
    if ((err instanceof Error ? err.message : String(err)).includes('already exists')) {
      console.log('\n💡 TIP: If policies "already exist", this migration may have been partially run.');
      console.log('   Check the Supabase SQL Editor to verify current state.');
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
