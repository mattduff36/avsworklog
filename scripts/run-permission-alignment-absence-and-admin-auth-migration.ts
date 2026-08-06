import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const migrationPath =
  'supabase/migrations/20260806_permission_alignment_absence_and_admin_auth.sql';

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
    console.log('Running Permission Alignment absence/admin-auth migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), migrationPath), 'utf-8'));

    const helper = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'effective_has_admin_full_access'
      ) AS exists;
    `);
    if (!helper.rows[0]?.exists) {
      throw new Error('effective_has_admin_full_access was not created');
    }

    const legacy = await client.query<{ policyname: string }>(`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'absences'
        AND policyname = 'Admins can manage all absences';
    `);
    if (legacy.rows.length > 0) {
      throw new Error('Legacy Admins can manage all absences policy still exists');
    }

    const ownPolicy = await client.query<{ with_check: string | null }>(`
      SELECT with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'absences'
        AND policyname = 'Users can update own pending future absences';
    `);
    const withCheck = ownPolicy.rows[0]?.with_check || '';
    if (!withCheck.includes('cancelled')) {
      throw new Error('Own-update absence policy does not constrain status transitions');
    }

    const trigger = await client.query<{ tgname: string }>(`
      SELECT tgname
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname = 'trg_enforce_absence_status_transition_auth';
    `);
    if (trigger.rows.length !== 1) {
      throw new Error('Absence status transition trigger was not created');
    }

    const timesheetFn = await client.query<{ prosrc: string }>(`
      SELECT prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'can_actor_authorise_timesheet';
    `);
    if (!(timesheetFn.rows[0]?.prosrc || '').includes('effective_has_admin_full_access')) {
      throw new Error('can_actor_authorise_timesheet missing admin full-access override');
    }

    console.log('Absence/admin-auth migration verified.');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
