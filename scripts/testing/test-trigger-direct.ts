import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function testTrigger() {
  console.log('🧪 Testing trigger directly...\n');

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

    // Get admin role
    const { rows: roles } = await client.query(`
      SELECT id, name FROM roles WHERE name = 'admin' LIMIT 1
    `);

    if (roles.length === 0) {
      console.error('❌ Admin role not found');
      process.exit(1);
    }

    const adminRole = roles[0];
    console.log(`✅ Found admin role: ${adminRole.name} (${adminRole.id})\n`);

    // Create a test auth user directly
    const testEmail = `test-trigger-${Date.now()}@test.com`;
    const userId = `00000000-0000-0000-0000-${Date.now().toString().slice(-12)}`;

    console.log(`📝 Creating test auth user: ${testEmail}`);

    // Insert into auth.users
    await client.query(`
      INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data,
        is_super_admin,
        role
      ) VALUES (
        $1,
        '00000000-0000-0000-0000-000000000000',
        $2,
        crypt('TestPass123!', gen_salt('bf')),
        now(),
        now(),
        now(),
        '{"provider":"email","providers":["email"]}',
        $3,
        false,
        'authenticated'
      )
    `, [
      userId,
      testEmail,
      JSON.stringify({
        full_name: 'Test User',
        role_id: adminRole.id
      })
    ]);

    console.log('✅ Auth user created\n');

    // Wait a moment for trigger
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if profile was created
    const { rows: profiles } = await client.query(`
      SELECT id, full_name, role_id, role
      FROM profiles
      WHERE id = $1
    `, [userId]);

    if (profiles.length === 0) {
      console.error('❌ Profile was not created by trigger!');
      
      // Check trigger logs
      const { rows: logs } = await client.query(`
        SELECT * FROM pg_stat_user_functions WHERE funcname = 'handle_new_user'
      `);
      console.log('Trigger stats:', logs);
      
      // Clean up
      await client.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
      process.exit(1);
    }

    const profile = profiles[0];
    console.log('✅ Profile created by trigger:');
    console.log(`   ID: ${profile.id}`);
    console.log(`   Name: ${profile.full_name}`);
    console.log(`   Role ID: ${profile.role_id}`);
    console.log(`   Role (deprecated): ${profile.role || 'NULL'}\n`);

    // Verify role_id matches
    if (profile.role_id !== adminRole.id) {
      console.error(`❌ Role ID mismatch! Expected '${adminRole.id}', got '${profile.role_id}'`);
      await client.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
      process.exit(1);
    }

    console.log('✅ All checks passed!\n');

    // Clean up
    console.log('🧹 Cleaning up...');
    await client.query(`DELETE FROM profiles WHERE id = $1`, [userId]);
    await client.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
    console.log('✅ Cleaned up\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ TRIGGER TEST PASSED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: unknown) {
    const err = error as { message?: string; detail?: string; hint?: string };
    console.error('❌ Test failed:', err.message ?? String(error));
    if (err.detail) console.error('Details:', err.detail);
    if (err.hint) console.error('Hint:', err.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
}

testTrigger().catch(console.error);

