import { createHash } from 'crypto';
import type { Client } from 'pg';

export type SensitiveInventoryActor =
  | 'self'
  | 'same-team'
  | 'out-of-team'
  | 'admin'
  | 'Accounts'
  | 'service-role';

export interface SensitiveInventorySurface {
  kind:
    | 'rls_policy'
    | 'status_transition'
    | 'ownership_field'
    | 'report_endpoint'
    | 'report_aggregate'
    | 'actor';
  id: string;
  details: Record<string, string>;
}

export interface SensitiveInventoryResult {
  profile: 'timesheets-pay';
  mode: 'live-readonly' | 'fixture' | 'dry';
  status: 'passed' | 'failed' | 'unknown';
  summary: string;
  surfaces: SensitiveInventorySurface[];
  requiredBehavioralTestIds: string[];
  fingerprint: string;
  mutatingSqlDetected: boolean;
}

export const TIMESHEETS_PAY_ACTORS: SensitiveInventoryActor[] = [
  'self',
  'same-team',
  'out-of-team',
  'admin',
  'Accounts',
  'service-role',
];

export const TIMESHEETS_PAY_BEHAVIORAL_TEST_IDS = [
  'WF-PAY-ACTOR-001',
  'WF-PAY-MUTATION-001',
  'WF-PAY-REPORT-001',
  'WF-PAY-LIVE-001',
  'WF-PAY-INVENTORY-001',
] as const;

const MUTATING_SQL_PATTERN =
  /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|CALL|DO)\b/iu;

function fingerprintSurfaces(surfaces: SensitiveInventorySurface[]): string {
  return createHash('sha256')
    .update(
      surfaces
        .map((surface) => `${surface.kind}:${surface.id}:${JSON.stringify(surface.details)}`)
        .sort()
        .join('\n')
    )
    .digest('hex')
    .slice(0, 32);
}

function assertReadOnlySql(sql: string): void {
  if (MUTATING_SQL_PATTERN.test(sql)) {
    throw new Error(`mutating SQL is forbidden in live inventory: ${sql.slice(0, 120)}`);
  }
}

export function buildFixtureTimesheetsPayInventory(): SensitiveInventoryResult {
  const surfaces: SensitiveInventorySurface[] = [
    {
      kind: 'rls_policy',
      id: 'timesheets_select_team',
      details: { table: 'timesheets', cmd: 'SELECT', permissive: 'true' },
    },
    {
      kind: 'rls_policy',
      id: 'timesheets_update_approver',
      details: { table: 'timesheets', cmd: 'UPDATE', permissive: 'true' },
    },
    {
      kind: 'status_transition',
      id: 'pending->approved',
      details: { table: 'timesheets', from: 'pending', to: 'approved' },
    },
    {
      kind: 'status_transition',
      id: 'pending->rejected',
      details: { table: 'timesheets', from: 'pending', to: 'rejected' },
    },
    {
      kind: 'status_transition',
      id: 'pending->processed',
      details: { table: 'timesheets', from: 'pending', to: 'processed' },
    },
    {
      kind: 'ownership_field',
      id: 'timesheets.profile_id',
      details: { table: 'timesheets', column: 'profile_id' },
    },
    {
      kind: 'ownership_field',
      id: 'timesheets.manager_id',
      details: { table: 'timesheets', column: 'manager_id' },
    },
    {
      kind: 'report_endpoint',
      id: '/api/reports/stats',
      details: { method: 'GET' },
    },
    {
      kind: 'report_aggregate',
      id: 'reports.stats.hours_by_team',
      details: { endpoint: '/api/reports/stats' },
    },
    ...TIMESHEETS_PAY_ACTORS.map(
      (actor): SensitiveInventorySurface => ({
        kind: 'actor',
        id: actor,
        details: { matrix: 'timesheets-pay' },
      })
    ),
  ];

  return {
    profile: 'timesheets-pay',
    mode: 'fixture',
    status: 'passed',
    summary: `fixture inventory surfaces=${surfaces.length}`,
    surfaces,
    requiredBehavioralTestIds: [...TIMESHEETS_PAY_BEHAVIORAL_TEST_IDS],
    fingerprint: fingerprintSurfaces(surfaces),
    mutatingSqlDetected: false,
  };
}

export async function runLiveTimesheetsPayInventory(params: {
  client: Pick<Client, 'query'>;
  statementTimeoutMs?: number;
}): Promise<SensitiveInventoryResult> {
  const timeoutMs = params.statementTimeoutMs ?? 10_000;
  const surfaces: SensitiveInventorySurface[] = [];
  let mutatingSqlDetected = false;

  const run = async (sql: string, values: unknown[] = []) => {
    assertReadOnlySql(sql);
    if (MUTATING_SQL_PATTERN.test(sql)) mutatingSqlDetected = true;
    return params.client.query(sql, values);
  };

  try {
    await run('BEGIN TRANSACTION READ ONLY');
    await run(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);

    const policies = await run(`
      SELECT schemaname, tablename, policyname, permissive, roles::text AS roles, cmd
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          tablename ILIKE '%timesheet%'
          OR tablename ILIKE '%absence%'
          OR tablename ILIKE '%payroll%'
          OR tablename ILIKE '%report%'
        )
        AND lower(permissive) = 'permissive'
      ORDER BY tablename, policyname
    `);

    for (const row of policies.rows as Array<Record<string, string>>) {
      surfaces.push({
        kind: 'rls_policy',
        id: `${row.tablename}.${row.policyname}`,
        details: {
          table: row.tablename,
          cmd: row.cmd,
          roles: row.roles,
          permissive: row.permissive,
        },
      });
    }

    const ownership = await run(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          table_name ILIKE '%timesheet%'
          OR table_name ILIKE '%absence%'
          OR table_name ILIKE '%payroll%'
        )
        AND column_name IN (
          'profile_id', 'user_id', 'employee_id', 'manager_id', 'team_id', 'owner_id', 'approved_by'
        )
      ORDER BY table_name, column_name
    `);
    for (const row of ownership.rows as Array<Record<string, string>>) {
      surfaces.push({
        kind: 'ownership_field',
        id: `${row.table_name}.${row.column_name}`,
        details: { table: row.table_name, column: row.column_name },
      });
    }

    const statusColumns = await run(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          table_name ILIKE '%timesheet%'
          OR table_name ILIKE '%absence%'
          OR table_name ILIKE '%payroll%'
        )
        AND column_name IN ('status', 'approval_status', 'payroll_status')
      ORDER BY table_name, column_name
    `);
    for (const row of statusColumns.rows as Array<Record<string, string>>) {
      surfaces.push({
        kind: 'status_transition',
        id: `${row.table_name}.${row.column_name}`,
        details: { table: row.table_name, column: row.column_name },
      });
    }

    // Migration/schema fingerprint only — never mutate.
    const schemaFingerprint = await run(`
      SELECT md5(string_agg(table_name || ':' || column_name, ',' ORDER BY table_name, column_name)) AS fingerprint
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `);
    const fingerprintValue =
      (schemaFingerprint.rows[0] as { fingerprint?: string } | undefined)?.fingerprint ?? 'unknown';

    for (const actor of TIMESHEETS_PAY_ACTORS) {
      surfaces.push({
        kind: 'actor',
        id: actor,
        details: { matrix: 'timesheets-pay' },
      });
    }

    surfaces.push({
      kind: 'report_endpoint',
      id: '/api/reports/stats',
      details: { method: 'GET' },
    });
    surfaces.push({
      kind: 'report_aggregate',
      id: 'reports.stats',
      details: { schemaFingerprint: fingerprintValue.slice(0, 16) },
    });

    await run('ROLLBACK');
  } catch (error) {
    try {
      await params.client.query('ROLLBACK');
    } catch {
      // ignore
    }
    return {
      profile: 'timesheets-pay',
      mode: 'live-readonly',
      status: 'failed',
      summary: error instanceof Error ? error.message : String(error),
      surfaces,
      requiredBehavioralTestIds: [...TIMESHEETS_PAY_BEHAVIORAL_TEST_IDS],
      fingerprint: fingerprintSurfaces(surfaces),
      mutatingSqlDetected,
    };
  }

  return {
    profile: 'timesheets-pay',
    mode: 'live-readonly',
    status: mutatingSqlDetected ? 'failed' : 'passed',
    summary: `live inventory surfaces=${surfaces.length}`,
    surfaces,
    requiredBehavioralTestIds: [...TIMESHEETS_PAY_BEHAVIORAL_TEST_IDS],
    fingerprint: fingerprintSurfaces(surfaces),
    mutatingSqlDetected,
  };
}

export function validateTimesheetsPayInventoryCompleteness(
  result: SensitiveInventoryResult
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!result.surfaces.some((surface) => surface.kind === 'rls_policy')) {
    missing.push('rls_policy');
  }
  if (!result.surfaces.some((surface) => surface.kind === 'status_transition')) {
    missing.push('status_transition');
  }
  if (!result.surfaces.some((surface) => surface.kind === 'ownership_field')) {
    missing.push('ownership_field');
  }
  if (!result.surfaces.some((surface) => surface.kind === 'report_endpoint')) {
    missing.push('report_endpoint');
  }
  if (!result.surfaces.some((surface) => surface.kind === 'report_aggregate')) {
    missing.push('report_aggregate');
  }
  for (const actor of TIMESHEETS_PAY_ACTORS) {
    if (!result.surfaces.some((surface) => surface.kind === 'actor' && surface.id === actor)) {
      missing.push(`actor:${actor}`);
    }
  }
  if (result.mutatingSqlDetected) missing.push('mutating_sql');
  return { ok: missing.length === 0, missing };
}
