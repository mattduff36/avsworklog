/**
 * Migration Script: Add DELETE policy for inspection_items
 * 
 * Purpose: Fixes the issue where users cannot delete their own inspection items
 *          when re-saving draft inspections, which causes duplicate key constraint errors.
 * 
 * Root Cause: The migrate-inspections.sql file created SELECT, INSERT, and UPDATE policies
 *             but no DELETE policy, so users couldn't delete items even from their own drafts.
 * 
 * Solution: Add a DELETE policy that allows users to delete items from their own
 *           draft or rejected inspections.
 * 
 * Usage: npx tsx scripts/add-inspection-items-delete-policy.ts
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
  console.log('🚀 Adding DELETE policy for inspection_items...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🐛 ROOT CAUSE IDENTIFIED:');
  console.log('   The migrate-inspections.sql file created SELECT, INSERT,');
  console.log('   and UPDATE policies but NO DELETE policy for inspection_items.');
  console.log('   This caused the delete operation to be blocked by RLS,');
  console.log('   leading to duplicate key constraint errors on re-save.');
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
      resolve(process.cwd(), 'supabase/add-inspection-items-delete-policy.sql'),
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
    console.log('   ✓ Added DELETE policy: "Employees can delete own inspection items"');
    console.log('   ✓ Users can now delete items from draft/rejected inspections');
    console.log('   ✓ Re-saving draft inspections will now work correctly\n');

    // Verify policies
    console.log('🔍 Verifying current policies on inspection_items...\n');
    const verifyResult = await client.query(`
      SELECT policyname, cmd 
      FROM pg_policies 
      WHERE tablename = 'inspection_items'
      ORDER BY cmd;
    `);

    console.log('Current RLS Policies:');
    verifyResult.rows.forEach(row => {
      const icon = row.cmd === 'DELETE' ? '✅' : '  ';
      console.log(`   ${icon} ${row.cmd.padEnd(8)} - ${row.policyname}`);
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Ready to test!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🧪 Test the fix by:');
    console.log('   1. Creating a draft inspection (e.g., Monday only)');
    console.log('   2. Saving it as draft');
    console.log('   3. Reopening the draft and adding more data (e.g., Tuesday)');
    console.log('   4. Saving again → Should now work without errors! ✨\n');

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
      console.log('🧪 Try testing the draft inspection re-save functionality.');
      console.log('   If it works, no further action is needed.\n');
      process.exit(0);
    }
    
    console.log('\n📝 You can run the migration manually:');
    console.log('   1. Go to: Supabase Dashboard → SQL Editor');
    console.log('   2. Click "New query"');
    console.log('   3. Copy & paste contents of: supabase/add-inspection-items-delete-policy.sql');
    console.log('   4. Click "Run"\n');
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

