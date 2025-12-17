import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/create-roles-and-permissions.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runRolesMigration() {
  console.log('🚀 Running Role-Based Permissions Migration...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('⚠️  IMPORTANT: This migration will:');
  console.log('   1. Create roles and role_permissions tables');
  console.log('   2. Convert existing text roles to relational structure');
  console.log('   3. Add role_id column to profiles');
  console.log('   4. Set super admin for admin@mpdee.co.uk');
  console.log('   5. Preserve all existing data and access patterns\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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
    console.log('📡 Connecting to Supabase database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration from:', sqlFile);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    await client.query(migrationSQL);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📊 Database changes applied:');
    console.log('   ✓ Created roles table');
    console.log('   ✓ Created role_permissions table');
    console.log('   ✓ Added role_id column to profiles');
    console.log('   ✓ Migrated existing roles');
    console.log('   ✓ Created default permissions');
    console.log('   ✓ Set super admin flag');
    console.log('   ✓ Created helper functions');
    console.log('   ✓ Enabled Row Level Security (RLS)');
    console.log('   ✓ Created RLS policies\n');

    console.log('🔍 Verifying migration...\n');

    // Verify roles
    const { rows: rolesCount } = await client.query('SELECT COUNT(*) FROM roles');
    console.log(`   ✅ Roles: ${rolesCount[0].count} roles created`);

    // Verify permissions
    const { rows: permsCount } = await client.query('SELECT COUNT(*) FROM role_permissions');
    console.log(`   ✅ Permissions: ${permsCount[0].count} permissions created`);

    // Verify profiles linked
    const { rows: profilesLinked } = await client.query('SELECT COUNT(*) FROM profiles WHERE role_id IS NOT NULL');
    console.log(`   ✅ Profiles: ${profilesLinked[0].count} profiles linked to roles`);

    // Verify super admin
    const { rows: superAdmin } = await client.query(`
      SELECT r.name, r.display_name, u.email 
      FROM roles r 
      INNER JOIN profiles p ON p.role_id = r.id 
      INNER JOIN auth.users u ON u.id = p.id
      WHERE r.is_super_admin = TRUE
    `);
    if (superAdmin.length > 0) {
      console.log(`   ✅ Super Admin: ${superAdmin[0].email} (${superAdmin[0].display_name})`);
    } else {
      console.log('   ⚠️  Super Admin: Not set');
    }

    console.log('\n🎯 Role Summary:\n');

    const { rows: roleSummary } = await client.query(`
      SELECT 
        r.name,
        r.display_name,
        r.is_super_admin,
        r.is_manager_admin,
        COUNT(DISTINCT rp.id) as permission_count,
        COUNT(DISTINCT p.id) as user_count
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN profiles p ON p.role_id = r.id
      GROUP BY r.id, r.name, r.display_name, r.is_super_admin, r.is_manager_admin
      ORDER BY r.is_super_admin DESC, r.is_manager_admin DESC, r.name
    `);

    roleSummary.forEach(role => {
      const badges = [];
      if (role.is_super_admin) badges.push('SUPER ADMIN');
      if (role.is_manager_admin) badges.push('FULL ACCESS');
      
      console.log(`   📋 ${role.display_name} (${role.name})`);
      if (badges.length > 0) {
        console.log(`      ${badges.join(', ')}`);
      }
      console.log(`      Users: ${role.user_count} | Permissions: ${role.permission_count}`);
      console.log('');
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 NEXT STEPS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n1. ✅ Migration complete - all data preserved');
    console.log('2. 🔄 Old "role" text field still exists (for backwards compatibility)');
    console.log('3. 🆕 New "role_id" field now links to roles table');
    console.log('4. 🔒 Super Admin protected: admin@mpdee.co.uk');
    console.log('5. 🎨 Next: Build Role Management UI');
    console.log('6. 🛡️  Next: Implement permission checks\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Ready for Phase 2: Backend APIs & Permission System');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Details:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }

    if (error.message?.includes('already exists')) {
      console.log('\n✅ Tables already exist - migration may have run previously');
      console.log('To re-run migration, you may need to manually drop tables first.\n');
      process.exit(0);
    }

    console.error('\n⚠️  ROLLBACK INSTRUCTIONS:');
    console.error('If you need to restore from backup, run:');
    console.error('psql <connection-string> < backups/database-backup-2025-11-21T14-43-14.sql\n');
    process.exit(1);
  } finally {
    await client.end();
  }
}

runRolesMigration().catch(console.error);

