// Migration: Fix RLS policies to use the roles table instead of deprecated profiles.role column
// Run: npx tsx scripts/fix-rls-to-use-roles-table.ts

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🔧 Fixing RLS Policies to Use Roles Table\n');
  console.log('This migration updates all RLS policies to check roles.is_manager_admin');
  console.log('instead of the deprecated profiles.role column.\n');

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
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read SQL file
    const sqlPath = resolve(process.cwd(), 'supabase/fix-rls-to-use-roles-table.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log('📝 Executing migration...\n');
    
    // Execute the SQL
    await client.query(sql);
    
    console.log('✅ Migration completed successfully!\n');

    // Verify Andy's access
    console.log('🔍 Verifying Andy Hill\'s permissions...');
    
    const { rows: andyCheck } = await client.query(`
      SELECT 
        p.full_name,
        p.role as old_role_column,
        r.name as new_role_name,
        r.is_manager_admin
      FROM profiles p
      JOIN roles r ON p.role_id = r.id
      JOIN auth.users au ON p.id = au.id
      WHERE au.email = 'andy@avsquires.co.uk';
    `);

    console.table(andyCheck);

    if (andyCheck[0]?.is_manager_admin) {
      console.log('\n✅ Andy Hill now has manager/admin permissions via roles table');
      console.log('   His RLS policies should now allow viewing all inspections');
    }

    // Count inspections to verify they exist
    const { rows: count } = await client.query('SELECT COUNT(*) as total FROM vehicle_inspections');
    console.log(`\n📊 Total inspections in database: ${count[0].total}`);

    console.log('\n⚠️  Andy should log out and log back in to refresh his session.');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    
    // If policy already exists, that's OK
    if (error.message.includes('already exists')) {
      console.log('Note: Some policies may already exist, which is fine.');
    } else {
      throw error;
    }
  } finally {
    await client.end();
    console.log('\n📡 Database connection closed');
  }
}

runMigration().catch(console.error);

