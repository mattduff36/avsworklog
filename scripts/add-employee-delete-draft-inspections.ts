/**
 * Migration Script: Add DELETE policy for employees to delete draft inspections
 * 
 * Purpose: Allows employees to delete their own draft vehicle inspections.
 *          Employees can only delete drafts, not submitted/approved/rejected inspections.
 * 
 * Usage: npx tsx scripts/add-employee-delete-draft-inspections.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  console.error('  - POSTGRES_URL_NON_POOLING (preferred for migrations)');
  console.error('  - POSTGRES_URL (fallback)');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Adding DELETE policy for employees to delete draft inspections...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 CHANGE SUMMARY:');
  console.log('   Employees can now delete their own DRAFT inspections');
  console.log('   Employees CANNOT delete submitted/approved/rejected inspections');
  console.log('   Managers/Admins retain all existing permissions');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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
      resolve(process.cwd(), 'supabase/add-employee-delete-draft-inspections.sql'),
      'utf-8'
    );

    console.log('📄 Migration file loaded');
    console.log('🔄 Executing SQL migration...\n');

    // Execute the migration
    const result = await client.query(migrationSQL);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📊 Database changes applied:');
    console.log('   ✓ Added DELETE policy: "Employees can delete own draft inspections"');
    console.log('   ✓ Employees can now delete their own draft inspections');
    console.log('   ✓ Employees CANNOT delete submitted/approved/rejected inspections\n');

    // Verify policies
    console.log('🔍 Verifying current policies on vehicle_inspections...\n');
    const verifyResult = await client.query(`
      SELECT policyname, cmd, qual
      FROM pg_policies 
      WHERE tablename = 'vehicle_inspections'
      ORDER BY cmd, policyname;
    `);

    console.log('Current RLS Policies:');
    console.log('Operation | Policy Name');
    console.log('----------|' + '-'.repeat(60));
    
    verifyResult.rows.forEach(row => {
      const icon = row.policyname.includes('delete') || row.policyname.includes('DELETE') 
        ? '✅' : '  ';
      console.log(`${icon} ${row.cmd.padEnd(8)} | ${row.policyname}`);
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Ready to use!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🧪 What employees can now do:');
    console.log('   ✅ Delete draft inspections they created');
    console.log('   ❌ Cannot delete submitted inspections');
    console.log('   ❌ Cannot delete approved inspections');
    console.log('   ❌ Cannot delete rejected inspections');
    console.log('   ❌ Cannot delete other users\' inspections\n');
    console.log('🔧 What managers/admins can do:');
    console.log('   ✅ All existing permissions remain unchanged');
    console.log('   ✅ Can delete any inspection (via existing policies)\n');

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
    
    // Check if policy already exists
    if (error.message.includes('already exists')) {
      console.log('\n✅ Good news! The DELETE policy already exists.');
      console.log('   The fix may have already been applied.\n');
      console.log('🧪 Try testing the draft inspection deletion functionality.');
      console.log('   If it works, no further action is needed.\n');
      process.exit(0);
    }
    
    console.log('\n📝 You can run the migration manually:');
    console.log('   1. Go to: Supabase Dashboard → SQL Editor');
    console.log('   2. Click "New query"');
    console.log('   3. Copy & paste contents of: supabase/add-employee-delete-draft-inspections.sql');
    console.log('   4. Click "Run"\n');
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

