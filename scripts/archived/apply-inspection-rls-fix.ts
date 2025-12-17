/**
 * Apply the vehicle_inspections RLS policy fix
 * This migration allows users to update their own draft inspections
 * 
 * Following the project's migration guide pattern from:
 * docs/guides/HOW_TO_RUN_MIGRATIONS.md
 * docs/guides/MIGRATIONS_GUIDE.md
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20241201_fix_inspection_update_rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  console.error('\n📖 See: docs/guides/HOW_TO_RUN_MIGRATIONS.md');
  process.exit(1);
}

async function applyMigration() {
  console.log('🚀 Applying vehicle_inspections RLS policy fix...\n');

  // Parse connection string with SSL config (as per MIGRATIONS_GUIDE.md)
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

    console.log('📄 Migration SQL:');
    console.log('━'.repeat(80));
    console.log(migrationSQL);
    console.log('━'.repeat(80));
    console.log('\n🔄 Executing migration...\n');

    // Execute the migration
    await client.query(migrationSQL);

    console.log('━'.repeat(80));
    console.log('✅ MIGRATION APPLIED SUCCESSFULLY!');
    console.log('━'.repeat(80));
    console.log('\n📊 Changes applied:');
    console.log('   ✓ Dropped old "Employees can update own inspections" policy');
    console.log('   ✓ Created new policy with draft/in_progress/submitted/rejected statuses');
    console.log('\n🎯 Users can now:');
    console.log('   • Update their own draft inspections');
    console.log('   • Update in_progress inspections');
    console.log('   • Update submitted inspections');
    console.log('   • Update rejected inspections (to fix and resubmit)\n');

    // Verify the policy was created
    console.log('🔍 Verifying policy...');
    const result = await client.query(`
      SELECT 
        pol.polname as policy_name,
        pol.polcmd as command,
        pg_get_expr(pol.polqual, pol.polrelid) as using_clause
      FROM pg_policy pol
      JOIN pg_class pc ON pol.polrelid = pc.oid
      JOIN pg_namespace pn ON pc.relnamespace = pn.oid
      WHERE pc.relname = 'vehicle_inspections'
        AND pol.polname = 'Employees can update own inspections'
        AND pn.nspname = 'public';
    `);

    if (result.rows.length > 0) {
      console.log('✅ Policy verified:');
      console.log('   Name:', result.rows[0].policy_name);
      console.log('   Command:', result.rows[0].command);
      console.log('   USING clause:', result.rows[0].using_clause);
      
      if (result.rows[0].using_clause?.includes('draft')) {
        console.log('\n🎉 SUCCESS! Policy includes "draft" status\n');
      } else {
        console.log('\n⚠️  WARNING: Policy may not include draft status\n');
      }
    } else {
      console.log('⚠️  Policy not found - verification failed\n');
    }

    console.log('━'.repeat(80));
    console.log('✨ Ready to test!');
    console.log('━'.repeat(80));
    console.log('\n🧪 Test the fix:');
    console.log('   1. Log in as Nathan Hubbard (nathan@avsquires.co.uk)');
    console.log('   2. Open inspection: /inspections/new?id=bfec3294-ee46-4679-b0ed-47ab330536fa');
    console.log('   3. Make a change and save');
    console.log('   4. Verify: No RLS policy violation error\n');

  } catch (error: any) {
    console.error('\n━'.repeat(80));
    console.error('❌ MIGRATION FAILED');
    console.error('━'.repeat(80));
    console.error('\nError:', error.message);
    
    if (error.detail) {
      console.error('Details:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    
    // Handle "already exists" gracefully (as per MIGRATIONS_GUIDE.md)
    if (error.message?.includes('already exists')) {
      console.log('\n✅ Policy already applied - no action needed!');
      process.exit(0);
    }
    
    console.log('\n📝 Manual migration fallback:');
    console.log('   1. Go to: https://supabase.com/dashboard → Your Project → SQL Editor');
    console.log(`   2. Copy & paste contents of: ${sqlFile}`);
    console.log('   3. Click "Run"\n');
    console.log('📖 See: docs/guides/HOW_TO_RUN_MIGRATIONS.md\n');
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration().catch(console.error);
