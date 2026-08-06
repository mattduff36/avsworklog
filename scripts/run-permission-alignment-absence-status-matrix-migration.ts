import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const migrationPath =
  'supabase/migrations/20260806_permission_alignment_absence_status_matrix.sql';

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
    console.log('Running Permission Alignment absence status-matrix migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), migrationPath), 'utf-8'));

    const fn = await client.query<{ prosrc: string }>(`
      SELECT prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'enforce_absence_status_transition_auth';
    `);
    const source = fn.rows[0]?.prosrc || '';
    if (!source.includes("NEW.status = 'processed'")) {
      throw new Error('Status matrix does not require approval auth for processed transitions');
    }
    if (!source.includes('Unsupported absence status transition')) {
      throw new Error('Status matrix does not fail closed on unknown transitions');
    }
    if (source.includes('can_actor_edit_absence_request') && source.includes('approved') && !source.includes('cancelled')) {
      throw new Error('Unexpected edit-permission fallback for approval transitions');
    }

    console.log('Absence status-matrix migration verified.');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
