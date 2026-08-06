import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

interface CountRow {
  count: string;
}

interface ReferenceRow {
  reference: string;
  detail: string;
}

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

async function countQuery(client: pg.Client, sql: string): Promise<number> {
  const { rows } = await client.query<CountRow>(sql);
  return Number(rows[0]?.count || 0);
}

async function listQuery(client: pg.Client, sql: string): Promise<ReferenceRow[]> {
  const { rows } = await client.query<ReferenceRow>(sql);
  return rows;
}

async function main(): Promise<void> {
  const client = createClient(getConnectionString());
  await client.connect();

  try {
    const missingOpenSites = await countQuery(client, `
      WITH canonical AS (
        SELECT DISTINCT ON (UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))))
          UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))) AS reference,
          id,
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
      ),
      eligible AS (
        SELECT c.*
        FROM canonical c
        WHERE c.commercial_status <> 'closed'
          AND c.status NOT IN ('lost', 'closed')
          AND NOT EXISTS (
            SELECT 1
            FROM public.quote_reference_aliases alias
            WHERE alias.alias_reference = c.reference
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.quote_merge_members member
            WHERE member.quote_thread_id = c.quote_thread_id
              AND member.is_survivor = FALSE
          )
      )
      SELECT COUNT(*)::TEXT AS count
      FROM eligible e
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.inventory_locations loc
        WHERE loc.location_type = 'site'
          AND loc.is_active = TRUE
          AND UPPER(BTRIM(loc.external_reference)) = e.reference
      )
    `);

    const duplicateActiveRefs = await listQuery(client, `
      SELECT
        UPPER(BTRIM(external_reference)) AS reference,
        COUNT(*)::TEXT AS detail
      FROM public.inventory_locations
      WHERE location_type = 'site'
        AND is_active = TRUE
        AND external_reference IS NOT NULL
      GROUP BY UPPER(BTRIM(external_reference))
      HAVING COUNT(*) > 1
      ORDER BY reference
      LIMIT 50
    `);

    const foreignActiveCollisions = await listQuery(client, `
      WITH canonical AS (
        SELECT DISTINCT ON (UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))))
          UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))) AS reference,
          id
        FROM public.quotes
        WHERE NULLIF(BTRIM(COALESCE(base_quote_reference, quote_reference)), '') IS NOT NULL
          AND commercial_status <> 'closed'
          AND status NOT IN ('lost', 'closed')
        ORDER BY
          UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))),
          is_latest_version DESC,
          revision_number DESC,
          created_at DESC,
          id DESC
      )
      SELECT
        c.reference,
        COALESCE(loc.source_type, 'null') || ':' || COALESCE(loc.source_id::TEXT, 'null') AS detail
      FROM canonical c
      JOIN public.inventory_locations loc
        ON loc.location_type = 'site'
       AND loc.is_active = TRUE
       AND UPPER(BTRIM(loc.external_reference)) = c.reference
      WHERE loc.source_type IS DISTINCT FROM 'quote'
        AND loc.source_type IS DISTINCT FROM 'legacy_quote'
        AND NOT (
          loc.source_type = 'project_number'
          AND EXISTS (
            SELECT 1
            FROM public.quote_project_numbers project
            WHERE UPPER(BTRIM(project.project_reference)) = c.reference
              AND (
                (project.status = 'converted' AND project.converted_quote_id = c.id)
                OR project.status = 'open'
              )
          )
        )
      ORDER BY c.reference
      LIMIT 50
    `);

    const ambiguousArchived = await listQuery(client, `
      SELECT
        UPPER(BTRIM(external_reference)) AS reference,
        COUNT(*)::TEXT AS detail
      FROM public.inventory_locations
      WHERE location_type = 'site'
        AND is_active = FALSE
        AND source_type IN ('quote', 'legacy_quote')
        AND external_reference IS NOT NULL
      GROUP BY UPPER(BTRIM(external_reference))
      HAVING COUNT(*) > 1
      ORDER BY reference
      LIMIT 50
    `);

    const stockBearingArchiveCandidates = await listQuery(client, `
      WITH terminal AS (
        SELECT DISTINCT ON (UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))))
          UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))) AS reference
        FROM public.quotes
        WHERE NULLIF(BTRIM(COALESCE(base_quote_reference, quote_reference)), '') IS NOT NULL
          AND (commercial_status = 'closed' OR status IN ('lost', 'closed'))
        ORDER BY
          UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))),
          is_latest_version DESC,
          revision_number DESC,
          created_at DESC,
          id DESC
      )
      SELECT
        t.reference,
        loc.id::TEXT AS detail
      FROM terminal t
      JOIN public.inventory_locations loc
        ON loc.location_type = 'site'
       AND loc.is_active = TRUE
       AND UPPER(BTRIM(loc.external_reference)) = t.reference
      WHERE EXISTS (
          SELECT 1
          FROM public.inventory_items item
          WHERE item.location_id = loc.id
            AND item.status = 'active'
        )
        OR EXISTS (
          SELECT 1
          FROM public.inventory_hardware_balances balance
          WHERE balance.location_id = loc.id
            AND balance.quantity > 0
        )
      ORDER BY t.reference
      LIMIT 50
    `);

    const retiredAliasesTreatedCanonical = await countQuery(client, `
      SELECT COUNT(*)::TEXT AS count
      FROM public.quote_reference_aliases alias
      JOIN public.quotes quote
        ON UPPER(BTRIM(COALESCE(quote.base_quote_reference, quote.quote_reference))) = alias.alias_reference
       AND quote.is_latest_version = TRUE
      WHERE quote.commercial_status <> 'closed'
        AND quote.status NOT IN ('lost', 'closed')
    `);

    const blockers = [
      ...duplicateActiveRefs.map((row) => `duplicate-active:${row.reference}`),
      ...foreignActiveCollisions.map((row) => `foreign-active:${row.reference}`),
      ...ambiguousArchived.map((row) => `ambiguous-archived:${row.reference}`),
      ...stockBearingArchiveCandidates.map((row) => `stock-bearing-archive:${row.reference}`),
    ];

    const summary = {
      missing_open_sites: missingOpenSites,
      duplicate_active_references: duplicateActiveRefs.length,
      foreign_active_collisions: foreignActiveCollisions.length,
      ambiguous_archived_candidates: ambiguousArchived.length,
      stock_bearing_archive_candidates: stockBearingArchiveCandidates.length,
      retired_aliases_still_canonical_latest: retiredAliasesTreatedCanonical,
      sample_foreign_active: foreignActiveCollisions.slice(0, 10),
      sample_stock_bearing_archive: stockBearingArchiveCandidates.slice(0, 10),
      blocker_count: blockers.length,
      ok_to_migrate: blockers.length === 0,
    };

    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok_to_migrate) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
