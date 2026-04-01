import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260401_absence_processed_status_workflow.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log(`Applying migration: ${sqlFile}`);
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<{
      status_constraint: string;
      has_processed_by: boolean;
      has_processed_at: boolean;
    }>(`
      SELECT
        pg_get_constraintdef(c.oid) AS status_constraint,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'absences'
            AND column_name = 'processed_by'
        ) AS has_processed_by,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'absences'
            AND column_name = 'processed_at'
        ) AS has_processed_at
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'absences'
        AND c.conname = 'absences_status_check'
      LIMIT 1;
    `);

    const verification = rows[0];
    if (!verification) {
      throw new Error('Verification failed: absences_status_check was not found');
    }

    if (!verification.has_processed_by || !verification.has_processed_at) {
      throw new Error('Verification failed: processed audit columns missing on absences');
    }

    if (!verification.status_constraint.includes("'processed'")) {
      throw new Error('Verification failed: status constraint does not include processed');
    }

    console.log('Migration applied and verified successfully.');
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Migration failed:', pgError.message || String(error));
    if (pgError.detail) {
      console.error('Details:', pgError.detail);
    }
    if (pgError.hint) {
      console.error('Hint:', pgError.hint);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
