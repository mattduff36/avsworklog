import { config } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS } from '../lib/inventory/check-interval-defaults';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260807180000_inventory_small_tools_check_interval.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

interface SnapshotRow {
  id: string;
  item_number: string;
  item_number_normalized: string;
  category: string;
  check_interval_days: number | null;
  name: string;
}

async function runMigration() {
  console.log('Running Small Tools check-interval + name cleanup migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();

    const { rows: beforeRows } = await client.query<SnapshotRow>(`
      SELECT
        id,
        item_number,
        item_number_normalized,
        category,
        check_interval_days,
        name
      FROM public.inventory_items
      WHERE category IS DISTINCT FROM 'minor_plant'
         OR category = 'minor_plant'
      ORDER BY item_number_normalized ASC, id ASC
    `);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotDir = resolve(process.cwd(), 'docs_private/inventory-check-interval-backfill');
    mkdirSync(snapshotDir, { recursive: true });
    const snapshotPath = resolve(
      snapshotDir,
      `small-tools-check-interval-before-${timestamp}.json`,
    );

    writeFileSync(
      snapshotPath,
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          exceptionAllowlist: SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS,
          rows: beforeRows,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    console.log(`Wrote pre-change snapshot: ${snapshotPath}`);

    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const exceptionList = [...SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS];

    const { rows: missingExceptions } = await client.query<{ item_number_normalized: string }>(
      `
        SELECT expected.item_number_normalized
        FROM unnest($1::text[]) AS expected(item_number_normalized)
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.inventory_items AS item
          WHERE item.item_number_normalized = expected.item_number_normalized
            AND item.category IS DISTINCT FROM 'minor_plant'
        )
      `,
      [exceptionList],
    );

    if (missingExceptions.length > 0) {
      throw new Error(
        `Missing exception item_number_normalized values: ${missingExceptions
          .map((row) => row.item_number_normalized)
          .join(', ')}`,
      );
    }

    const { rows: partitionRows } = await client.query<{
      null_or_30: number;
      exception_not_360: number;
      other_not_180: number;
      minor_plant_non_null: number;
      name_geny_left: number;
      name_lazer_left: number;
      name_sthil_left: number;
      snapshot_count: number;
    }>(`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM public.inventory_items
          WHERE category IS DISTINCT FROM 'minor_plant'
            AND (check_interval_days IS NULL OR check_interval_days = 30)
        ) AS null_or_30,
        (
          SELECT COUNT(*)::int
          FROM public.inventory_items
          WHERE category IS DISTINCT FROM 'minor_plant'
            AND item_number_normalized = ANY ($1::text[])
            AND check_interval_days IS DISTINCT FROM 360
        ) AS exception_not_360,
        (
          SELECT COUNT(*)::int
          FROM public.inventory_items
          WHERE category IS DISTINCT FROM 'minor_plant'
            AND item_number_normalized <> ALL ($1::text[])
            AND check_interval_days IS DISTINCT FROM 180
        ) AS other_not_180,
        (
          SELECT COUNT(*)::int
          FROM public.inventory_items
          WHERE category = 'minor_plant'
            AND check_interval_days IS NOT NULL
        ) AS minor_plant_non_null,
        (
          SELECT COUNT(*)::int
          FROM public.inventory_items
          WHERE category IS DISTINCT FROM 'minor_plant'
            AND name ~* '(^|[^A-Za-z0-9])(GENY|GENNEY)([^A-Za-z0-9]|$)'
        ) AS name_geny_left,
        (
          SELECT COUNT(*)::int
          FROM public.inventory_items
          WHERE category IS DISTINCT FROM 'minor_plant'
            AND name ~* '(^|[^A-Za-z0-9])LAZER([^A-Za-z0-9]|$)'
        ) AS name_lazer_left,
        (
          SELECT COUNT(*)::int
          FROM public.inventory_items
          WHERE category IS DISTINCT FROM 'minor_plant'
            AND name ~* '(^|[^A-Za-z0-9])STHIL([^A-Za-z0-9]|$)'
        ) AS name_sthil_left,
        (
          SELECT COUNT(*)::int
          FROM private.inventory_small_tools_interval_backfill_20260807
        ) AS snapshot_count
    `, [exceptionList]);

    const checks = partitionRows[0];
    if (!checks) throw new Error('Post-migration verification query returned no rows');

    if (checks.null_or_30 > 0) {
      throw new Error(`Found ${checks.null_or_30} Small Tools row(s) still NULL or 30 days`);
    }
    if (checks.exception_not_360 > 0) {
      throw new Error(`Found ${checks.exception_not_360} exception row(s) not at 360 days`);
    }
    if (checks.other_not_180 > 0) {
      throw new Error(`Found ${checks.other_not_180} non-exception Small Tools row(s) not at 180 days`);
    }
    if (checks.minor_plant_non_null > 0) {
      throw new Error(`Found ${checks.minor_plant_non_null} Minor Plant row(s) with non-null interval`);
    }
    if (checks.name_geny_left > 0 || checks.name_lazer_left > 0 || checks.name_sthil_left > 0) {
      throw new Error(
        `Name cleanup incomplete (GENY/GENNEY=${checks.name_geny_left}, LAZER=${checks.name_lazer_left}, STHIL=${checks.name_sthil_left})`,
      );
    }
    if (checks.snapshot_count < 1) {
      throw new Error('Expected private rollback snapshot rows for changed items');
    }

    const { rows: functionRows } = await client.query<{
      proname: string;
      prosecdef: boolean;
      prosrc: string;
    }>(`
      SELECT
        p.proname,
        p.prosecdef,
        pg_get_functiondef(p.oid) AS prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('inventory_record_check', 'inventory_kiosk_execute_transfer_basket')
      ORDER BY p.proname
    `);

    if (functionRows.length !== 2) {
      throw new Error(`Expected 2 functions, found ${functionRows.length}`);
    }

    for (const row of functionRows) {
      if (row.prosecdef) {
        throw new Error(`${row.proname} must remain SECURITY INVOKER`);
      }
      if (!row.prosrc.includes("CASE WHEN") || !row.prosrc.includes("minor_plant") || !row.prosrc.includes('180')) {
        throw new Error(`${row.proname} is missing category-aware interval fallback`);
      }
      if (row.prosrc.includes('COALESCE(v_item.check_interval_days, 30)')
        || row.prosrc.includes('COALESCE(item.check_interval_days, 30)')) {
        throw new Error(`${row.proname} still contains hardcoded 30-day COALESCE fallback`);
      }
    }

    for (const name of ['inventory_record_check', 'inventory_kiosk_execute_transfer_basket']) {
      const { rows: privilegeRows } = await client.query<{ ok: boolean }>(`
        SELECT has_function_privilege(
          'service_role',
          (
            SELECT p.oid
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = $1
            LIMIT 1
          ),
          'EXECUTE'
        ) AS ok
      `, [name]);
      if (!privilegeRows[0]?.ok) {
        throw new Error(`${name} is missing EXECUTE grant for service_role`);
      }
    }

    console.log(`Rollback snapshot rows: ${checks.snapshot_count}`);
    console.log('Small Tools check-interval + name cleanup migration completed.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Small Tools check-interval migration failed:', message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
