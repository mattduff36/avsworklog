// @ts-nocheck
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

async function enableLeakedPasswordProtection() {
  console.log('🔐 Attempting to Enable Leaked Password Protection...\n');

  // Check what env vars we have
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!supabaseUrl) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL in .env.local');
    process.exit(1);
  }

  // Extract project ref from URL (e.g., https://xxx.supabase.co -> xxx)
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase/)?.[1];
  
  if (!projectRef) {
    console.error('❌ Could not extract project reference from SUPABASE_URL');
    console.error(`   URL: ${supabaseUrl}`);
    process.exit(1);
  }

  console.log(`📋 Project Reference: ${projectRef}`);
  console.log('');

  // Check if we have a Management API access token
  if (!accessToken) {
    console.log('❌ Cannot enable automatically - Missing SUPABASE_ACCESS_TOKEN\n');
    console.log('📝 Manual Instructions:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/' + projectRef);
    console.log('2. Click: Authentication (left sidebar)');
    console.log('3. Click: Providers tab');
    console.log('4. Find: Email provider');
    console.log('5. Scroll to: "Password Security" section');
    console.log('6. Toggle ON: "Enable Leaked Password Protection"');
    console.log('7. Click: Save\n');
    console.log('✅ That\'s it! Takes about 30 seconds.\n');
    console.log('📌 Direct link: https://supabase.com/dashboard/project/' + projectRef + '/auth/providers');
    return;
  }

  console.log('✅ Found SUPABASE_ACCESS_TOKEN');
  console.log('🔄 Attempting to enable via Management API...\n');

  try {
    // Supabase Management API endpoint
    const apiUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

    // First, get current auth config
    console.log('1️⃣ Fetching current auth configuration...');
    const getResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!getResponse.ok) {
      const errorText = await getResponse.text();
      throw new Error(`Failed to fetch auth config: ${getResponse.status} ${errorText}`);
    }

    const currentConfig = await getResponse.json();
    console.log('   ✅ Current config retrieved');

    // Check if already enabled
    if (currentConfig.PASSWORD_MIN_LENGTH !== undefined) {
      // The API uses password_min_length and leaked_password_protection fields
      console.log('   Current leaked password protection: ' + 
        (currentConfig.SECURITY_LEAKED_PASSWORD_PROTECTION_ENABLED ? 'ENABLED ✅' : 'DISABLED ❌'));
    }

    // Update config to enable leaked password protection
    console.log('\n2️⃣ Enabling leaked password protection...');
    
    const updatePayload = {
      ...currentConfig,
      SECURITY_LEAKED_PASSWORD_PROTECTION_ENABLED: true,
    };

    const updateResponse = await fetch(apiUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Failed to update auth config: ${updateResponse.status} ${errorText}`);
    }

    console.log('   ✅ Successfully enabled!\n');
    console.log('🎉 Leaked Password Protection is now ACTIVE\n');
    console.log('📊 What this means:');
    console.log('   • New signups checked against 800M+ breached passwords');
    console.log('   • Password changes/resets checked');
    console.log('   • Existing users unaffected when logging in');
    console.log('   • No action required from current users\n');

  } catch (error: any) {
    console.error('\n❌ API Error:', error.message);
    console.log('\n📝 Falling back to manual instructions:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/' + projectRef);
    console.log('2. Click: Authentication → Providers → Email');
    console.log('3. Toggle ON: "Enable Leaked Password Protection"');
    console.log('4. Click: Save\n');
    console.log('📌 Direct link: https://supabase.com/dashboard/project/' + projectRef + '/auth/providers\n');
  }
}

enableLeakedPasswordProtection();
