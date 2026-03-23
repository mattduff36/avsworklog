import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260322_org_v2_final_legacy_cleanup.sql';

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
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
  try {
    const sqlPath = join(process.cwd(), MIGRATION_FILE);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log(`Applying ${MIGRATION_FILE}...`);
    await client.query(sql);

    const { rows: summaryRows } = await client.query<{
      label: string;
      count: string;
    }>(`
      SELECT 'legacy_roles_remaining' AS label, COUNT(*)::text AS count
      FROM roles
      WHERE lower(name) IN (
        'employee-civils',
        'employee-transport',
        'employee-groundworks',
        'employee-plant',
        'employee-workshop',
        'managing-director',
        'sheq-manager',
        'company-accountant-manager',
        'heavy-plant-earthworks-contracts-manager',
        'civils-project-manager',
        'civils-contracts-manager',
        'civils-manager',
        'transport-manager',
        'workshop-manager',
        'civils-site-managers-supervisors-manager'
      )
      UNION ALL
      SELECT 'legacy_team_modes_remaining' AS label, COUNT(*)::text AS count
      FROM org_team_feature_modes
      WHERE workflow_name = 'absence_leave'
        AND mode <> 'org_v2'
      UNION ALL
      SELECT 'inactive_teams_remaining' AS label, COUNT(*)::text AS count
      FROM org_teams
      WHERE active = FALSE
      UNION ALL
      SELECT 'active_teams_missing_permission_rows' AS label, COUNT(*)::text AS count
      FROM (
        SELECT t.id
        FROM org_teams t
        LEFT JOIN team_module_permissions tmp ON tmp.team_id = t.id
        WHERE t.active = TRUE
        GROUP BY t.id
        HAVING COUNT(tmp.module_name) = 0
      ) missing
    `);

    console.table(summaryRows);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
