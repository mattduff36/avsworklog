// @ts-nocheck
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

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function testUserCreation() {
  console.log('🧪 Testing user creation...\n');

  try {
    // Get admin role
    const { data: adminRole, error: roleError } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .eq('name', 'admin')
      .single();

    if (roleError || !adminRole) {
      console.error('❌ Failed to get admin role:', roleError);
      process.exit(1);
    }

    console.log(`✅ Found admin role: ${adminRole.name} (${adminRole.id})\n`);

    // Create test user
    const testEmail = `test-${Date.now()}@test.com`;
    const testPassword = 'TestPass123!';
    const testFullName = 'Test User';

    console.log(`📝 Creating user: ${testEmail}`);

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: {
        full_name: testFullName,
        role_id: adminRole.id,
      },
    });

    if (authError) {
      console.error('❌ Auth error:', authError);
      process.exit(1);
    }

    if (!authData.user) {
      console.error('❌ No user created');
      process.exit(1);
    }

    console.log(`✅ Auth user created: ${authData.user.id}\n`);

    // Wait for trigger
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, role_id, role')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      console.error('❌ Profile error:', profileError);
      // Clean up
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      process.exit(1);
    }

    console.log('✅ Profile created:');
    console.log(`   ID: ${profile.id}`);
    console.log(`   Name: ${profile.full_name}`);
    console.log(`   Role ID: ${profile.role_id}`);
    console.log(`   Role: ${profile.role}\n`);

    // Verify role matches
    if (profile.role !== adminRole.name) {
      console.error(`❌ Role mismatch! Expected '${adminRole.name}', got '${profile.role}'`);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      process.exit(1);
    }

    if (profile.role_id !== adminRole.id) {
      console.error(`❌ Role ID mismatch! Expected '${adminRole.id}', got '${profile.role_id}'`);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      process.exit(1);
    }

    console.log('✅ Role and role_id match correctly!\n');

    // Test API upsert
    console.log('🧪 Testing API upsert...');
    
    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: authData.user.id,
        full_name: 'Updated Test User',
        role_id: adminRole.id,
        role: adminRole.name, // This is what the API should do
      }, {
        onConflict: 'id'
      });

    if (upsertError) {
      console.error('❌ Upsert error:', upsertError);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      process.exit(1);
    }

    console.log('✅ Upsert successful!\n');

    // Clean up
    console.log('🧹 Cleaning up test user...');
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    console.log('✅ Test user deleted\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ ALL TESTS PASSED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testUserCreation().catch(console.error);

