import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const envFileFlagIndex = process.argv.indexOf('--env-file');
const envFile = envFileFlagIndex >= 0
  ? process.argv[envFileFlagIndex + 1]
  : '.env.local';

if (!envFile) {
  throw new Error('The --env-file option requires a file path');
}

dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const { Client } = pg;
const connectionString = process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  throw new Error('Missing POSTGRES_URL_NON_POOLING in the selected environment file');
}

function getConnectionConfig() {
  const url = new URL(connectionString as string);
  return {
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  };
}

async function main() {
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20260727_live_quote_merge.sql',
  );
  const client = new Client(getConnectionConfig());

  await client.connect();
  try {
    await client.query(fs.readFileSync(migrationPath, 'utf8'));

    const verification = await client.query<{
      merge_groups: string | null;
      aliases: string | null;
      snapshots: string | null;
      merge_function: string | null;
      consolidated_quote_id: string | null;
    }>(`
      SELECT
        to_regclass('public.quote_merge_groups')::TEXT AS merge_groups,
        to_regclass('public.quote_reference_aliases')::TEXT AS aliases,
        to_regclass('public.quote_pdf_snapshots')::TEXT AS snapshots,
        (
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'quote_merge_groups'
            AND column_name = 'consolidated_quote_id'
        ) AS consolidated_quote_id,
        to_regprocedure(
          'public.merge_live_quotes(uuid[],uuid,text,jsonb,jsonb,jsonb,uuid)'
        )::TEXT AS merge_function
    `);

    const row = verification.rows[0];
    if (
      !row?.merge_groups
      || !row.aliases
      || !row.snapshots
      || !row.merge_function
      || row.consolidated_quote_id !== 'consolidated_quote_id'
    ) {
      throw new Error('Live quote merge migration verification failed');
    }

    console.log('Live quote merge migration applied and verified.');
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(
    'Live quote merge migration failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
