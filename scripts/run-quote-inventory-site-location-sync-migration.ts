import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

const MIGRATION_FILE = 'supabase/migrations/20260806154324_quote_inventory_site_location_sync.sql';

function getConnectionString(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local');
  }
  return connectionString;
}

function createClient(connectionString: string): pg.Client {
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const client = createClient(getConnectionString());
  await client.connect();

  try {
    console.log('Running preflight counts...');
    const { rows: missingRows } = await client.query<{ count: string }>(`
      WITH canonical AS (
        SELECT DISTINCT ON (UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))))
          UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))) AS reference,
          status,
          commercial_status,
          quote_thread_id
        FROM public.quotes
        WHERE NULLIF(BTRIM(COALESCE(base_quote_reference, quote_reference)), '') IS NOT NULL
        ORDER BY
          UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))),
          is_latest_version DESC,
          revision_number DESC,
          created_at DESC,
          id DESC
      )
      SELECT COUNT(*)::TEXT AS count
      FROM canonical c
      WHERE c.commercial_status <> 'closed'
        AND c.status NOT IN ('lost', 'closed')
        AND NOT EXISTS (
          SELECT 1 FROM public.quote_reference_aliases alias
          WHERE alias.alias_reference = c.reference
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.quote_merge_members member
          WHERE member.quote_thread_id = c.quote_thread_id
            AND member.is_survivor = FALSE
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.inventory_locations loc
          WHERE loc.location_type = 'site'
            AND loc.is_active = TRUE
            AND UPPER(BTRIM(loc.external_reference)) = c.reference
        )
    `);

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      missing_open_sites_before: Number(missingRows[0]?.count || 0),
    }, null, 2));

    if (!apply) {
      console.log('Dry-run complete. Re-run with --apply after preflight approval.');
      return;
    }

    const sql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8');
    await client.query(sql);

    const { rows: afterMissing } = await client.query<{ count: string }>(`
      WITH canonical AS (
        SELECT DISTINCT ON (UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))))
          UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))) AS reference,
          status,
          commercial_status,
          quote_thread_id
        FROM public.quotes
        WHERE NULLIF(BTRIM(COALESCE(base_quote_reference, quote_reference)), '') IS NOT NULL
        ORDER BY
          UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))),
          is_latest_version DESC,
          revision_number DESC,
          created_at DESC,
          id DESC
      )
      SELECT COUNT(*)::TEXT AS count
      FROM canonical c
      WHERE c.commercial_status <> 'closed'
        AND c.status NOT IN ('lost', 'closed')
        AND NOT EXISTS (
          SELECT 1 FROM public.quote_reference_aliases alias
          WHERE alias.alias_reference = c.reference
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.quote_merge_members member
          WHERE member.quote_thread_id = c.quote_thread_id
            AND member.is_survivor = FALSE
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.inventory_locations loc
          WHERE loc.location_type = 'site'
            AND loc.is_active = TRUE
            AND UPPER(BTRIM(loc.external_reference)) = c.reference
        )
    `);

    const { rows: target } = await client.query<{ id: string; source_id: string }>(`
      SELECT id, source_id::TEXT
      FROM public.inventory_locations
      WHERE location_type = 'site'
        AND is_active = TRUE
        AND source_type = 'quote'
        AND UPPER(BTRIM(external_reference)) = '40106-GH'
    `);

    console.log(JSON.stringify({
      applied: true,
      missing_open_sites_after: Number(afterMissing[0]?.count || 0),
      target_40106_gh: target[0] || null,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
