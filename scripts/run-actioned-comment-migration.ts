import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260109_add_actioned_comment_to_actions.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Actioned Comment Migration...\n');

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

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('📋 Summary:');
    console.log('   - Added actioned_comment column to actions table');
    console.log('   - Created index for actioned_comment queries');
    console.log('   - Column is nullable (max 500 chars enforced at app level)\n');

    // Verify the column was added
    const { rows } = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'actions' 
      AND column_name = 'actioned_comment'
    `);

    if (rows.length > 0) {
      console.log('✅ Verification: actioned_comment column exists');
      console.log(`   Type: ${rows[0].data_type}`);
      console.log(`   Nullable: ${rows[0].is_nullable}\n`);
    } else {
      console.log('⚠️  Warning: Could not verify column creation\n');
    }

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Details:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    
    // Check if column already exists
    if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
      console.log('\n✅ Column already exists - no action needed!\n');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
