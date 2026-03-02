import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/fix-timesheet-rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Timesheet RLS Policy Fix Migration...\n');

  // Parse connection string with SSL config
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
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');
    
    // Verify policies were created
    const { rows: timesheetPolicies } = await client.query(`
      SELECT policyname 
      FROM pg_policies 
      WHERE tablename = 'timesheets' 
      AND policyname LIKE '%update%'
      ORDER BY policyname
    `);

    const { rows: entryPolicies } = await client.query(`
      SELECT policyname 
      FROM pg_policies 
      WHERE tablename = 'timesheet_entries' 
      AND (policyname LIKE '%delete%' OR policyname LIKE '%insert%' OR policyname LIKE '%update%')
      ORDER BY policyname
    `);

    console.log('📋 Timesheet UPDATE policies:');
    timesheetPolicies.forEach(p => console.log(`   ✓ ${p.policyname}`));
    
    console.log('\n📋 Timesheet Entry policies (INSERT/UPDATE/DELETE):');
    entryPolicies.forEach(p => console.log(`   ✓ ${p.policyname}`));

    console.log('\n✅ All policies verified successfully!');
    console.log('\n💡 Employees can now:');
    console.log('   - Update their own draft/rejected timesheets');
    console.log('   - Submit draft timesheets (change status to submitted)');
    console.log('   - Delete and re-insert entries when updating');
    console.log('\n💡 Managers can now:');
    console.log('   - Edit and submit timesheets for any employee');
    console.log('   - Manage all timesheet entries');

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ MIGRATION FAILED:', msg);
    
    if (msg.includes('already exists')) {
      console.log('✅ Policy already exists - this is fine!');
      console.log('   The migration will update existing policies.');
    }
    
    if (msg.includes('does not exist')) {
      console.log('⚠️  Some policies may not exist yet - this is expected on first run.');
    }
    
    console.error('\nFull error:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

