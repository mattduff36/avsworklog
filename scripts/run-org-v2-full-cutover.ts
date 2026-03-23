import { config } from 'dotenv';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

type CutoverStep = {
  label: string;
  command: string;
  args: string[];
};

export const FULL_ORG_V2_CUTOVER_STEPS: CutoverStep[] = [
  {
    label: 'Apply Org V2 hierarchy schema',
    command: 'npx',
    args: ['tsx', 'scripts/run-org-hierarchy-bigbang-migration.ts'],
  },
  {
    label: 'Validate database after hierarchy schema',
    command: 'npm',
    args: ['run', 'db:validate'],
  },
  {
    label: 'Apply team permission matrix schema',
    command: 'npx',
    args: ['tsx', 'scripts/run-team-permission-matrix-migration.ts'],
  },
  {
    label: 'Apply manager slots and placeholders schema',
    command: 'npx',
    args: ['tsx', 'scripts/run-team-manager-slots-placeholders-migration.ts'],
  },
  {
    label: 'Validate database after Org V2 schema migrations',
    command: 'npm',
    args: ['run', 'db:validate'],
  },
  {
    label: 'Seed canonical teams and core roles',
    command: 'npx',
    args: ['tsx', 'scripts/hierarchy/migrate-to-six-teams-and-core-roles.ts'],
  },
  {
    label: 'Backfill normalized hierarchy data',
    command: 'npx',
    args: ['tsx', 'scripts/hierarchy/backfill-organogram-hierarchy.ts'],
  },
  {
    label: 'Sync profile bridge columns',
    command: 'npx',
    args: ['tsx', 'scripts/hierarchy/sync-profile-hierarchy-bridges.ts'],
  },
  {
    label: 'Create placeholder managers',
    command: 'npx',
    args: ['tsx', 'scripts/hierarchy/ensure-placeholder-managers.ts'],
  },
  {
    label: 'Apply canonical team managers',
    command: 'npx',
    args: ['tsx', 'scripts/hierarchy/apply-team-line-managers.ts'],
  },
  {
    label: 'Remove legacy teams',
    command: 'npx',
    args: ['tsx', 'scripts/hierarchy/remove-legacy-teams.ts'],
  },
  {
    label: 'Validate database after full cutover',
    command: 'npm',
    args: ['run', 'db:validate'],
  },
];

const LEGACY_TEAM_IDS = [
  'civils_ops',
  'civils_projects',
  'executive',
  'finance_payroll',
  'heavy_plant_earthworks',
  'workshop_yard',
] as const;

const CANONICAL_TEAM_IDS = ['accounts', 'civils', 'plant', 'sheq', 'transport', 'workshop'] as const;

function runStep(step: CutoverStep) {
  console.log(`\n==> ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Step failed: ${step.label}`);
  }
}

async function getClient(): Promise<pg.Client> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local');
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
  return client;
}

async function runFinalVerification() {
  const client = await getClient();
  try {
    const { rows: legacyTeams } = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM org_teams
      WHERE id = ANY($1::text[])
      `,
      [LEGACY_TEAM_IDS]
    );

    const { rows: canonicalTeams } = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM org_teams
      WHERE id = ANY($1::text[])
      `,
      [CANONICAL_TEAM_IDS]
    );

    const { rows: missingTeamProfiles } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM profiles
      WHERE is_placeholder IS NOT TRUE
        AND team_id IS NULL
    `);

    const { rows: missingRoleProfiles } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM profiles
      WHERE is_placeholder IS NOT TRUE
        AND role_id IS NULL
    `);

    const { rows: invalidTeamManagers } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM org_teams t
      JOIN profiles p
        ON p.id IN (t.manager_1_profile_id, t.manager_2_profile_id)
      LEFT JOIN roles r ON r.id = p.role_id
      WHERE COALESCE(r.role_class, 'employee') NOT IN ('admin', 'manager')
    `);

    const { rows: managerOwnManagers } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM profiles p
      JOIN roles r ON r.id = p.role_id
      WHERE r.role_class IN ('admin', 'manager')
        AND (p.line_manager_id IS NOT NULL OR p.secondary_manager_id IS NOT NULL)
    `);

    const { rows: teamPermissionRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM team_module_permissions
      WHERE enabled = TRUE
    `);

    const verification = {
      legacyTeamsRemaining: Number(legacyTeams[0]?.count || '0'),
      canonicalTeamsPresent: Number(canonicalTeams[0]?.count || '0'),
      profilesMissingTeam: Number(missingTeamProfiles[0]?.count || '0'),
      profilesMissingRole: Number(missingRoleProfiles[0]?.count || '0'),
      invalidTeamManagers: Number(invalidTeamManagers[0]?.count || '0'),
      managersWithOwnManagers: Number(managerOwnManagers[0]?.count || '0'),
      enabledTeamPermissions: Number(teamPermissionRows[0]?.count || '0'),
    };

    console.table(verification);

    if (verification.legacyTeamsRemaining > 0) {
      throw new Error('Legacy teams are still present after cutover.');
    }
    if (verification.canonicalTeamsPresent < CANONICAL_TEAM_IDS.length) {
      throw new Error('Not all canonical Org V2 teams are present after cutover.');
    }
    if (verification.profilesMissingTeam > 0) {
      throw new Error('Some active non-placeholder profiles still have no team assignment.');
    }
    if (verification.profilesMissingRole > 0) {
      throw new Error('Some active non-placeholder profiles still have no role assignment.');
    }
    if (verification.invalidTeamManagers > 0) {
      throw new Error('One or more teams still reference a non-manager/non-admin as a manager.');
    }
    if (verification.managersWithOwnManagers > 0) {
      throw new Error('Managers or admins still have line managers assigned.');
    }
    if (verification.enabledTeamPermissions === 0) {
      throw new Error('No enabled team-module permissions were found after cutover.');
    }
  } finally {
    await client.end();
  }
}

async function main() {
  for (const step of FULL_ORG_V2_CUTOVER_STEPS) {
    runStep(step);
  }

  console.log('\n==> Run final Org V2 verification');
  await runFinalVerification();
  console.log('\nFull Org V2 cutover completed and verified.');
}

if (process.argv[1]?.includes('run-org-v2-full-cutover.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
