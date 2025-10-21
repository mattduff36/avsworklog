import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const TEST_USERS = [
  {
    email: 'admin@avsworklog.test',
    password: 'TestPass123!',
    full_name: 'Admin User',
    employee_id: 'ADM001',
    role: 'admin'
  },
  {
    email: 'manager@avsworklog.test',
    password: 'TestPass123!',
    full_name: 'Manager User',
    employee_id: 'MGR001',
    role: 'manager'
  },
  {
    email: 'employee@avsworklog.test',
    password: 'TestPass123!',
    full_name: 'Employee User',
    employee_id: 'EMP001',
    role: 'employee'
  }
];

const TEST_VEHICLES = [
  { reg_number: 'YX65ABC', vehicle_type: 'truck', status: 'active' },
  { reg_number: 'AB12CDE', vehicle_type: 'artic', status: 'active' },
  { reg_number: 'CD34EFG', vehicle_type: 'trailer', status: 'active' }
];

async function createTestUsers() {
  console.log('🚀 Creating test users and data...\n');

  // Create users
  for (const user of TEST_USERS) {
    console.log(`📝 Creating ${user.role}: ${user.email}`);
    
    try {
      // Create the auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: {
          full_name: user.full_name,
          employee_id: user.employee_id
        }
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          console.log(`   ℹ️  User already exists, updating profile...`);
          
          // Get the existing user ID
          const { data: existingUser } = await supabase.auth.admin.listUsers();
          const foundUser = existingUser?.users.find(u => u.email === user.email);
          
          if (foundUser) {
            // Update the profile role
            const { error: updateError } = await supabase
              .from('profiles')
              .update({ role: user.role, full_name: user.full_name, employee_id: user.employee_id })
              .eq('id', foundUser.id);
              
            if (updateError) {
              console.error(`   ❌ Error updating profile:`, updateError.message);
            } else {
              console.log(`   ✅ Profile updated successfully`);
            }
          }
        } else {
          throw authError;
        }
      } else if (authData.user) {
        // Update the profile with the correct role
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for trigger
        
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ role: user.role })
          .eq('id', authData.user.id);
          
        if (updateError) {
          console.error(`   ❌ Error updating profile role:`, updateError.message);
        } else {
          console.log(`   ✅ User created successfully with ${user.role} role`);
        }
      }
    } catch (error) {
      console.error(`   ❌ Error creating user:`, error);
    }
  }

  console.log('\n🚗 Creating test vehicles...\n');

  // Create vehicles
  for (const vehicle of TEST_VEHICLES) {
    console.log(`📝 Creating vehicle: ${vehicle.reg_number}`);
    
    const { error } = await supabase
      .from('vehicles')
      .upsert(vehicle, { onConflict: 'reg_number' });
      
    if (error) {
      console.error(`   ❌ Error:`, error.message);
    } else {
      console.log(`   ✅ Vehicle created/updated successfully`);
    }
  }

  console.log('\n📊 Test Data Summary:\n');
  console.log('┌─────────────────────────────────────────────────┐');
  console.log('│ TEST CREDENTIALS                                │');
  console.log('├─────────────────────────────────────────────────┤');
  console.log('│                                                 │');
  console.log('│ 👨‍💼 ADMIN USER                                   │');
  console.log('│   Email:    admin@avsworklog.test               │');
  console.log('│   Password: TestPass123!                        │');
  console.log('│   Access:   Full system access                  │');
  console.log('│                                                 │');
  console.log('│ 👔 MANAGER USER                                 │');
  console.log('│   Email:    manager@avsworklog.test             │');
  console.log('│   Password: TestPass123!                        │');
  console.log('│   Access:   View all, approve forms             │');
  console.log('│                                                 │');
  console.log('│ 👷 EMPLOYEE USER                                │');
  console.log('│   Email:    employee@avsworklog.test            │');
  console.log('│   Password: TestPass123!                        │');
  console.log('│   Access:   Own forms only                      │');
  console.log('│                                                 │');
  console.log('└─────────────────────────────────────────────────┘');
  console.log('\n✅ Test setup complete!\n');
}

createTestUsers().catch(console.error);

