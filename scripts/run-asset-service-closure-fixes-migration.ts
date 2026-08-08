/**
 * Closure fixes: scoped subcategory reactivation + expanded service-state RLS trigger.
 *
 * Usage: npx tsx scripts/run-asset-service-closure-fixes-migration.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260808_asset_service_closure_fixes.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  process.exit(1);
}

async function main() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    const { rows } = await client.query<{ repair_active: string; non_repair_inactive: string }>(
      `
      SELECT
        (
          SELECT COUNT(*)::text
          FROM public.workshop_task_subcategories s
          JOIN public.workshop_task_categories c ON c.id = s.category_id
          WHERE s.is_active = TRUE
            AND c.name ILIKE 'Repair (Van)'
        ) AS repair_active,
        (
          SELECT COUNT(*)::text
          FROM public.workshop_task_subcategories s
          JOIN public.workshop_task_categories c ON c.id = s.category_id
          WHERE s.is_active = FALSE
            AND c.name NOT ILIKE 'Repair (Van)'
        ) AS non_repair_inactive
      `,
    );

    if (rows[0]?.repair_active !== '0' || rows[0]?.non_repair_inactive !== '0') {
      throw new Error(
        `Unexpected subcategory state repair_active=${rows[0]?.repair_active} non_repair_inactive=${rows[0]?.non_repair_inactive}`,
      );
    }

    console.log('✅ Asset service closure fixes migration applied');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void main();
