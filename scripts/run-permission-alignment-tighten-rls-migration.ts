import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import pg from 'pg';

const { Client } = pg;

const migrationPath = 'supabase/migrations/20260806_permission_alignment_tighten_rls.sql';

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
  with_check: string | null;
}

function policyExpression(policy: PolicyRow): string {
  return `${policy.qual ?? ''} ${policy.with_check ?? ''}`.toLowerCase();
}

function assertPolicyUsesModuleLevel(
  policy: PolicyRow | undefined,
  moduleName: string,
  minimumLevel: number,
  description: string
): void {
  if (!policy) {
    throw new Error(`${description} policy was not found`);
  }

  const expression = policyExpression(policy);
  if (
    !expression.includes('effective_has_module_level')
    || !expression.includes(`'${moduleName}'`)
    || !expression.includes(String(minimumLevel))
  ) {
    throw new Error(`${description} is not gated by ${moduleName} Level ${minimumLevel}`);
  }
}

async function runMigration(): Promise<void> {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Running Permission Alignment Phase 3 RLS migration...');
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), migrationPath), 'utf-8');
    await client.query(migrationSql);

    const helperResult = await client.query<{ helper_exists: boolean }>(`
      SELECT to_regprocedure(
        'public.effective_has_module_level(text,integer)'
      ) IS NOT NULL AS helper_exists;
    `);

    if (helperResult.rows[0]?.helper_exists !== true) {
      throw new Error('effective_has_module_level(text, integer) was not created');
    }

    const policyResult = await client.query<PolicyRow>(`
      SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('vans', 'actions', 'messages', 'message_recipients')
      ORDER BY tablename, policyname;
    `);
    const policies = policyResult.rows;

    const vansInsertPolicies = policies.filter(
      (policy) => policy.tablename === 'vans' && policy.cmd === 'INSERT'
    );
    const vansAllPolicies = policies.filter(
      (policy) => policy.tablename === 'vans' && policy.cmd === 'ALL'
    );
    if (vansAllPolicies.length > 0) {
      throw new Error(
        `Unexpected permissive vans ALL policies remain: ${vansAllPolicies
          .map((policy) => policy.policyname)
          .join(', ')}`
      );
    }
    if (vansInsertPolicies.length !== 1) {
      throw new Error(`Expected one vans INSERT policy, found ${vansInsertPolicies.length}`);
    }
    assertPolicyUsesModuleLevel(
      vansInsertPolicies[0],
      'admin-vans',
      4,
      'vans INSERT'
    );
    if (policyExpression(vansInsertPolicies[0]).includes('auth.uid() is not null')) {
      throw new Error('vans INSERT still contains an auth-only policy condition');
    }

    const actionsSelect = policies.find(
      (policy) =>
        policy.tablename === 'actions'
        && policy.policyname === 'Managers can view all actions'
        && policy.cmd === 'SELECT'
    );
    assertPolicyUsesModuleLevel(actionsSelect, 'actions', 4, 'actions management SELECT');

    const expectedMessageManagementPolicies = new Map<string, string>([
      ['messages:Managers can create messages', 'INSERT'],
      ['messages:Managers can view their messages', 'SELECT'],
      ['messages:Managers can update messages', 'UPDATE'],
      ['messages:Managers can delete messages', 'DELETE'],
      ['message_recipients:Managers can create recipients', 'INSERT'],
      ['message_recipients:Managers can view all recipients', 'SELECT'],
      ['message_recipients:Managers can update recipients', 'UPDATE'],
    ]);

    for (const [key, command] of expectedMessageManagementPolicies) {
      const [tableName, policyName] = key.split(':');
      const policy = policies.find(
        (candidate) =>
          candidate.tablename === tableName
          && candidate.policyname === policyName
          && candidate.cmd === command
      );
      assertPolicyUsesModuleLevel(
        policy,
        'toolbox-talks',
        4,
        `${tableName}.${policyName}`
      );
    }

    console.log('Migration and verification succeeded:');
    console.log('  - effective_has_module_level(text, integer) exists');
    console.log('  - vans INSERT is admin-vans Level 4 and is not auth-only');
    console.log('  - actions management SELECT is actions Level 4');
    console.log('  - messages management is toolbox-talks Level 4');
  } finally {
    await client.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error('Permission Alignment Phase 3 migration failed:');
  console.error(error);
  process.exit(1);
});
