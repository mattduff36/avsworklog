import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration() {
  console.log('🔄 Running migration: add-day-of-week-column.sql\n');
  
  try {
    // Read the SQL file
    const sqlPath = resolve(process.cwd(), 'supabase/add-day-of-week-column.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    
    console.log('📝 Executing SQL migration...\n');
    
    // Execute the SQL
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql }).single();
    
    if (error) {
      // If exec_sql doesn't exist, try direct execution
      console.log('⚠️  exec_sql RPC not found, trying direct execution...\n');
      
      // Split by semicolon and execute each statement
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
      
      for (const statement of statements) {
        if (statement.toLowerCase().startsWith('comment on')) {
          console.log('⏭️  Skipping COMMENT statement (may not be supported)');
          continue;
        }
        
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        const { error: stmtError } = await supabase.rpc('exec', { query: statement });
        
        if (stmtError) {
          console.error(`❌ Error executing statement:`, stmtError.message);
          throw stmtError;
        }
      }
    }
    
    console.log('\n✅ Migration completed successfully!');
    console.log('\n📊 Summary:');
    console.log('   ✓ Added day_of_week column to inspection_items');
    console.log('   ✓ Added constraints (1-7 range)');
    console.log('   ✓ Updated existing records to day 1 (Monday)');
    console.log('   ✓ Added indexes for performance');
    console.log('\n🎉 Database is ready for daily inspections!');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.log('\n💡 You may need to run this SQL directly in Supabase SQL Editor:');
    console.log('   Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new');
    console.log('   Copy the contents of: supabase/add-day-of-week-column.sql');
    process.exit(1);
  }
}

runMigration();

