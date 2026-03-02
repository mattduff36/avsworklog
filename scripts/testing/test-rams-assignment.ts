import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testRAMSAssignment() {
  console.log('🧪 Testing RAMS assignment query...\n');

  try {
    // Test the exact query used in AssignEmployeesModal
    // Join: profiles -> roles -> role_permissions
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        role_id,
        roles!inner(
          id,
          name,
          display_name,
          is_manager_admin,
          role_permissions!inner(
            role_id,
            module_name,
            enabled
          )
        )
      `)
      .eq('roles.role_permissions.module_name', 'rams')
      .eq('roles.role_permissions.enabled', true)
      .order('full_name');

    if (profilesError) {
      console.error('❌ Query error:', profilesError);
      process.exit(1);
    }

    console.log(`✅ Query successful! Found ${profiles?.length || 0} employees with RAMS permission\n`);

    if (profiles && profiles.length > 0) {
      console.log('📋 Employees with RAMS access:');
      profiles.forEach((profile: { full_name?: string; roles?: { display_name?: string } | { display_name?: string }[]; role_id?: string }) => {
        console.log(`   - ${profile.full_name}`);
        const r = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
        console.log(`     Role: ${r?.display_name || 'No Role'}`);
        console.log(`     Role ID: ${profile.role_id}`);
        console.log('');
      });
    } else {
      console.log('⚠️  No employees found with RAMS permission');
      console.log('   This could be normal if no roles have RAMS enabled\n');
    }

    // Check role_permissions table
    const { data: permissions, error: permError } = await supabase
      .from('role_permissions')
      .select('*, roles(name, display_name)')
      .eq('module_name', 'rams')
      .eq('enabled', true);

    if (permError) {
      console.error('❌ Permissions query error:', permError);
    } else {
      console.log(`✅ Found ${permissions?.length || 0} role(s) with RAMS permission enabled:`);
      permissions?.forEach((perm: { roles?: { display_name?: string; name?: string } }) => {
        console.log(`   - ${perm.roles?.display_name || 'Unknown'} (${perm.roles?.name})`);
      });
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ RAMS ASSIGNMENT TEST PASSED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: unknown) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

testRAMSAssignment().catch(console.error);

