/**
 * Verify Inspection RLS Policies
 * 
 * This script verifies that all required RLS policies are in place
 * for the inspection_items table.
 * 
 * Run: npx tsx scripts/verify-inspection-rls-policies.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function verifyPolicies() {
  console.log('🔍 Verifying RLS Policies for inspection_items...\n');

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
    await client.connect();

    const result = await client.query(`
      SELECT 
        policyname,
        cmd,
        qual
      FROM pg_policies 
      WHERE tablename = 'inspection_items'
      ORDER BY cmd, policyname;
    `);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 INSPECTION_ITEMS RLS POLICIES');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const requiredPolicies = {
      'SELECT': ['Employees can view own inspection items', 'Managers can view all inspection items'],
      'INSERT': ['Employees can insert own inspection items'],
      'UPDATE': ['Employees can update own inspection items'],
      'DELETE': ['Employees can delete own inspection items']
    };

    const foundPolicies: Record<string, string[]> = {
      'SELECT': [],
      'INSERT': [],
      'UPDATE': [],
      'DELETE': []
    };

    result.rows.forEach(row => {
      foundPolicies[row.cmd] = foundPolicies[row.cmd] || [];
      foundPolicies[row.cmd].push(row.policyname);
    });

    let allGood = true;

    console.log('Required Policies:\n');
    
    for (const [cmd, policyNames] of Object.entries(requiredPolicies)) {
      console.log(`${cmd}:`);
      for (const policyName of policyNames) {
        const exists = foundPolicies[cmd]?.includes(policyName);
        const icon = exists ? '✅' : '❌';
        console.log(`  ${icon} ${policyName}`);
        if (!exists) allGood = false;
      }
      console.log();
    }

    if (!allGood) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('❌ MISSING POLICIES DETECTED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('Run the following migration:');
      console.log('  npx tsx scripts/add-inspection-items-delete-policy.ts\n');
      process.exit(1);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ ALL POLICIES ARE IN PLACE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('If mobile users still have issues, they need to:');
    console.log('  1. Clear browser cache on mobile device');
    console.log('  2. Close app completely');
    console.log('  3. Reopen and login again\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyPolicies();

