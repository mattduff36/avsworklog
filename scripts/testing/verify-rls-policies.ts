/**
 * Verify RLS Policies
 * 
 * Check current RLS policies on profiles table
 */

import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

async function verifyPolicies() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING!;
  
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Get all policies on profiles table
    const result = await client.query(`
      SELECT 
        schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual
      FROM pg_policies
      WHERE tablename = 'profiles'
      ORDER BY policyname;
    `);

    console.log('📋 Current RLS Policies on profiles table:');
    console.log('═'.repeat(80));
    
    if (result.rows.length === 0) {
      console.log('⚠️  NO POLICIES FOUND!');
    } else {
      result.rows.forEach((policy, index) => {
        console.log(`\n${index + 1}. Policy: ${policy.policyname}`);
        console.log(`   Command: ${policy.cmd}`);
        console.log(`   Permissive: ${policy.permissive}`);
        console.log(`   Definition: ${policy.qual || 'N/A'}`);
      });
    }

    console.log('\n═'.repeat(80));
    console.log(`\nTotal policies: ${result.rows.length}`);

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

verifyPolicies()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

