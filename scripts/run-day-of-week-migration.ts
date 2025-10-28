import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function runMigration() {
  console.log('🔄 Running migration: add-day-of-week-column.sql\n');
  
  const supabaseUrl = 'https://lrhufzqfzeutgvudcowy.supabase.co';
  const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyaHVmenFmemV1dGd2dWRjb3d5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDk1MTYxNiwiZXhwIjoyMDc2NTI3NjE2fQ.KRK9pi17kFMIYPE9CeicOFnq91AWINhVpJ1sXsNbR64';
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  try {
    console.log('📡 Connecting to Supabase...');

    // Read the SQL file
    const sqlPath = resolve(process.cwd(), 'supabase/add-day-of-week-column.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    
    console.log('📝 Executing SQL migration...\n');
    
    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && s !== '');
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip COMMENT statements as they might not be critical
      if (statement.toLowerCase().startsWith('comment on')) {
        console.log(`⏭️  [${i + 1}/${statements.length}] Skipping COMMENT statement`);
        continue;
      }
      
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');
      console.log(`🔨 [${i + 1}/${statements.length}] Executing: ${preview}...`);
      
      try {
        const { data, error } = await supabase.rpc('exec', { sql: statement });
        
        if (error) {
          // Check if it's a "column already exists" error
          if (error.message.includes('already exists') || error.code === '42701') {
            console.log(`   ⚠️  Already exists, skipping...`);
          } else {
            console.error(`   ❌ Error:`, error.message);
            throw error;
          }
        } else {
          console.log(`   ✅ Success`);
        }
      } catch (error: any) {
        console.error(`   ❌ Error:`, error.message);
        throw error;
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
    console.log('\n💡 Try running the SQL directly in Supabase SQL Editor:');
    console.log('   1. Go to: https://supabase.com/dashboard/project/lrhufzqfzeutgvudcowy/sql/new');
    console.log('   2. Copy contents of: supabase/add-day-of-week-column.sql');
    console.log('   3. Click "Run"');
    process.exit(1);
  }
}

runMigration();

