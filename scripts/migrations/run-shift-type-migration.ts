import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function runMigration() {
  try {
    console.log('🚀 Running shift type columns migration...');
    console.log('');
    
    // Read the SQL file
    const sqlPath = path.join(process.cwd(), 'supabase', 'add-shift-type-columns.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('📋 SQL to execute:');
    console.log('─'.repeat(60));
    console.log(sql);
    console.log('─'.repeat(60));
    console.log('');
    
    console.log('⚠️  Note: This migration needs to be run manually in Supabase SQL Editor');
    console.log('');
    console.log('Instructions:');
    console.log('1. Go to your Supabase project dashboard');
    console.log('2. Navigate to SQL Editor');
    console.log('3. Copy and paste the SQL shown above');
    console.log('4. Click "Run" to execute the migration');
    console.log('');
    console.log('What this migration does:');
    console.log('  ✓ Adds night_shift (boolean) column to timesheet_entries');
    console.log('  ✓ Adds bank_holiday (boolean) column to timesheet_entries');
    console.log('');
    console.log('These columns are used for payroll calculations:');
    console.log('  • Night shift work is paid at 2x rate');
    console.log('  • Bank holiday work is paid at 2x rate');
    console.log('  • Weekend work (Sat/Sun) is paid at 1.5x rate');
    console.log('  • Mon-Fri regular work is paid at basic rate');
    console.log('');
    console.log('✅ Migration script completed (SQL ready to run manually)');
    
  } catch (error) {
    console.error('❌ Migration preparation failed:', error);
    process.exit(1);
  }
}

runMigration();

