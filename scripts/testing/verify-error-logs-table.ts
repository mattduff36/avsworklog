// @ts-nocheck
/**
 * Verify error_logs table exists and check permissions
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function verifyTable() {
  console.log('🔍 Verifying error_logs table...\n');

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
    console.log('✅ Connected to database\n');

    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'error_logs'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.error('❌ Table "error_logs" does NOT exist!');
      console.log('\n💡 Run: npx tsx scripts/run-error-logs-migration.ts');
      process.exit(1);
    }

    console.log('✅ Table "error_logs" exists\n');

    // Check columns
    const columnsResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'error_logs'
      ORDER BY ordinal_position;
    `);

    console.log('📋 Columns:');
    columnsResult.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type}`);
    });

    // Check RLS
    console.log('\n🔒 Checking Row Level Security...');
    const rlsCheck = await client.query(`
      SELECT relrowsecurity as rls_enabled
      FROM pg_class
      WHERE relname = 'error_logs';
    `);

    if (rlsCheck.rows[0]?.rls_enabled) {
      console.log('✅ RLS is ENABLED');
      
      // Check policies
      const policiesResult = await client.query(`
        SELECT policyname, permissive, roles, cmd, qual, with_check
        FROM pg_policies
        WHERE tablename = 'error_logs';
      `);

      if (policiesResult.rows.length > 0) {
        console.log(`\n📜 Found ${policiesResult.rows.length} RLS policies:`);
        policiesResult.rows.forEach(policy => {
          console.log(`   - ${policy.policyname}`);
          console.log(`     Command: ${policy.cmd}`);
          console.log(`     Roles: ${policy.roles.join(', ')}`);
        });
      } else {
        console.log('⚠️  No RLS policies found!');
      }
    } else {
      console.log('⚠️  RLS is NOT enabled');
    }

    // Check indexes
    console.log('\n📊 Checking indexes...');
    const indexesResult = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'error_logs';
    `);

    if (indexesResult.rows.length > 0) {
      console.log(`✅ Found ${indexesResult.rows.length} indexes`);
      indexesResult.rows.forEach(idx => {
        console.log(`   - ${idx.indexname}`);
      });
    } else {
      console.log('⚠️  No indexes found');
    }

    // Check row count
    const countResult = await client.query('SELECT COUNT(*) FROM error_logs;');
    console.log(`\n📈 Current row count: ${countResult.rows[0].count}`);

    console.log('\n✅ Verification complete!');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyTable().catch(console.error);

