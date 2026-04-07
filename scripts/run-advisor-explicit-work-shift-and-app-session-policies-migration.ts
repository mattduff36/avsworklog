import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260407_add_explicit_work_shift_and_app_session_policies.sql';

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

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
    const migrationSql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8');
    console.log(`Applying ${MIGRATION_FILE}...`);
    await client.query(migrationSql);

    const { rows } = await client.query<{
      table_name: string;
      policy_count: string;
    }>(`
      SELECT
        c.relname AS table_name,
        COUNT(p.policyname)::text AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policies p
        ON p.schemaname = n.nspname
       AND p.tablename = c.relname
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'app_auth_sessions',
          'work_shift_templates',
          'work_shift_template_slots',
          'employee_work_shifts'
        )
      GROUP BY c.relname
      ORDER BY c.relname;
    `);

    if (rows.length !== 4 || rows.some((row) => Number(row.policy_count) === 0)) {
      throw new Error('Verification failed: expected explicit policies on all four remediated tables');
    }

    for (const row of rows) {
      console.log(`${row.table_name}: ${row.policy_count} policies`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
