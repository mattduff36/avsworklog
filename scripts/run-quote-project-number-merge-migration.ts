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
  throw new Error('Missing POSTGRES_URL_NON_POOLING in .env.local');
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
    'supabase/migrations/20260727_quote_project_number_merge.sql',
  );
  const client = new Client(getConnectionConfig());

  await client.connect();
  try {
    await client.query(fs.readFileSync(migrationPath, 'utf8'));

    const verification = await client.query<{
      merged_into_project_number_id: string;
      merged_at: string;
      merge_function: string;
    }>(`
      SELECT
        MAX(column_name) FILTER (
          WHERE table_name = 'quote_project_numbers'
            AND column_name = 'merged_into_project_number_id'
        ) AS merged_into_project_number_id,
        MAX(column_name) FILTER (
          WHERE table_name = 'quote_project_numbers'
            AND column_name = 'merged_at'
        ) AS merged_at,
        to_regprocedure(
          'public.convert_quote_project_numbers(uuid[],uuid,uuid[],jsonb,jsonb,uuid)'
        )::TEXT AS merge_function
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'quote_project_numbers'
    `);

    const row = verification.rows[0];
    if (
      row?.merged_into_project_number_id !== 'merged_into_project_number_id'
      || row?.merged_at !== 'merged_at'
      || !row?.merge_function
    ) {
      throw new Error('Project-number merge migration verification failed');
    }

    console.log('Quote project-number merge migration applied and verified.');
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(
    'Quote project-number merge migration failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
