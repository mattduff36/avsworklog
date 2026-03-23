import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260322_team_permission_matrix.sql';

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

    const { rows: roleRows } = await client.query<{
      name: string;
      hierarchy_rank: number | null;
    }>(`
      SELECT name, hierarchy_rank
      FROM roles
      WHERE name IN ('contractor', 'employee', 'supervisor', 'manager', 'admin')
      ORDER BY hierarchy_rank
    `);

    const { rows: moduleRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM permission_modules
    `);

    const { rows: teamRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM team_module_permissions
      WHERE enabled = TRUE
    `);

    if (roleRows.length < 5) {
      throw new Error(`Expected 5 seeded hierarchy roles, found ${roleRows.length}`);
    }

    if (Number(moduleRows[0]?.count || '0') < 19) {
      throw new Error('Expected seeded permission modules to be present');
    }

    console.log('Seeded hierarchy roles:');
    console.table(roleRows);
    console.log(`Permission modules seeded: ${moduleRows[0]?.count || '0'}`);
    console.log(`Enabled team-module assignments seeded: ${teamRows[0]?.count || '0'}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
