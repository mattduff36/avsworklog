import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260813_daily_allocation_module.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING in .env.local. Pooled POSTGRES_URL connections are not allowed for this migration.');
  process.exit(1);
}

if (/pooler/i.test(connectionString) || /:6543\b/.test(connectionString)) {
  console.error('Daily allocation migration requires a non-pooling session connection.');
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
    console.log('Running daily allocation module migration...');
    await client.connect();
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    await client.query(sql);

    const { rows } = await client.query<{
      labour_drafts: boolean;
      plant_drafts: boolean;
      publications: boolean;
      labour_items: boolean;
      plant_items: boolean;
      module_seeded: boolean;
      job_guard: boolean;
    }>(`
      SELECT
        to_regclass('public.daily_labour_allocation_drafts') IS NOT NULL AS labour_drafts,
        to_regclass('public.daily_plant_allocation_drafts') IS NOT NULL AS plant_drafts,
        to_regclass('public.daily_allocation_publications') IS NOT NULL AS publications,
        to_regclass('public.daily_allocation_labour_items') IS NOT NULL AS labour_items,
        to_regclass('public.daily_allocation_plant_items') IS NOT NULL AS plant_items,
        EXISTS (
          SELECT 1 FROM public.permission_modules WHERE module_name = 'daily-allocation'
        ) AS module_seeded,
        to_regprocedure('public.can_actor_manage_daily_allocation(uuid)') IS NOT NULL AS job_guard
    `);

    const result = rows[0];
    if (
      !result?.labour_drafts
      || !result.plant_drafts
      || !result.publications
      || !result.labour_items
      || !result.plant_items
      || !result.module_seeded
      || !result.job_guard
    ) {
      throw new Error('Daily allocation module migration verification failed.');
    }

    console.log('Daily allocation module migration complete.');
  } finally {
    await client.end();
  }
}

runMigration(connectionString).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
