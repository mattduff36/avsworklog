// @ts-nocheck
/**
 * Run Messages Database Migration
 * Creates messages and message_recipients tables
 * 
 * Uses direct PostgreSQL connection from .env.local
 * Run with: npx tsx scripts/run-messages-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/create-messages-tables.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  console.error('\nExpected environment variables:');
  console.error('  - POSTGRES_URL_NON_POOLING (preferred for migrations)');
  console.error('  - POSTGRES_URL (fallback)');
  process.exit(1);
}

async function runMessagesMigration() {
  console.log('🚀 Running Messages System Database Migration...\n');

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
    console.log('   ✓ Created messages table');
    console.log('   ✓ Created message_recipients table');
    console.log('   ✓ Created MESSAGE_TYPE enum (TOOLBOX_TALK, REMINDER)');
    console.log('   ✓ Created MESSAGE_PRIORITY enum (HIGH, LOW)');
    console.log('   ✓ Created MESSAGE_RECIPIENT_STATUS enum');
    console.log('   ✓ Created indexes for performance');
    console.log('   ✓ Enabled Row Level Security (RLS)');
    console.log('   ✓ Created RLS policies:');
    console.log('      - Managers can view/create all messages');
    console.log('      - Users can view their own message recipients');
    console.log('      - Users can update their recipient status\n');
    
    // Verify tables were created
    console.log('🔍 Verifying tables...\n');
    
    const { rows: tables } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name = 'messages' OR table_name = 'message_recipients')
      ORDER BY table_name
    `);

    tables.forEach((table: { table_name: string }) => {
      console.log(`   ✅ ${table.table_name}`);
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📌 Next Steps:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n1. Run Automated Tests:');
    console.log('   npx tsx scripts/test-messaging-system.ts');
    console.log('\n2. Follow Manual Testing Guide:');
    console.log('   See docs/QUICK_TEST_GUIDE.md\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Ready! Messages feature database is configured');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const err = error as { message?: string; detail?: string; hint?: string };
    console.error('Error:', err.message);
    if (err.detail) {
      console.error('Details:', err.detail);
    }
    if (err.hint) {
      console.error('Hint:', err.hint);
    }
    
    // Check if tables already exist
    if (err.message?.includes('already exists')) {
      console.log('\n✅ Tables already exist - no action needed!');
      console.log('If you need to modify the schema, consider creating an ALTER migration.\n');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMessagesMigration().catch(console.error);
