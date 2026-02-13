import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });
const cs = process.env.POSTGRES_URL_NON_POOLING!;
const url = new URL(cs);

const ALL_MODULES = [
  'timesheets', 'inspections', 'plant-inspections', 'rams', 'absence',
  'maintenance', 'toolbox-talks', 'workshop-tasks', 'approvals',
  'actions', 'reports', 'admin-users', 'admin-vehicles',
];

async function run() {
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 1. Get all roles
  const { rows: roles } = await client.query(`
    SELECT id, name, display_name, is_manager_admin, is_super_admin
    FROM roles
    ORDER BY is_super_admin DESC, is_manager_admin DESC, name
  `);

  console.log('=== ALL ROLES ===');
  for (const role of roles) {
    console.log(`  ${role.display_name} (${role.name}) | manager_admin: ${role.is_manager_admin} | super_admin: ${role.is_super_admin}`);
  }

  // 2. Get all permissions
  const { rows: allPerms } = await client.query(`
    SELECT rp.role_id, r.name as role_name, r.display_name, r.is_manager_admin,
           rp.module_name, rp.enabled
    FROM role_permissions rp
    JOIN roles r ON rp.role_id = r.id
    ORDER BY r.name, rp.module_name
  `);

  console.log('\n=== PERMISSIONS BY ROLE ===');
  const permsByRole: Record<string, any[]> = {};
  for (const p of allPerms) {
    if (!permsByRole[p.role_name]) permsByRole[p.role_name] = [];
    permsByRole[p.role_name].push(p);
  }

  for (const role of roles) {
    const perms = permsByRole[role.name] || [];
    const enabledModules = perms.filter(p => p.enabled).map(p => p.module_name);
    const disabledModules = perms.filter(p => !p.enabled).map(p => p.module_name);
    const missingModules = ALL_MODULES.filter(m => !perms.find(p => p.module_name === m));

    console.log(`\n  ${role.display_name} (${role.name})${role.is_manager_admin ? ' [MANAGER/ADMIN - all access]' : ''}`);
    if (role.is_manager_admin) {
      console.log(`    → Manager/admin roles have ALL permissions regardless of role_permissions rows`);
    }
    console.log(`    Enabled  (${enabledModules.length}): ${enabledModules.join(', ') || '(none)'}`);
    console.log(`    Disabled (${disabledModules.length}): ${disabledModules.join(', ') || '(none)'}`);
    if (missingModules.length > 0) {
      console.log(`    MISSING  (${missingModules.length}): ${missingModules.join(', ')}`);
      console.log(`    ⚠️  Missing modules have NO row in role_permissions — app may treat as denied!`);
    }
  }

  // 3. Count users per role
  console.log('\n=== USERS PER ROLE ===');
  const { rows: userCounts } = await client.query(`
    SELECT r.name, r.display_name, r.is_manager_admin, COUNT(p.id) as user_count
    FROM roles r
    LEFT JOIN profiles p ON p.role_id = r.id
    GROUP BY r.id, r.name, r.display_name, r.is_manager_admin
    ORDER BY r.name
  `);
  for (const uc of userCounts) {
    console.log(`  ${uc.display_name}: ${uc.user_count} users${uc.is_manager_admin ? ' (manager/admin)' : ''}`);
  }

  // 4. Check for users who might be affected
  console.log('\n=== POTENTIAL ISSUES ===');
  for (const role of roles) {
    if (role.is_manager_admin) continue; // Managers have all access

    const perms = permsByRole[role.name] || [];
    const missingModules = ALL_MODULES.filter(m => !perms.find((p: any) => p.module_name === m));

    if (missingModules.length > 0) {
      const { rows: users } = await client.query(
        `SELECT full_name FROM profiles WHERE role_id = $1 ORDER BY full_name`,
        [role.id]
      );
      if (users.length > 0) {
        console.log(`\n  ⚠️  Role "${role.display_name}" has ${missingModules.length} MISSING permission rows`);
        console.log(`     Missing: ${missingModules.join(', ')}`);
        console.log(`     Affected users (${users.length}): ${users.map(u => u.full_name).join(', ')}`);
      }
    }
  }

  await client.end();
  console.log('\nDone');
}

run().catch(e => { console.error(e.message); process.exit(1); });
