import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260807163000_inventory_location_directory_type_filter.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory location directory type filter migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows: signatureRows } = await client.query<{
      oid: number;
      arg_types: string;
      has_default: boolean;
    }>(`
      SELECT
        p.oid,
        pg_get_function_identity_arguments(p.oid) AS arg_types,
        pg_get_function_arguments(p.oid) ILIKE '%p_location_types%DEFAULT%' AS has_default
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'inventory_search_locations'
    `);

    if (signatureRows.length !== 1) {
      throw new Error(
        `Expected exactly one inventory_search_locations signature, found ${signatureRows.length}`,
      );
    }

    const signature = signatureRows[0];
    const normalizedArgTypes = signature.arg_types
      .replace(/\bp_\w+\s+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalizedArgTypes !== 'text, boolean, integer, integer, text[]') {
      throw new Error(
        `Unexpected inventory_search_locations signature: ${signature.arg_types}`,
      );
    }
    if (!signature.has_default) {
      throw new Error('p_location_types must default to NULL for four-argument caller compatibility');
    }

    const { rows: nullFilterRows } = await client.query<{ total_count: string }>(`
      SELECT total_count
      FROM public.inventory_search_locations('', FALSE, 1, 0, NULL)
      LIMIT 1
    `);
    const { rows: emptyFilterRows } = await client.query<{ total_count: string }>(`
      SELECT total_count
      FROM public.inventory_search_locations('', FALSE, 1, 0, ARRAY[]::TEXT[])
      LIMIT 1
    `);
    const { rows: legacyCallerRows } = await client.query<{ total_count: string }>(`
      SELECT total_count
      FROM public.inventory_search_locations('', FALSE, 1, 0)
      LIMIT 1
    `);

    const nullTotal = Number.parseInt(nullFilterRows[0]?.total_count || '0', 10);
    const emptyTotal = Number.parseInt(emptyFilterRows[0]?.total_count || '0', 10);
    const legacyTotal = Number.parseInt(legacyCallerRows[0]?.total_count || '0', 10);

    if (nullTotal !== emptyTotal || nullTotal !== legacyTotal) {
      throw new Error(
        `Null/empty/four-arg totals diverge: null=${nullTotal}, empty=${emptyTotal}, legacy=${legacyTotal}`,
      );
    }

    const { rows: directVanCountRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::TEXT AS count
      FROM public.inventory_locations AS il
      WHERE il.is_active = TRUE
        AND il.source_type IS DISTINCT FROM 'legacy_quote'
        AND il.location_type = 'van'
    `);
    const { rows: rpcVanCountRows } = await client.query<{ total_count: string }>(`
      SELECT total_count
      FROM public.inventory_search_locations('', FALSE, 1, 0, ARRAY['van']::TEXT[])
      LIMIT 1
    `);
    const directVanCount = Number.parseInt(directVanCountRows[0]?.count || '0', 10);
    const rpcVanCount = Number.parseInt(rpcVanCountRows[0]?.total_count || '0', 10);
    if (directVanCount !== rpcVanCount) {
      throw new Error(
        `Van type filter total mismatch: direct=${directVanCount}, rpc=${rpcVanCount}`,
      );
    }

    if (directVanCount > 0) {
      const { rows: vanSampleRows } = await client.query<{ location_type: string }>(`
        SELECT location_type
        FROM public.inventory_search_locations('', FALSE, 5, 0, ARRAY['van']::TEXT[])
      `);
      if (vanSampleRows.length === 0) {
        throw new Error('Van type filter returned no rows despite a non-zero van total');
      }
      if (vanSampleRows.some((row) => row.location_type !== 'van')) {
        throw new Error('Van type filter returned unexpected location_type values');
      }
    }

    const { rows: mixedTypeRows } = await client.query<{ location_type: string }>(`
      SELECT DISTINCT location_type
      FROM (
        SELECT location_type
        FROM public.inventory_search_locations('', FALSE, 5, 0, ARRAY['van']::TEXT[])
        UNION ALL
        SELECT location_type
        FROM public.inventory_search_locations('', FALSE, 5, 0, ARRAY['site']::TEXT[])
      ) AS filtered_types
    `);
    if (mixedTypeRows.some((row) => row.location_type !== 'van' && row.location_type !== 'site')) {
      throw new Error('Type filter returned unexpected location_type values');
    }

    const { rows: impossibleTypeRows } = await client.query<{ total_count: string }>(`
      SELECT COALESCE(MAX(total_count), 0)::TEXT AS total_count
      FROM public.inventory_search_locations(
        '',
        FALSE,
        1,
        0,
        ARRAY['__no_such_inventory_location_type__']::TEXT[]
      )
    `);
    if (Number.parseInt(impossibleTypeRows[0]?.total_count || '0', 10) !== 0) {
      throw new Error('Type filter failed to exclude non-matching location types');
    }

    console.log('Inventory location directory type filter migration completed.');
  } catch (error) {
    console.error(
      'Inventory location directory type filter migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
