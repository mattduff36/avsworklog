// @ts-nocheck
/**
 * Check Roles and Users Script
 * 
 * This script verifies:
 * 1. All roles exist in the roles table
 * 2. All users have valid role_id assignments
 * 3. Manager/Admin flags are set correctly
 */

import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

async function checkRolesAndUsers() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING!;
  
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // 1. Check all roles
    console.log('📋 ROLES TABLE:');
    console.log('─'.repeat(80));
    const rolesResult = await client.query(`
      SELECT 
        name,
        display_name,
        is_manager_admin,
        is_super_admin,
        (SELECT COUNT(*) FROM profiles WHERE role_id = roles.id) as user_count
      FROM roles
      ORDER BY display_name;
    `);

    rolesResult.rows.forEach(role => {
      console.log(`  ${role.display_name} (${role.name})`);
      console.log(`    └─ Users: ${role.user_count}`);
      console.log(`    └─ Manager/Admin: ${role.is_manager_admin ? '✓ Yes' : '✗ No'}`);
      console.log(`    └─ Super Admin: ${role.is_super_admin ? '✓ Yes' : '✗ No'}`);
      console.log('');
    });

    // 2. Check users with role assignments
    console.log('\n👥 USER ROLE ASSIGNMENTS:');
    console.log('─'.repeat(80));
    const usersResult = await client.query(`
      SELECT 
        p.id,
        p.full_name,
        p.role_id,
        r.name as role_name,
        r.display_name as role_display_name,
        r.is_manager_admin,
        u.email
      FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      LEFT JOIN auth.users u ON p.id = u.id
      ORDER BY p.full_name
      LIMIT 20;
    `);

    usersResult.rows.forEach(user => {
      const roleStatus = user.role_id 
        ? `✓ ${user.role_display_name}` 
        : '✗ NO ROLE ASSIGNED';
      
      console.log(`  ${user.full_name}`);
      console.log(`    └─ Email: ${user.email}`);
      console.log(`    └─ Role: ${roleStatus}`);
      if (user.role_id) {
        console.log(`    └─ Manager/Admin: ${user.is_manager_admin ? '✓ Yes' : '✗ No'}`);
      }
      console.log('');
    });

    // 3. Check for users WITHOUT role assignments
    console.log('\n⚠️  USERS WITHOUT ROLE ASSIGNMENTS:');
    console.log('─'.repeat(80));
    const noRoleResult = await client.query(`
      SELECT 
        p.id,
        p.full_name,
        u.email
      FROM profiles p
      LEFT JOIN roles r ON p.role_id = r.id
      LEFT JOIN auth.users u ON p.id = u.id
      WHERE p.role_id IS NULL;
    `);

    if (noRoleResult.rows.length === 0) {
      console.log('  ✅ All users have role assignments');
    } else {
      noRoleResult.rows.forEach(user => {
        console.log(`  ❌ ${user.full_name} (${user.email}) - NO ROLE`);
      });
    }

    // 4. Check manager/admin accounts
    console.log('\n\n👔 MANAGER/ADMIN ACCOUNTS:');
    console.log('─'.repeat(80));
    const adminResult = await client.query(`
      SELECT 
        p.full_name,
        r.display_name as role,
        u.email,
        p.super_admin
      FROM profiles p
      JOIN roles r ON p.role_id = r.id
      LEFT JOIN auth.users u ON p.id = u.id
      WHERE r.is_manager_admin = true
      ORDER BY p.full_name;
    `);

    adminResult.rows.forEach(admin => {
      console.log(`  ${admin.full_name} - ${admin.role}`);
      console.log(`    └─ Email: ${admin.email}`);
      console.log(`    └─ Super Admin: ${admin.super_admin ? '✓ Yes' : '✗ No'}`);
      console.log('');
    });

    console.log('\n✅ Check complete');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

checkRolesAndUsers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

