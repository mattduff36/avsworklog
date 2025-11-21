/**
 * Messages Migration - Supabase REST API Method
 * Bypasses SSL certificate issues by using Supabase client
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';

async function runMigration() {
  console.log('🚀 Starting messages system migration (via Supabase REST API)...\n');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing required environment variables:');
    console.error('   NEXT_PUBLIC_SUPABASE_URL');
    console.error('   SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log('📖 Reading SQL file...');
  const sqlFilePath = path.join(__dirname, '../supabase/create-messages-tables.sql');
  const sql = await fs.readFile(sqlFilePath, 'utf8');
  console.log(`✅ SQL loaded (${sql.length} characters)\n`);

  console.log('🔌 Connecting to Supabase...');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('📤 Executing SQL via Supabase REST API...');
    
    // Execute SQL using Supabase's RPC functionality
    // Note: This requires the exec_sql function to exist, or we execute via HTTP
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ sql_query: sql })
    });

    if (!response.ok) {
      // If exec_sql doesn't exist, that's expected
      if (response.status === 404) {
        console.log('\n⚠️  exec_sql function not found (expected)');
        console.log('\n📋 MANUAL MIGRATION REQUIRED:\n');
        console.log('Please run the migration manually in Supabase Dashboard:');
        console.log('1. Open Supabase Dashboard → SQL Editor');
        console.log('2. Copy contents of: supabase/create-messages-tables.sql');
        console.log('3. Paste into SQL Editor');
        console.log('4. Click "Run"\n');
        
        // Still try to verify if tables already exist
        await verifyTables(supabase);
        return;
      }

      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    console.log('✅ SQL executed successfully\n');

    // Verify tables were created
    await verifyTables(supabase);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Migration failed:', errorMessage);
    
    // Check for "already exists" errors
    if (errorMessage.includes('already exists')) {
      console.log('\n⚠️  Some objects already exist - checking if tables are accessible...');
      await verifyTables(supabase);
      return;
    }

    console.log('\n📋 MANUAL MIGRATION REQUIRED:\n');
    console.log('Please run the migration manually in Supabase Dashboard:');
    console.log('1. Open Supabase Dashboard → SQL Editor');
    console.log('2. Copy contents of: supabase/create-messages-tables.sql');
    console.log('3. Paste into SQL Editor');
    console.log('4. Click "Run"\n');
    
    process.exit(1);
  }
}

async function verifyTables(supabase: ReturnType<typeof createClient>) {
  console.log('🔍 Verifying tables...');
  
  try {
    // Check messages table
    const { error: messagesError } = await supabase
      .from('messages')
      .select('count')
      .limit(1);

    if (messagesError) {
      console.log('❌ messages table not accessible:', messagesError.message);
      console.log('\n📋 Please run migration manually (see above)');
      process.exit(1);
    } else {
      console.log('✅ messages table exists and is accessible');
    }

    // Check message_recipients table
    const { error: recipientsError } = await supabase
      .from('message_recipients')
      .select('count')
      .limit(1);

    if (recipientsError) {
      console.log('❌ message_recipients table not accessible:', recipientsError.message);
      console.log('\n📋 Please run migration manually (see above)');
      process.exit(1);
    } else {
      console.log('✅ message_recipients table exists and is accessible');
    }

    console.log('\n✨ Migration verification successful!\n');
    console.log('📋 Next steps:');
    console.log('1. Run automated tests: npx tsx scripts/test-messaging-system.ts');
    console.log('2. Follow manual testing guide in docs/QUICK_TEST_GUIDE.md\n');

  } catch (error) {
    console.error('❌ Verification failed:', error instanceof Error ? error.message : 'Unknown error');
    console.log('\n📋 Please run migration manually in Supabase Dashboard');
    process.exit(1);
  }
}

runMigration().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

