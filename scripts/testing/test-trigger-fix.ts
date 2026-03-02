import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function testTrigger() {
  console.log('🔍 Testing trigger function...\n');

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
    await client.connect();
    console.log('✅ Connected!\n');

    // Check current trigger function
    const { rows: funcRows } = await client.query(`
      SELECT pg_get_functiondef(oid) as definition
      FROM pg_proc
      WHERE proname = 'handle_new_user'
    `);

    if (funcRows.length > 0) {
      console.log('📄 Current trigger function:');
      console.log(funcRows[0].definition);
      console.log('\n');
    }

    // Check what roles exist
    const { rows: roles } = await client.query(`
      SELECT id, name, display_name
      FROM roles
      ORDER BY name
    `);

    console.log('📋 Available roles:');
    roles.forEach((role: { id?: string; name?: string; display_name?: string }) => {
      console.log(`   - ${role.name} (${role.display_name}): ${role.id}`);
    });
    console.log('\n');

    // Check the admin role specifically
    const { rows: adminRole } = await client.query(`
      SELECT id, name, display_name
      FROM roles
      WHERE name = 'admin'
      LIMIT 1
    `);

    if (adminRole.length > 0) {
      console.log('✅ Admin role found:');
      console.log(`   ID: ${adminRole[0].id}`);
      console.log(`   Name: ${adminRole[0].name}`);
      console.log(`   Display: ${adminRole[0].display_name}`);
      console.log('\n');

      // Test the trigger logic manually
      console.log('🧪 Testing trigger logic...');
      const testRoleId = adminRole[0].id;
      
      const { rows: roleName } = await client.query(`
        SELECT name
        FROM roles
        WHERE id = $1
      `, [testRoleId]);

      if (roleName.length > 0) {
        console.log(`✅ Role lookup works: role_id ${testRoleId} -> name '${roleName[0].name}'`);
      } else {
        console.log(`❌ Role lookup failed for ${testRoleId}`);
      }
    } else {
      console.log('❌ Admin role not found!');
    }

    // Check CHECK constraint
    const { rows: constraints } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'profiles'::regclass
      AND conname = 'profiles_role_check'
    `);

    if (constraints.length > 0) {
      console.log('\n📋 CHECK constraint:');
      console.log(`   ${constraints[0].definition}`);
    }

  } catch (error: unknown) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

testTrigger().catch(console.error);

