import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260126_add_notification_message_type.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('📨 Running Add Notification Type Migration...\n');

  // Parse connection string with SSL config
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

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing notification type migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('📨 Message Types Updated:');
    
    console.log('\n1️⃣  Supported Types:');
    console.log('   ✓ TOOLBOX_TALK (requires signature)');
    console.log('   ✓ REMINDER (dismissible)');
    console.log('   ✓ NOTIFICATION (new - for errors, maintenance, etc.)');
    
    console.log('\n2️⃣  Expected Impact:');
    console.log('   ✓ Error reports will use NOTIFICATION type');
    console.log('   ✓ Debug error alerts will use NOTIFICATION type');
    console.log('   ✓ Toolbox Reports tab will exclude NOTIFICATION messages');
    console.log('   ✓ Future modules can send NOTIFICATION type messages');

    console.log('\n✅ Migration complete\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    
    if (error.message.includes('already exists')) {
      console.log('\n💡 TIP: Constraint may already exist. Check if migration was previously run.');
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
