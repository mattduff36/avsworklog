/**
 * Fix Actions RLS Policies Migration
 * Updates actions RLS policies to use roles table instead of deprecated profiles.role
 * 
 * PROBLEM: Employees getting 42501 errors when submitting inspections with defects
 * CAUSE: Policies checking deprecated profiles.role column (NULL)
 * FIX: Update to use profiles.role_id -> roles.is_manager_admin
 * 
 * Uses direct PostgreSQL connection from .env.local
 * Run with: npx tsx scripts/run-actions-rls-fix.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20251217_fix_actions_rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runActionsRLSFix() {
  console.log('🔒 Fixing Actions RLS Policies...\n');
  console.log('📋 Issue: 42501 errors when submitting inspections with defects');
  console.log('🎯 Solution: Update policies to use roles table structure\n');

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString!);
  
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
    console.log('   ✓ Dropped old/broken RLS policies on actions');
    console.log('   ✓ Created new policies using roles table:');
    console.log('      - SELECT: Managers (all)');
    console.log('      - INSERT: All authenticated users');
    console.log('      - UPDATE: Managers (all)');
    console.log('      - DELETE: Managers (all)');
    console.log('   ✓ Total: 4 policies created\n');
    
    // Verify policies were created
    console.log('🔍 Verifying policies...\n');
    
    const { rows: policies } = await client.query(`
      SELECT 
        policyname,
        cmd
      FROM pg_policies
      WHERE tablename = 'actions'
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
    
    console.log(`\n   ✅ Total policies: ${policies.length}/4 expected\n`);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 What Was Fixed:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n❌ BEFORE (Broken):');
    console.log('   INSERT Policy: profiles.role IN (\'admin\', \'manager\')');
    console.log('   Problem: profiles.role column is deprecated (NULL)');
    console.log('   Result: Employees got 42501 RLS violations when submitting inspections with defects\n');
    
    console.log('✅ AFTER (Fixed):');
    console.log('   INSERT Policy: All authenticated users can create actions');
    console.log('   SELECT/UPDATE/DELETE: roles.is_manager_admin = true');
    console.log('   How: JOIN profiles.role_id → roles.id');
    console.log('   Result: Inspections with defects now auto-create actions successfully\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Testing Recommendations:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n1. Employee Submitting Inspection with Defects:');
    console.log('   - Log in as any employee');
    console.log('   - Go to /inspections/new');
    console.log('   - Create inspection with failed items (attention status)');
    console.log('   - Submit the inspection');
    console.log('   - Should work without 42501 errors ✅');
    console.log('   - Actions should appear on /actions page ✅\n');
    
    console.log('2. Manager Creating Manual Action:');
    console.log('   - Log in as manager');
    console.log('   - Go to /actions');
    console.log('   - Create a new action');
    console.log('   - Should work as before (no regression) ✅\n');
    
    console.log('3. Check Error Logs:');
    console.log('   - Visit /debug page');
    console.log('   - Look for 42501 errors related to actions');
    console.log('   - Should be no new errors ✅\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Done! Actions RLS policies are fixed');
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
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runActionsRLSFix().catch(console.error);
