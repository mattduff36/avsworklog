/**
 * Check RLS policies on van_inspections table
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

async function checkPolicies() {
  console.log('🔍 Checking van_inspections RLS policies...\n');

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
    await client.connect();
    console.log('✅ Connected\n');

    // Check if RLS is enabled
    const rlsCheck = await client.query(`
      SELECT relrowsecurity as rls_enabled
      FROM pg_class
      WHERE relname = 'van_inspections';
    `);

    console.log('🔒 RLS Status:', rlsCheck.rows[0]?.rls_enabled ? 'ENABLED ✅' : 'DISABLED ⚠️');

    // Get all policies
    const policiesResult = await client.query(`
      SELECT 
        policyname, 
        permissive,
        cmd,
        qual,
        with_check
      FROM pg_policies
      WHERE tablename = 'van_inspections'
      ORDER BY cmd, policyname;
    `);

    if (policiesResult.rows.length === 0) {
      console.log('\n⚠️  No RLS policies found!');
      console.log('This means authenticated users might not be able to access this table.\n');
    } else {
      console.log(`\n📜 Found ${policiesResult.rows.length} RLS policies:\n`);
      
      interface PolicyRow {
        cmd?: string;
        policyname?: string;
        permissive?: string;
        qual?: string;
        with_check?: string;
      }
      const grouped: Record<string, PolicyRow[]> = {};
      const rows = policiesResult.rows as PolicyRow[];
      rows.forEach(policy => {
        if (!grouped[policy.cmd ?? '']) grouped[policy.cmd ?? ''] = [];
        grouped[policy.cmd ?? ''].push(policy);
      });

      Object.entries(grouped).forEach(([cmd, policies]) => {
        console.log(`\n${cmd} Policies (${policies.length}):`);
        policies.forEach(policy => {
          console.log(`\n  📌 ${policy.policyname}`);
          console.log(`     Type: ${policy.permissive}`);
          if (policy.qual) {
            console.log(`     USING: ${policy.qual}`);
          }
          if (policy.with_check) {
            console.log(`     WITH CHECK: ${policy.with_check}`);
          }
        });
      });
    }

    // Check for any UPDATE policies
    const updatePolicies = (policiesResult.rows as { cmd?: string }[]).filter(p => p.cmd === 'UPDATE');
    if (updatePolicies.length === 0) {
      console.log('\n⚠️  WARNING: No UPDATE policies found!');
      console.log('Users will NOT be able to update inspections.');
    }

    console.log('\n✅ Check complete');

  } catch (error: unknown) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await client.end();
  }
}

checkPolicies().catch(console.error);

