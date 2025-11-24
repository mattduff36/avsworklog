import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/remove-role-field-constraint.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Removing role field CHECK constraint...\n');

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

    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    const result = await client.query(migrationSQL);
    
    console.log('✅ MIGRATION COMPLETED!\n');

    // Show results
    if (result.rows && result.rows.length > 0) {
      console.log('📊 Migration results:');
      console.log(`   Status: ${result.rows[0].status}`);
      console.log(`   Total profiles: ${result.rows[0].total_profiles}`);
      console.log(`   Profiles with role_id: ${result.rows[0].profiles_with_role_id}`);
      console.log(`   Profiles with NULL role: ${result.rows[0].profiles_with_null_role}\n`);
    }

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);
    
    if (error.message?.includes('does not exist')) {
      console.log('✅ Constraint already removed - no action needed!');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

