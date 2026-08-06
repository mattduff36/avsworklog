import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const migrationPath =
  'supabase/migrations/20260806_permission_alignment_absence_profile_lock.sql';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

async function runMigration(): Promise<void> {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running Permission Alignment absence profile-lock migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), migrationPath), 'utf-8'));

    const trigger = await client.query<{ tgname: string }>(`
      SELECT tgname
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname = 'trg_prevent_absence_profile_reassignment';
    `);
    if (trigger.rows.length !== 1) {
      throw new Error('Absence profile-lock trigger was not created');
    }

    const fn = await client.query<{ prosrc: string }>(`
      SELECT prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'enforce_absence_status_transition_auth';
    `);
    if (!(fn.rows[0]?.prosrc || '').includes('OLD.profile_id')) {
      throw new Error('Status transition auth does not evaluate OLD.profile_id owner');
    }

    console.log('Absence profile-lock migration verified.');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
