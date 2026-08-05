import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) throw new Error('Missing database connection string');

interface Check {
  id: string;
  passed: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const checks: Check[] = [];
    const { rows: tableRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `, [[
      'payroll_rule_sets',
      'payroll_rule_versions',
      'payroll_rule_day_bands',
      'payroll_team_rule_assignments',
      'payroll_profile_rule_assignments',
      'payroll_rollout_activations',
      'timesheet_payroll_snapshots',
      'timesheet_payroll_snapshot_days',
    ]]);
    checks.push({
      id: 'PAY-MIGRATION-001',
      passed: Number(tableRows[0]?.count) === 8,
      detail: `${tableRows[0]?.count || 0}/8 payroll tables present`,
    });

    const { rows: ruleRows } = await client.query<{
      rule_key: string;
      status: string;
      band_count: string;
    }>(`
      SELECT rule_set.rule_key, version.status, COUNT(band.id)::text AS band_count
      FROM public.payroll_rule_sets rule_set
      JOIN public.payroll_rule_versions version
        ON version.rule_set_id = rule_set.id
       AND version.version_number = 1
      LEFT JOIN public.payroll_rule_day_bands band ON band.rule_version_id = version.id
      GROUP BY rule_set.rule_key, version.status
      ORDER BY rule_set.rule_key
    `);
    checks.push({
      id: 'PAY-VERSION-001',
      passed: ruleRows.length === 4 && ruleRows.every((row) => row.status === 'draft' && Number(row.band_count) === 7),
      detail: `${ruleRows.length}/4 signed drafts found; ${ruleRows.reduce((sum, row) => sum + Number(row.band_count), 0)}/28 day bands`,
    });

    const { rows: rolloutRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM public.payroll_rollout_activations
    `);
    checks.push({
      id: 'PAY-ROLLOUT-001',
      passed: Number(rolloutRows[0]?.count) === 0,
      detail: 'Rollout remains inactive pending admin-selected Sunday and assignments',
    });

    const { rows: triggerRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname = ANY($1::text[])
    `, [[
      'guard_timesheet_payroll_approval',
      'reject_payroll_snapshot_update_delete',
      'reject_payroll_snapshot_day_update_delete',
      'protect_activated_payroll_rule',
      'protect_activated_payroll_rule_band',
    ]]);
    checks.push({
      id: 'PAY-APPROVAL-GUARD-001',
      passed: Number(triggerRows[0]?.count) === 5,
      detail: `${triggerRows[0]?.count || 0}/5 approval and immutability triggers present`,
    });

    const { rows: policyRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
    `, [[
      'payroll_rule_sets',
      'payroll_rule_versions',
      'payroll_rule_day_bands',
      'payroll_team_rule_assignments',
      'payroll_profile_rule_assignments',
      'payroll_rollout_activations',
      'timesheet_payroll_snapshots',
      'timesheet_payroll_snapshot_days',
    ]]);
    checks.push({
      id: 'PAY-RLS-IMMUTABLE-001',
      passed: Number(policyRows[0]?.count) >= 12,
      detail: `${policyRows[0]?.count || 0} payroll RLS policies present`,
    });

    checks.forEach((check) => {
      console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`);
    });
    const failed = checks.filter((check) => !check.passed);
    if (failed.length > 0) {
      throw new Error(`${failed.length} payroll rollout verification check(s) failed`);
    }
    console.log('Payroll rollout preflight passed. Activation remains intentionally blocked in admin.');
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
