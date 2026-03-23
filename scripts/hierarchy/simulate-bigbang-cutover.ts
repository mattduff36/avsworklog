import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const PILOT_TEAM = 'transport';

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

async function countBlockingIssuesForTeam(client: pg.Client, teamId: string): Promise<number> {
  const result = await client.query<{ issue_count: string }>(
    `
    SELECT COUNT(*)::text AS issue_count
    FROM profiles p
    LEFT JOIN roles r ON r.id = p.role_id
    WHERE p.team_id = $1
      AND (
        p.team_id IS NULL
        OR (
          COALESCE(r.role_class, 'employee') = 'employee'
          AND p.line_manager_id IS NULL
        )
        OR p.line_manager_id = p.id
      )
    `,
    [teamId]
  );
  return Number(result.rows[0]?.issue_count || 0);
}

async function setTeamMode(client: pg.Client, teamId: string, mode: 'legacy' | 'org_v2') {
  await client.query(
    `
    INSERT INTO org_team_feature_modes (team_id, workflow_name, mode, effective_from)
    VALUES ($1, 'absence_leave', $2, NOW())
    ON CONFLICT (team_id, workflow_name)
    DO UPDATE SET mode = EXCLUDED.mode, effective_from = EXCLUDED.effective_from, updated_at = NOW()
    `,
    [teamId, mode]
  );
}

async function assertApproveMatrix(client: pg.Client) {
  const requesterResult = await client.query<{
    id: string;
    full_name: string;
    line_manager_id: string;
    secondary_manager_id: string | null;
  }>(
    `
    SELECT p.id, p.full_name, p.line_manager_id, p.secondary_manager_id
    FROM profiles p
    JOIN roles r ON r.id = p.role_id
    WHERE p.team_id = $1
      AND p.line_manager_id IS NOT NULL
    ORDER BY
      CASE WHEN COALESCE(r.role_class, 'employee') = 'employee' THEN 0 ELSE 1 END,
      p.full_name
    LIMIT 1
    `,
    [PILOT_TEAM]
  );

  const requester = requesterResult.rows[0];
  if (!requester) {
    throw new Error('Smoke matrix failed: no pilot-team requester with a line manager was found.');
  }

  const crossManagerResult = await client.query<{ id: string }>(
    `
    SELECT p.id
    FROM profiles p
    JOIN roles r ON r.id = p.role_id
    WHERE COALESCE(r.role_class, 'employee') = 'manager'
      AND p.team_id IS DISTINCT FROM $1
      AND p.id <> $2
      AND ($3::UUID IS NULL OR p.id <> $3::UUID)
    ORDER BY p.full_name
    LIMIT 1
    `,
    [PILOT_TEAM, requester.line_manager_id, requester.secondary_manager_id]
  );

  const crossManagerId = crossManagerResult.rows[0]?.id;
  if (!crossManagerId) {
    throw new Error('Smoke matrix failed: no cross-team manager candidate was found.');
  }

  const lineManagerApproval = await client.query<{ allowed: boolean }>(
    'SELECT can_actor_approve_absence_request($1, $2) AS allowed',
    [requester.line_manager_id, requester.id]
  );
  const crossTeamApproval = await client.query<{ allowed: boolean }>(
    'SELECT can_actor_approve_absence_request($1, $2) AS allowed',
    [crossManagerId, requester.id]
  );

  if (!lineManagerApproval.rows[0]?.allowed) {
    throw new Error('Smoke matrix failed: direct line manager should approve pilot requester.');
  }
  if (crossTeamApproval.rows[0]?.allowed) {
    throw new Error('Smoke matrix failed: cross-team manager should be denied in org_v2.');
  }

  if (requester.secondary_manager_id) {
    const secondaryApproval = await client.query<{ allowed: boolean }>(
      'SELECT can_actor_approve_absence_request($1, $2) AS allowed',
      [requester.secondary_manager_id, requester.id]
    );
    if (!secondaryApproval.rows[0]?.allowed) {
      throw new Error('Smoke matrix failed: configured secondary manager should be allowed.');
    }
  }
}

async function verifyStrictBlockProbe(client: pg.Client) {
  const target = await client.query<{ id: string }>(
    `
    SELECT p.id
    FROM profiles p
    WHERE p.team_id = $1
      AND p.line_manager_id IS NOT NULL
    LIMIT 1
    `,
    [PILOT_TEAM]
  );
  const profileId = target.rows[0]?.id;
  if (!profileId) {
    throw new Error('Strict-block probe failed: no pilot-team profile found with a line manager.');
  }

  await client.query('BEGIN');
  await client.query('SAVEPOINT strict_block_probe');
  try {
    await client.query('UPDATE profiles SET line_manager_id = $1 WHERE id = $1', [profileId]);
    const issueCount = await countBlockingIssuesForTeam(client, PILOT_TEAM);
    if (issueCount < 1) {
      throw new Error('Strict-block probe failed: expected blocking issues after invalid mapping.');
    }
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT strict_block_probe');
    await client.query('COMMIT');
  }
}

async function main() {
  const client = await getClient();
  try {
    const blockingIssuesBefore = await countBlockingIssuesForTeam(client, PILOT_TEAM);
    if (blockingIssuesBefore > 0) {
      throw new Error(
        `Strict-block precheck failed: pilot team "${PILOT_TEAM}" has ${blockingIssuesBefore} issue(s).`
      );
    }

    await setTeamMode(client, PILOT_TEAM, 'org_v2');
    await assertApproveMatrix(client);
    await verifyStrictBlockProbe(client);

    // Rollback check: ensure team can be returned to legacy mode.
    await setTeamMode(client, PILOT_TEAM, 'legacy');

    console.log('Cutover simulation passed: pilot switch, smoke checks, strict-block probe, and rollback completed.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
