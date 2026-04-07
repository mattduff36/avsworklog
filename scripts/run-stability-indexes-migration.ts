import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260407_add_stability_indexes.sql';
const EXPECTED_INDEXES = [
  'idx_message_recipients_user_pending_inbox_message',
  'idx_user_page_visits_user_path_visited_at_desc',
  'idx_rams_assignments_employee_status',
  'idx_absences_profile_date_desc',
  'idx_absences_status_date_desc',
] as const;

async function runMigration() {
  console.log('🚀 Running stability index migration\n');

  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

  if (!connectionString) {
    console.error('❌ Missing database connection string');
    console.error(
      'Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local'
    );
    process.exit(1);
  }

  const migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
  const url = new URL(connectionString);

  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    console.log(`📝 Executing migration from ${MIGRATION_FILE}...`);
    await client.query(migrationSQL);
    console.log('✅ Migration executed successfully\n');

    const verification = await client.query<{
      indexname: string;
    }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
      ORDER BY indexname;
    `, [EXPECTED_INDEXES]);

    const foundIndexes = new Set(verification.rows.map((row) => row.indexname));
    const missingIndexes = EXPECTED_INDEXES.filter((indexName) => !foundIndexes.has(indexName));

    if (missingIndexes.length > 0) {
      throw new Error(`Missing expected indexes: ${missingIndexes.join(', ')}`);
    }

    console.log('✅ Verified indexes:');
    EXPECTED_INDEXES.forEach((indexName) => {
      console.log(`   - ${indexName}`);
    });
  } catch (error) {
    console.error('❌ Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

runMigration().catch((error) => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
