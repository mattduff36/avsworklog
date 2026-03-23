import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

const MIGRATION_FILES = [
  'supabase/migrations/20260320_org_hierarchy_core_tables.sql',
  'supabase/migrations/20260320_org_hierarchy_functions.sql',
  'supabase/migrations/20260320_org_hierarchy_absence_rls.sql',
];

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
    for (const migrationFile of MIGRATION_FILES) {
      const sqlPath = join(process.cwd(), migrationFile);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`Applying ${migrationFile}...`);
      await client.query(sql);
    }

    const { rows: tableRows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'org_teams',
          'profile_team_memberships',
          'profile_reporting_lines',
          'org_team_feature_modes',
          'org_hierarchy_change_log'
        )
      ORDER BY table_name
    `);
    if (tableRows.length !== 5) {
      throw new Error(`Expected 5 hierarchy tables, found ${tableRows.length}`);
    }

    const { rows: profileColumns } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name IN ('team_id', 'line_manager_id', 'secondary_manager_id')
      ORDER BY column_name
    `);
    if (profileColumns.length !== 3) {
      throw new Error(`Expected 3 bridge columns on profiles, found ${profileColumns.length}`);
    }

    const { rows: functionRows } = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN (
          'effective_team_mode',
          'is_actor_admin',
          'is_actor_manager_admin',
          'is_actor_line_manager_of',
          'can_actor_access_absence_request',
          'can_actor_approve_absence_request'
        )
      ORDER BY routine_name
    `);
    if (functionRows.length !== 6) {
      throw new Error(`Expected 6 hierarchy functions, found ${functionRows.length}`);
    }

    const { rows: policyRows } = await client.query(`
      SELECT polname
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      WHERE c.relname = 'absences'
        AND polname IN (
          'Managers can view scoped absences',
          'Managers can update scoped absences',
          'Managers can create scoped absences'
        )
      ORDER BY polname
    `);
    if (policyRows.length !== 3) {
      throw new Error(`Expected 3 scoped absence policies, found ${policyRows.length}`);
    }

    console.log('Org hierarchy big-bang migrations applied and verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
