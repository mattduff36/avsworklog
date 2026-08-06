import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const migrationPath =
  'supabase/migrations/20260806_permission_alignment_approvals_supervisor_and_scopes.sql';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

interface PolicyRow {
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string | null;
}

interface FunctionRow {
  function_name: string;
  definition: string;
}

function requirePolicy(
  policies: PolicyRow[],
  tableName: string,
  policyName: string,
  expectedFunction: string
): void {
  const policy = policies.find(
    (candidate) =>
      candidate.tablename === tableName &&
      candidate.policyname === policyName &&
      candidate.cmd === 'SELECT'
  );
  if (!policy || !policy.qual?.includes(expectedFunction)) {
    throw new Error(
      `${tableName}.${policyName} must be a SELECT policy using ${expectedFunction}`
    );
  }
}

function requireFunction(
  functions: FunctionRow[],
  functionName: string,
  requiredFragments: string[]
): void {
  const functionRow = functions.find((candidate) => candidate.function_name === functionName);
  if (!functionRow) {
    throw new Error(`${functionName} was not created`);
  }

  const normalizedDefinition = functionRow.definition.toLowerCase();
  for (const fragment of requiredFragments) {
    if (!normalizedDefinition.includes(fragment.toLowerCase())) {
      throw new Error(`${functionName} is missing required condition: ${fragment}`);
    }
  }
}

async function runMigration(): Promise<void> {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Running Permission Alignment Phase 4 scoped-access migration...');
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), migrationPath), 'utf-8');
    await client.query(migrationSql);

    const minimumResult = await client.query<{
      configured_minimum: number;
      enforced_minimum: number;
    }>(`
      SELECT
        configured.hierarchy_rank AS configured_minimum,
        public.module_enforced_minimum_access_level('approvals') AS enforced_minimum
      FROM public.permission_modules pm
      JOIN public.roles configured ON configured.id = pm.minimum_role_id
      WHERE pm.module_name = 'approvals';
    `);
    const minimums = minimumResult.rows[0];
    if (
      Number(minimums?.configured_minimum || 0) !== 3 ||
      Number(minimums?.enforced_minimum || 0) !== 3
    ) {
      throw new Error('Approvals configured and enforced minimums must both be Level 3');
    }

    const functionResult = await client.query<FunctionRow>(`
      SELECT
        p.proname AS function_name,
        pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'absence_secondary_role_tier',
          'permission_alignment_effective_module_access_level',
          'permission_alignment_absence_secondary_effective_cell',
          'are_effective_actor_and_target_in_same_team',
          'effective_accounts_timesheet_full_visibility_override',
          'can_actor_authorise_timesheet',
          'can_actor_view_timesheet_entry',
          'can_actor_view_timesheet_entry_job_codes',
          'can_actor_view_employee_work_shift'
        );
    `);

    requireFunction(functionResult.rows, 'can_actor_authorise_timesheet', [
      "permission_alignment_effective_module_access_level('approvals') < 3",
      'auth.uid() = target_user_id',
      'authorise_bookings_all',
      'authorise_bookings_team',
      'are_effective_actor_and_target_in_same_team',
      'effective_accounts_timesheet_full_visibility_override',
    ]);
    requireFunction(functionResult.rows, 'permission_alignment_effective_module_access_level', [
      'view_as_role_id',
      'view_as_team_id',
      'role_on_team_module_access_level',
    ]);
    requireFunction(functionResult.rows, 'permission_alignment_absence_secondary_effective_cell', [
      'view_as_role_id',
      'view_as_team_id',
      'absence_secondary_default_cell',
      'absence_secondary_effective_cell',
    ]);
    requireFunction(functionResult.rows, 'absence_secondary_role_tier', [
      "effective_module_access_level('absence')",
      'user_module_access_level',
      "absence_level >= 3",
      "return 'supervisor'",
    ]);
    requireFunction(functionResult.rows, 'effective_accounts_timesheet_full_visibility_override', [
      'accounts',
      'manager',
      'supervisor',
    ]);
    requireFunction(functionResult.rows, 'can_actor_view_employee_work_shift', [
      "effective_module_access_level('absence') <= 0",
      'see_manage_work_shifts_all',
      'see_manage_work_shifts_team',
      'are_effective_actor_and_target_in_same_team',
    ]);

    const policyResult = await client.query<PolicyRow>(`
      SELECT tablename, policyname, cmd, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'timesheets',
          'timesheet_entries',
          'timesheet_entry_job_codes',
          'employee_work_shifts'
        )
      ORDER BY tablename, policyname;
    `);
    const policies = policyResult.rows;

    requirePolicy(
      policies,
      'timesheets',
      'Timesheet authorisers can view scoped timesheets',
      'can_actor_authorise_timesheet'
    );
    requirePolicy(
      policies,
      'timesheet_entries',
      'Timesheet viewers can view scoped entries',
      'can_actor_view_timesheet_entry'
    );
    requirePolicy(
      policies,
      'timesheet_entry_job_codes',
      'Timesheet viewers can view scoped entry job codes',
      'can_actor_view_timesheet_entry_job_codes'
    );
    requirePolicy(
      policies,
      'employee_work_shifts',
      'Absence scoped work shift viewers',
      'can_actor_view_employee_work_shift'
    );

    const forbiddenPolicies = new Set([
      'Managers can view all timesheets',
      'Managers can update timesheets',
      'Managers can view all timesheet entries',
      'Managers can delete any timesheet entries',
      'Managers can insert any timesheet entries',
      'Managers can update all entries',
      'Managers can update all timesheet entries',
      'Managers can delete any timesheet entry job codes',
      'Managers can insert any timesheet entry job codes',
      'Managers can update any timesheet entry job codes',
      'Managers can view all timesheet entry job codes',
      'Managers can view all employee work shifts',
      'Managers and users can view employee work shifts',
    ]);
    const remainingForbidden = policies.filter((policy) =>
      forbiddenPolicies.has(policy.policyname)
    );
    if (remainingForbidden.length > 0) {
      throw new Error(
        `Broad legacy policies remain: ${remainingForbidden
          .map((policy) => `${policy.tablename}.${policy.policyname}`)
          .join(', ')}`
      );
    }

    console.log('Migration and verification succeeded:');
    console.log('  - Approvals configured/enforced minimum is Level 3');
    console.log('  - timesheets and entries use scoped authoriser visibility');
    console.log('  - employee work shifts use absence-secondary team/all visibility');
    console.log('  - Accounts Supervisor/Manager override is present');
    console.log('  - broad manager SELECT/UPDATE policies are absent');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error('Permission Alignment Phase 4 migration failed:');
  console.error(error);
  process.exit(1);
});
