/**
 * Migration Runner: error_logs archived retention index
 *
 * Usage: npx tsx scripts/run-error-logs-archived-retention-index-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING is set in .env.local');
  process.exit(1);
}

function requireNonPoolingConnectionString(): string {
  if (!connectionString) {
    throw new Error('Missing database connection string');
  }
  return connectionString;
}

const INDEX_NAME = 'idx_error_logs_archived_at';
const EXPECTED_INDEXDEF =
  'CREATE INDEX idx_error_logs_archived_at ON public.error_logs USING btree (archived_at) WHERE (status = \'archived\'::text)';
const INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME}
  ON public.error_logs (archived_at)
  WHERE status = 'archived'
`;

async function runMigration() {
  console.log('🛡️ Running error_logs archived retention index migration...\n');

  const url = new URL(requireNonPoolingConnectionString());

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    console.log('📄 Creating archived_at partial index concurrently...');
    await client.query(INDEX_SQL);

    const verified = await client.query<{
      indexdef: string;
      indisvalid: boolean;
      indisready: boolean;
      key_count: string;
      key_columns: string;
      predicate: string;
    }>(`
      SELECT
        pg_get_indexdef(class_row.oid) AS indexdef,
        index_row.indisvalid,
        index_row.indisready,
        index_row.indnkeyatts::text AS key_count,
        (
          SELECT string_agg(attribute_row.attname, ',' ORDER BY key_position.ordinality)
          FROM unnest(index_row.indkey) WITH ORDINALITY AS key_position(attnum, ordinality)
          JOIN pg_attribute attribute_row
            ON attribute_row.attrelid = index_row.indrelid
           AND attribute_row.attnum = key_position.attnum
        ) AS key_columns,
        pg_get_expr(index_row.indpred, index_row.indrelid) AS predicate
      FROM pg_index index_row
      JOIN pg_class class_row ON class_row.oid = index_row.indexrelid
      JOIN pg_namespace schema_row ON schema_row.oid = class_row.relnamespace
      WHERE schema_row.nspname = 'public'
        AND class_row.relname = $1
    `, [INDEX_NAME]);

    const index = verified.rows[0];
    if (
      !index ||
      index.indexdef !== EXPECTED_INDEXDEF ||
      index.key_count !== '1' ||
      index.key_columns !== 'archived_at' ||
      index.predicate !== '(status = \'archived\'::text)'
    ) {
      throw new Error('error_logs archived retention index verification failed');
    }

    if (!index.indisvalid || !index.indisready) {
      throw new Error('error_logs archived retention index is not valid and ready');
    }

    console.log('\n✅ Migration completed successfully!');
    console.log(`✅ Verified ${INDEX_NAME}`);
    console.log(`  ${index.indexdef}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Migration failed:');
    console.error(message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
