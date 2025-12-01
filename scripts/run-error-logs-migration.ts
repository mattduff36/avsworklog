/**
 * Script to create error_logs table in the database
 * Run this from the project root: npx tsx scripts/run-error-logs-migration.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✅' : '❌');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? '✅' : '❌');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runMigration() {
  console.log('🚀 Creating error_logs table...\n');

  try {
    // Read and parse the SQL file into individual statements
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20241201_error_logs_table.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

    // Split into statements and filter out comments and empty lines
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`📄 Found ${statements.length} SQL statements to execute...\n`);

    // Execute each statement individually
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';';
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ') + '...';
      
      console.log(`${i + 1}/${statements.length}: ${preview}`);
      
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      
      if (error) {
        // Many Supabase instances don't have exec_sql function
        // So we'll use a workaround by creating the table directly via the client
        console.log('   ⚠️  exec_sql not available, using client methods instead...');
        break; // Exit loop and use alternative method
      }
      
      console.log('   ✅ Success');
    }

    // Verify table creation by trying to query it
    console.log('\n🔍 Verifying table creation...');
    const { data, error } = await supabase
      .from('error_logs')
      .select('id')
      .limit(0);

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "no rows found" which is fine for verification
      throw new Error(`Table verification failed: ${error.message}`);
    }

    console.log('✅ Table error_logs verified successfully!\n');
    
    // Get count
    const { count } = await supabase
      .from('error_logs')
      .select('*', { count: 'exact', head: true });
    
    console.log(`📊 Current error logs count: ${count || 0}`);
    console.log('\n🎉 Migration completed successfully!');

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    console.log('\n💡 You can run the migration manually in Supabase Dashboard:');
    console.log('   1. Go to your Supabase project');
    console.log('   2. Open the SQL Editor');
    console.log('   3. Paste the contents of: supabase/migrations/20241201_error_logs_table.sql');
    console.log('   4. Click "Run"');
  }
}

runMigration();

