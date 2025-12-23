import * as dotenv from 'dotenv';
import * as path from 'path';
import pg from 'pg';
import * as fs from 'fs';

// Load .env.local explicitly
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function runMigration() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found in environment');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read migration file
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20251223_add_mot_expiry_date.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Running migration: 20251223_add_mot_expiry_date.sql\n');
    
    await client.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!\n');
    console.log('Added columns:');
    console.log('  - mot_expiry_date (DATE)');
    console.log('  - mot_api_sync_status (TEXT)');
    console.log('  - mot_api_sync_error (TEXT)');
    console.log('  - last_mot_api_sync (TIMESTAMPTZ)');
    console.log('  - mot_raw_data (JSONB)');

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();

