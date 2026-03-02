// @ts-nocheck
/**
 * Fix Inspection Items RLS Policies Migration
 * Updates inspection_items RLS policies to use roles table instead of deprecated profiles.role
 * 
 * PROBLEM: Managers getting 42501 errors when creating inspection items
 * CAUSE: Policies checking deprecated profiles.role column (NULL)
 * FIX: Update to use profiles.role_id -> roles.is_manager_admin
 * 
 * Uses direct PostgreSQL connection from .env.local
 * Run with: npx tsx scripts/run-inspection-items-rls-fix.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20251206_fix_inspection_items_rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  console.error('\nExpected environment variables:');
  console.error('  - POSTGRES_URL_NON_POOLING (preferred for migrations)');
  console.error('  - POSTGRES_URL (fallback)');
  process.exit(1);
}

async function runInspectionItemsRLSFix() {
  console.log('🔒 Fixing Inspection Items RLS Policies...\n');
  console.log('📋 Issue: 42501 errors when managers create inspection items');
  console.log('🎯 Solution: Update policies to use roles table structure\n');

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

    console.log('📄 Executing migration from:', sqlFile);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Execute the migration
    await client.query(migrationSQL);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📊 Database changes applied:');
    console.log('   ✓ Dropped old/broken RLS policies on inspection_items');
    console.log('   ✓ Created new policies using roles table:');
    console.log('      - SELECT: Employees (own) + Managers (all)');
    console.log('      - INSERT: Employees (own) + Managers (all)');
    console.log('      - UPDATE: Employees (own drafts) + Managers (all)');
    console.log('      - DELETE: Employees (own drafts) + Managers (all)');
    console.log('   ✓ Total: 8 policies created\n');
    
    // Verify policies were created
    console.log('🔍 Verifying policies...\n');
    
    const { rows: policies } = await client.query(`
      SELECT 
        policyname,
        cmd
      FROM pg_policies
      WHERE tablename = 'inspection_items'
      ORDER BY policyname
    `);

    if (policies.length === 0) {
      console.log('   ⚠️  No policies found - this might be an issue!');
    } else {
      policies.forEach((policy: { policyname: string; cmd: string }) => {
        const cmdIcon = 
          policy.cmd === 'SELECT' ? '👁️' :
          policy.cmd === 'INSERT' ? '➕' :
          policy.cmd === 'UPDATE' ? '✏️' :
          policy.cmd === 'DELETE' ? '🗑️' : '❓';
        console.log(`   ${cmdIcon}  ${policy.cmd.padEnd(6)} - ${policy.policyname}`);
      });
    }
    
    console.log(`\n   ✅ Total policies: ${policies.length}/8 expected\n`);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 What Was Fixed:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n❌ BEFORE (Broken):');
    console.log('   Policies checked: profiles.role IN (\'manager\', \'admin\')');
    console.log('   Problem: profiles.role column is deprecated (NULL)');
    console.log('   Result: Managers got 42501 RLS violations\n');
    
    console.log('✅ AFTER (Fixed):');
    console.log('   Policies check: roles.is_manager_admin = true');
    console.log('   How: JOIN profiles.role_id → roles.id');
    console.log('   Result: Managers can now create inspection items\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Testing Recommendations:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n1. Manager Creating for Employee:');
    console.log('   - Log in as manager (e.g., Nathan)');
    console.log('   - Go to /inspections/new');
    console.log('   - Select another employee');
    console.log('   - Create and submit inspection');
    console.log('   - Should work without 42501 errors ✅\n');
    
    console.log('2. Employee Creating Own:');
    console.log('   - Log in as employee');
    console.log('   - Create and submit inspection');
    console.log('   - Should work as before (no regression) ✅\n');
    
    console.log('3. Check Error Logs:');
    console.log('   - Visit /debug page');
    console.log('   - Look for 42501 errors');
    console.log('   - Should be no new inspection_items errors ✅\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Done! Inspection items RLS policies are fixed');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: unknown) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    if (error instanceof Error) {
      console.error('Error:', error.message);
      const pgError = error as Error & { detail?: string; hint?: string };
      if (pgError.detail) {
        console.error('Details:', pgError.detail);
      }
      if (pgError.hint) {
        console.error('Hint:', pgError.hint);
      }
    } else {
      console.error('Unknown error:', error);
    }
    
    // Note: Policies can be dropped and recreated, so "already exists" is not expected
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runInspectionItemsRLSFix().catch(console.error);
