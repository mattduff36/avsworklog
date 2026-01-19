import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260119_add_maintenance_category_duty.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Maintenance Category Duty Migration...\n');
  console.log('📋 This migration adds:');
  console.log('   • responsibility column (workshop | office)');
  console.log('   • show_on_overview toggle');
  console.log('   • reminder_in_app_enabled flag');
  console.log('   • reminder_email_enabled flag');
  console.log('   • maintenance_category_recipients join table');
  console.log('   • Seeds defaults (Tax = office, others = workshop)\n');

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString);
  
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
    console.log('📡 Connecting to Supabase database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read the migration SQL file
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Execute the migration
    await client.query(migrationSQL);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Verify columns were added
    console.log('🔍 Verifying database changes...\n');
    
    // Check columns exist
    const columnCheck = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'maintenance_categories' 
      AND column_name IN ('responsibility', 'show_on_overview', 'reminder_in_app_enabled', 'reminder_email_enabled')
      ORDER BY column_name
    `);
    
    console.log('   Columns added to maintenance_categories:');
    for (const row of columnCheck.rows) {
      console.log(`   ✓ ${row.column_name}: ${row.data_type} (default: ${row.column_default || 'none'})`);
    }

    // Check join table exists
    const tableCheck = await client.query(`
      SELECT COUNT(*) as count FROM maintenance_category_recipients
    `);
    console.log(`\n   ✓ maintenance_category_recipients table: ${tableCheck.rows[0].count} records`);

    // Show category settings
    const categoryCheck = await client.query(`
      SELECT name, responsibility, show_on_overview, reminder_in_app_enabled, reminder_email_enabled
      FROM maintenance_categories
      ORDER BY sort_order
    `);
    
    console.log('\n   Category defaults:');
    for (const row of categoryCheck.rows) {
      const reminders = [];
      if (row.reminder_in_app_enabled) reminders.push('in-app');
      if (row.reminder_email_enabled) reminders.push('email');
      const reminderStr = reminders.length > 0 ? ` [reminders: ${reminders.join(', ')}]` : '';
      const visibleStr = row.show_on_overview ? '' : ' (hidden)';
      console.log(`   ✓ ${row.name}: ${row.responsibility}${visibleStr}${reminderStr}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Next Steps:');
    console.log('   1. Update TypeScript types in types/maintenance.ts');
    console.log('   2. Update API endpoints to include new fields');
    console.log('   3. Update UI to show Office Action vs Create Task');
    console.log('   4. Configure reminder recipients in Settings');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Details:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    
    // Check if columns/tables already exist
    if (error.message?.includes('already exists')) {
      console.log('\n✅ Schema already up to date - migration may have run before!');
      process.exit(0);
    }
    
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Check your .env.local has POSTGRES_URL_NON_POOLING');
    console.error('   2. Verify database connection string is correct');
    console.error('   3. Ensure you have database permissions');
    console.error('   4. Check the migration SQL for syntax errors\n');
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('📡 Database connection closed.\n');
  }
}

runMigration().catch(console.error);
