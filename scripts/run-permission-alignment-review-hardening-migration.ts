import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const migrationPath =
  'supabase/migrations/20260806_permission_alignment_review_hardening.sql';

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
    console.log('Running Permission Alignment review-hardening migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), migrationPath), 'utf-8'));

    const policies = await client.query<{
      tablename: string;
      policyname: string;
      with_check: string | null;
    }>(`
      SELECT tablename, policyname, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          (tablename = 'actions' AND cmd = 'INSERT')
          OR (tablename = 'timesheets' AND policyname IN (
            'Managers can create timesheets for any user',
            'Managers and admins can delete any timesheet'
          ))
        )
      ORDER BY tablename, policyname;
    `);

    const actionInserts = policies.rows.filter((row) => row.tablename === 'actions');
    const expectedActionInsertPolicies = new Set([
      'Actions level four can create actions',
      'Authenticated users can create constrained defect actions',
    ]);
    const unexpectedActionInserts = actionInserts.filter(
      (row) => !expectedActionInsertPolicies.has(row.policyname)
    );
    const levelFourPolicy = actionInserts.find(
      (row) => row.policyname === 'Actions level four can create actions'
    );
    const constrainedPolicy = actionInserts.find(
      (row) => row.policyname === 'Authenticated users can create constrained defect actions'
    );

    if (
      !levelFourPolicy ||
      !(levelFourPolicy.with_check || '').includes('effective_has_module_level') ||
      !constrainedPolicy ||
      !(constrainedPolicy.with_check || '').includes('action_type') ||
      !(constrainedPolicy.with_check || '').includes('created_by') ||
      unexpectedActionInserts.length > 0
    ) {
      throw new Error(
        `Actions INSERT policies were not hardened as expected${
          unexpectedActionInserts.length > 0
            ? `; unexpected policies: ${unexpectedActionInserts
                .map((row) => row.policyname)
                .join(', ')}`
            : ''
        }`
      );
    }

    const forbiddenTimesheetPolicies = policies.rows.filter((row) => row.tablename === 'timesheets');
    if (forbiddenTimesheetPolicies.length > 0) {
      throw new Error(
        `Broad timesheet policies remain: ${forbiddenTimesheetPolicies
          .map((row) => row.policyname)
          .join(', ')}`
      );
    }

    const triggers = await client.query<{ tgname: string }>(`
      SELECT tgname
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'trg_prevent_message_recipient_reassignment',
          'trg_prevent_rams_assignment_reassignment'
        );
    `);
    if (triggers.rows.length !== 2) {
      throw new Error('Identity-lock triggers were not created');
    }

    console.log('Review-hardening migration verified.');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
