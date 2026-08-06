import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260806_permission_access_mode_admin_settings_level_five.sql';

if (!connectionString) {
  console.error('Missing database connection string. Set POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local.');
  process.exit(1);
}

async function runMigration(conn: string) {
  const url = new URL(conn);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running permission access_mode + Admin Settings Level 5 migration...');
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    await client.query(sql);

    const { rows } = await client.query(`
      SELECT
        public.module_enforced_minimum_access_level('admin-settings') AS settings_min,
        public.module_enforced_minimum_access_level('toolbox-talks') AS toolbox_min,
        public.module_requires_full_access_role('admin-settings') AS settings_full_only,
        (
          SELECT access_mode
          FROM public.permission_modules
          WHERE module_name = 'reminders'
        ) AS reminders_access_mode,
        (
          SELECT access_mode
          FROM public.permission_modules
          WHERE module_name = 'timesheets'
        ) AS timesheets_access_mode
    `);

    const result = rows[0];
    if (Number(result?.settings_min || 0) !== 5) {
      throw new Error('Admin Settings Level 5 hard-rule verification failed.');
    }
    if (Number(result?.toolbox_min || 0) !== 4) {
      throw new Error('Toolbox Talks Level 4 hard-rule verification failed.');
    }
    if (result?.settings_full_only !== false) {
      throw new Error('Admin Settings must remain open to deliberate non-admin Level 5 overrides.');
    }
    if (result?.reminders_access_mode !== 'universal') {
      throw new Error('Reminders access_mode verification failed.');
    }
    if (result?.timesheets_access_mode !== 'team') {
      throw new Error('Default team access_mode verification failed.');
    }

    console.log('Permission access_mode + Admin Settings Level 5 migration complete.');
  } finally {
    await client.end();
  }
}

runMigration(connectionString).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
