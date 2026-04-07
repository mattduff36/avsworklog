import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260407_consolidate_safe_permissive_policies.sql';

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

    const { rows } = await client.query<{ duplicate_command_rows: string }>(`
      SELECT COUNT(*)::text AS duplicate_command_rows
      FROM (
        SELECT tablename, cmd
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
            'absence_allowance_carryovers',
            'admin_error_notification_prefs',
            'employee_work_shifts',
            'messages',
            'vans'
          )
        GROUP BY tablename, cmd
        HAVING COUNT(*) > 1
      ) duplicates;
    `);

    const duplicateCommandRows = Number(rows[0]?.duplicate_command_rows || '0');
    if (duplicateCommandRows !== 0) {
      throw new Error(
        `Verification failed: expected 0 duplicate permissive command rows on safe-consolidation tables, found ${duplicateCommandRows}`
      );
    }

    console.log('Safe permissive-policy consolidation verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
