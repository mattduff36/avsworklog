/**
 * Migration script to create messages and message_recipients tables
 * Run with: npx tsx scripts/run-messages-migration.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';
import pkg from 'pg';
const { Client } = pkg;

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const postgresUrl = process.env.POSTGRES_URL_NON_POOLING;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!postgresUrl) {
  console.error('❌ Missing POSTGRES_URL_NON_POOLING environment variable');
  console.error('\nPlease add it to your .env.local file');
  console.error('You can find it in: Supabase Dashboard > Project Settings > Database > Connection string (Session mode)\n');
  process.exit(1);
}

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('🚀 Starting messages system migration...\n');

  const client = new Client({
    connectionString: postgresUrl,
  });

  try {
    // Read the SQL file
    const sqlPath = join(process.cwd(), 'supabase', 'create-messages-tables.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log('📖 Read SQL file:', sqlPath);
    console.log('📝 SQL length:', sql.length, 'characters\n');

    // Connect to database
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    // Execute the SQL
    console.log('⚙️  Executing SQL...');
    await client.query(sql);
    console.log('✅ SQL executed successfully\n');

    // Verify tables were created
    console.log('🔍 Verifying tables...');
    
    const { data: messagesData, error: messagesError } = await supabase
      .from('messages')
      .select('count')
      .limit(1);

    const { data: recipientsData, error: recipientsError } = await supabase
      .from('message_recipients')
      .select('count')
      .limit(1);

    if (messagesError?.code === '42P01') {
      console.error('❌ messages table was not created');
      throw messagesError;
    } else {
      console.log('✅ messages table exists');
    }

    if (recipientsError?.code === '42P01') {
      console.error('❌ message_recipients table was not created');
      throw recipientsError;
    } else {
      console.log('✅ message_recipients table exists');
    }

    console.log('\n✨ Migration completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Update your types/database.ts with new table types');
    console.log('2. Create API endpoints in app/api/messages/');
    console.log('3. Build the UI components for messages\n');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Migration failed:', errorMessage);
    
    // Check for "already exists" errors - these are okay
    if (errorMessage.includes('already exists')) {
      console.log('\n⚠️  Some objects already exist - this is usually fine.');
      console.log('The migration may have been partially run before.\n');
      
      // Still verify tables exist
      try {
        const { error: messagesError } = await supabase
          .from('messages')
          .select('count')
          .limit(1);

        const { error: recipientsError } = await supabase
          .from('message_recipients')
          .select('count')
          .limit(1);

        if (!messagesError && !recipientsError) {
          console.log('✅ Tables verified - migration state is good!\n');
          await client.end();
          return;
        }
      } catch {
        // Verification failed - continue to error reporting
      }
    }

    console.error('\nIf the migration failed, you can:');
    console.error('1. Run the SQL directly in Supabase Dashboard > SQL Editor');
    console.error('2. Check the error message above for specific issues\n');
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();

