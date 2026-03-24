import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260324_quote_timeline_events.sql';

function getConnectionCandidates(): string[] {
  return Array.from(
    new Set(
      [process.env.POSTGRES_URL_NON_POOLING, process.env.POSTGRES_URL].filter(
        (value): value is string => Boolean(value)
      )
    )
  );
}

async function runMigrationWithConnection(connectionString: string) {
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const sqlPath = join(process.cwd(), MIGRATION_FILE);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log(`Applying ${MIGRATION_FILE} via ${url.hostname}:${url.port || '5432'}...`);
    await client.query(sql);

    const { rows } = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'quote_timeline_events'
    `);

    if (rows.length !== 1) {
      throw new Error('Expected quote_timeline_events table to exist after migration.');
    }

    console.log('Quote timeline events table applied and verified.');
  } finally {
    await client.end();
  }
}

async function main() {
  const connectionCandidates = getConnectionCandidates();
  if (connectionCandidates.length === 0) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

  let lastError: unknown;

  for (const connectionString of connectionCandidates) {
    try {
      await runMigrationWithConnection(connectionString);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('MaxClientsInSessionMode') ||
        connectionString === connectionCandidates[connectionCandidates.length - 1]
      ) {
        throw error;
      }
      console.warn('Primary session-mode connection is saturated, retrying with fallback connection...');
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
