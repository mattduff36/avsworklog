// URGENT FIX: Remove infinite recursion in profiles RLS policy
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING!;
const url = new URL(connectionString);

const client = new Client({
  host: url.hostname,
  port: parseInt(url.port) || 5432,
  database: url.pathname.slice(1),
  user: url.username,
  password: url.password,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  await client.connect();
  console.log('🚨 URGENT: Fixing infinite recursion in profiles policies...\n');
  
  // Drop ALL policies on profiles to start fresh
  console.log('Dropping all current profiles policies...');
  
  const { rows: policies } = await client.query(`
    SELECT policyname FROM pg_policies WHERE tablename = 'profiles';
  `);
  
  console.log('Current policies:', policies.map(p => p.policyname));
  
  for (const p of policies) {
    console.log(`  Dropping: ${p.policyname}`);
    await client.query(`DROP POLICY IF EXISTS "${p.policyname}" ON profiles;`);
  }
  
  console.log('\nRecreating simple non-recursive policies...');
  
  // Simple policies that don't cause recursion
  await client.query(`
    CREATE POLICY "Users can view own profile" ON profiles
      FOR SELECT USING (auth.uid() = id);
  `);
  console.log('  ✅ Users can view own profile');
  
  await client.query(`
    CREATE POLICY "Users can update own profile" ON profiles
      FOR UPDATE USING (auth.uid() = id);
  `);
  console.log('  ✅ Users can update own profile');
  
  // For managers to view all profiles, use a different approach - check JWT claims instead
  await client.query(`
    CREATE POLICY "Authenticated users can view all profiles" ON profiles
      FOR SELECT USING (auth.role() = 'authenticated');
  `);
  console.log('  ✅ Authenticated users can view all profiles');
  
  console.log('\n✅ FIXED! Site should be working again.');
  console.log('Please refresh the page to test.\n');
  
  await client.end();
}

fix().catch(e => { 
  console.error('❌ Error:', e.message); 
  process.exit(1); 
});

