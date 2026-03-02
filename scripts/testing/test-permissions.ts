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

async function testPermissions() {
  console.log('🔍 Testing RBAC Permissions System...\n');

  try {
    // 1. Get all roles and their permissions
    const { data: roles, error: rolesError } = await supabase
      .from('roles')
      .select(`
        id,
        name,
        display_name,
        is_manager_admin,
        role_permissions(
          module_name,
          enabled
        )
      `)
      .order('name');

    if (rolesError) throw rolesError;

    console.log('📋 ROLES AND THEIR PERMISSIONS:\n');
    
    roles?.forEach(role => {
      console.log(`  ${role.display_name} (${role.name})`);
      console.log(`    Manager/Admin: ${role.is_manager_admin ? 'Yes' : 'No'}`);
      
      interface RolePerm { enabled?: boolean; module_name?: string }
      const rolePerms = (role.role_permissions as RolePerm[] | null) ?? [];
      const enabledPerms = rolePerms.filter(p => p.enabled);
      const disabledPerms = rolePerms.filter(p => !p.enabled);
      
      if (enabledPerms.length > 0) {
        console.log('    ✅ Enabled Modules:', enabledPerms.map(p => p.module_name).join(', '));
      }
      if (disabledPerms.length > 0) {
        console.log('    ❌ Disabled Modules:', disabledPerms.map(p => p.module_name).join(', '));
      }
      console.log('');
    });

    // 2. Check specific modules for employee roles
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 MODULE ACCESS SUMMARY:\n');

    const modules = ['timesheets', 'inspections', 'absence', 'rams', 'approvals', 'actions', 'reports'];
    
    for (const module of modules) {
      const { data: perms, error: permError } = await supabase
        .from('role_permissions')
        .select('role_id, enabled, roles(name, display_name)')
        .eq('module_name', module);

      if (permError) {
        console.error(`  ❌ Error checking ${module}:`, permError.message);
        continue;
      }

      const enabled = perms?.filter(p => p.enabled) || [];
      const disabled = perms?.filter(p => !p.enabled) || [];

      console.log(`  📦 ${module.toUpperCase()}`);
      type PermWithRole = { enabled?: boolean; roles?: { display_name?: string } | { display_name?: string }[] };
      const getDisplayName = (p: PermWithRole) => {
        const r = Array.isArray(p.roles) ? p.roles[0] : p.roles;
        return r?.display_name || 'Unknown';
      };
      console.log(`     ✅ Accessible by: ${enabled.map(getDisplayName).join(', ')}`);
      if (disabled.length > 0) {
        console.log(`     ❌ Blocked for: ${disabled.map(getDisplayName).join(', ')}`);
      }
      console.log('');
    }

    // 3. Test specific scenario: Employee roles and absence module
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔬 SPECIFIC TEST: Absence Module Access\n');

    const { data: absencePerms, error: absError } = await supabase
      .from('role_permissions')
      .select('enabled, roles(name, display_name, is_manager_admin)')
      .eq('module_name', 'absence')
      .order('enabled', { ascending: false });

    if (absError) throw absError;

    type AbsencePerm = { enabled?: boolean; roles?: { display_name?: string; is_manager_admin?: boolean } | { display_name?: string; is_manager_admin?: boolean }[] };
    absencePerms?.forEach((perm: AbsencePerm) => {
      const r = Array.isArray(perm.roles) ? perm.roles[0] : perm.roles;
      const status = perm.enabled ? '✅ HAS ACCESS' : '❌ NO ACCESS';
      const roleType = r?.is_manager_admin ? '[ADMIN/MANAGER]' : '[EMPLOYEE]';
      console.log(`  ${status} ${roleType} ${r?.display_name}`);
    });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ PERMISSION TEST COMPLETE!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('💡 EXPECTED BEHAVIOR:');
    console.log('   - Managers/Admins should see ALL nav links');
    console.log('   - Employees should only see links for enabled modules');
    console.log('   - Direct URL access should redirect if permission denied');
    console.log('   - Absence module should be DISABLED for employee roles\n');

  } catch (error: unknown) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

testPermissions().catch(console.error);

