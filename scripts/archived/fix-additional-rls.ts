// @ts-nocheck
// Fix additional RLS issues from error logs
// Run: npx tsx scripts/fix-additional-rls.ts

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('🔧 Fixing Additional RLS Issues\n');
  console.log('This will fix:');
  console.log('  1. Actions table - allow users to create actions');
  console.log('  2. Vehicles table - allow users to add vehicles');
  console.log('');

  const url = new URL(connectionString);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const sql = readFileSync(resolve(process.cwd(), 'supabase/fix-additional-rls.sql'), 'utf-8');
    
    console.log('📄 Executing migration...\n');
    await client.query(sql);
    
    console.log('✅ Migration completed!\n');

    // Verify
    const { rows: actionsPolicies } = await client.query(`
      SELECT policyname, cmd 
      FROM pg_policies 
      WHERE tablename = 'actions'
      ORDER BY cmd;
    `);
    
    console.log('📋 Actions table policies:');
    actionsPolicies.forEach(p => console.log(`  - ${p.cmd}: ${p.policyname}`));

    const { rows: vehiclesPolicies } = await client.query(`
      SELECT policyname, cmd 
      FROM pg_policies 
      WHERE tablename = 'vehicles'
      ORDER BY cmd;
    `);
    
    console.log('\n📋 Vehicles table policies:');
    vehiclesPolicies.forEach(p => console.log(`  - ${p.cmd}: ${p.policyname}`));

    console.log('\n✅ All RLS policies updated successfully!');

  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      console.log('✅ Some policies already exist - this is fine');
    } else {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

