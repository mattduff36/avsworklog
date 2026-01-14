import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260114_workshop_task_comments.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Workshop Task Comments Migration...\n');

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
    console.log('   - Created workshop_task_comments table');
    console.log('   - Added RLS policies (workshop users read/create, authors/managers edit/delete)');
    console.log('   - Created indexes for timeline queries and author filtering');
    console.log('   - Added updated_at trigger\n');

    // Backfill existing workshop_comments as initial comments
    console.log('📝 Backfilling existing workshop_comments as initial comments...');
    const backfillResult = await client.query(`
      INSERT INTO workshop_task_comments (task_id, author_id, body, created_at)
      SELECT 
        id as task_id,
        created_by as author_id,
        workshop_comments as body,
        created_at
      FROM actions
      WHERE action_type IN ('inspection_defect', 'workshop_vehicle_task')
        AND workshop_comments IS NOT NULL
        AND workshop_comments != ''
        AND char_length(workshop_comments) > 0
      ON CONFLICT DO NOTHING
      RETURNING id;
    `);

    console.log(`   - Backfilled ${backfillResult.rowCount || 0} initial comments\n`);

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
