/**
 * Allow audited service correction events (partial unique completion index).
 *
 * Usage: npx tsx scripts/run-asset-service-correction-events-migration.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260808_asset_service_correction_events.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  process.exit(1);
}

async function main() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    const { rows } = await client.query<{ indexname: string }>(
      `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'asset_service_events'
        AND indexname = 'asset_service_events_one_completion_per_task'
      `,
    );
    if (rows.length !== 1) {
      throw new Error('Expected partial unique index asset_service_events_one_completion_per_task');
    }

    const { rows: cols } = await client.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'asset_service_events'
        AND column_name = 'corrects_event_id'
      `,
    );
    if (cols.length !== 1) {
      throw new Error('Expected corrects_event_id column');
    }

    console.log('✅ Asset service correction events migration applied');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void main();
