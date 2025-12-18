/**
 * Run RAMS Database Migration
 * Creates rams_documents, rams_assignments, and rams_visitor_signatures tables
 * 
 * Uses direct PostgreSQL connection from .env.local
 * Run with: npx tsx scripts/run-rams-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/create-rams-tables.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  console.error('\nExpected environment variables:');
  console.error('  - POSTGRES_URL_NON_POOLING (preferred for migrations)');
  console.error('  - POSTGRES_URL (fallback)');
  process.exit(1);
}

async function runRAMSMigration() {
  console.log('🚀 Running RAMS Database Migration...\n');

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
    console.log('   ✓ Created rams_documents table');
    console.log('   ✓ Created rams_assignments table');
    console.log('   ✓ Created rams_visitor_signatures table');
    console.log('   ✓ Created indexes for performance');
    console.log('   ✓ Enabled Row Level Security (RLS)');
    console.log('   ✓ Created RLS policies:');
    console.log('      - Managers can view/create/update all RAMS');
    console.log('      - Employees can view assigned RAMS only');
    console.log('      - Employees can sign their assignments');
    console.log('      - Users can record visitor signatures');
    console.log('   ✓ Created updated_at trigger\n');
    
    // Verify tables were created
    console.log('🔍 Verifying tables...\n');
    
    const { rows: tables } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'rams_%'
      ORDER BY table_name
    `);

    tables.forEach((table: any) => {
      console.log(`   ✅ ${table.table_name}`);
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 Next Steps:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n1. Setup Storage Bucket:');
    console.log('   npx tsx scripts/setup-rams-storage.ts');
    console.log('\n2. Configure Storage RLS Policies (manual step):');
    console.log('   The storage setup script will provide instructions\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Ready! RAMS feature database is configured');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Details:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    
    // Check if tables already exist
    if (error.message?.includes('already exists')) {
      console.log('\n✅ Tables already exist - no action needed!');
      console.log('If you need to modify the schema, consider creating an ALTER migration.\n');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runRAMSMigration().catch(console.error);

