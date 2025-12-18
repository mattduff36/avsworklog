import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/add_comments_to_rams_assignments.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running RAMS Comments Column Migration...\n');

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

    console.log('✅ MIGRATION COMPLETED!\n');
    
    // Verify changes
    const { rows } = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'rams_assignments' 
      AND column_name = 'comments'
    `);

    if (rows.length > 0) {
      console.log('✅ Column added successfully:');
      console.log(`   - Column: ${rows[0].column_name}`);
      console.log(`   - Type: ${rows[0].data_type}`);
    } else {
      console.log('⚠️  Column not found - may already exist or migration failed');
    }

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);
    
    if (error.message?.includes('already exists')) {
      console.log('✅ Column already exists - no action needed!');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

