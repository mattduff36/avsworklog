import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import {
  buildQuoteSiteLocationName,
  decideRepairQuoteSiteLocation,
  getQuoteSiteLocationLabel,
  needsQuoteSiteMetadataSync,
  normalizeRepairExternalReference,
  parseRepairQuoteSiteCliArgs,
  type RepairQuoteRow,
  type RepairSiteLocationRow,
} from '../lib/server/repair-quote-site-location';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

interface DiscoveryRow {
  id: string;
  name: string;
  location_type: string;
  source_type: string | null;
  external_reference: string | null;
  is_active: boolean;
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/repair-quote-site-location.ts --quote-reference <REF> [--apply]

Defaults to dry-run. Pass --apply to write.`);
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

async function loadCanonicalQuote(
  client: pg.Client,
  reference: string
): Promise<RepairQuoteRow | null> {
  const { rows } = await client.query<RepairQuoteRow>(
    `
    SELECT
      id,
      quote_reference,
      base_quote_reference,
      status,
      commercial_status,
      site_address,
      subject_line,
      is_latest_version,
      revision_number,
      created_at,
      created_by,
      updated_by
    FROM public.quotes
    WHERE UPPER(BTRIM(COALESCE(base_quote_reference, quote_reference))) = $1
    ORDER BY
      is_latest_version DESC,
      revision_number DESC,
      created_at DESC,
      id DESC
    LIMIT 1
    FOR UPDATE
    `,
    [reference]
  );
  return rows[0] || null;
}

async function isRetiredMergeAlias(
  client: pg.Client,
  quote: RepairQuoteRow,
  reference: string
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `
    SELECT (
      EXISTS (
        SELECT 1
        FROM public.quote_reference_aliases alias
        WHERE alias.alias_reference = $1
      )
      OR EXISTS (
        SELECT 1
        FROM public.quote_merge_members member
        JOIN public.quotes quote
          ON quote.quote_thread_id = member.quote_thread_id
        WHERE quote.id = $2
          AND member.is_survivor = FALSE
      )
    ) AS exists
    `,
    [reference, quote.id]
  );
  return Boolean(rows[0]?.exists);
}

async function loadSiteLocations(
  client: pg.Client,
  reference: string
): Promise<RepairSiteLocationRow[]> {
  const { rows } = await client.query<RepairSiteLocationRow>(
    `
    SELECT
      id,
      name,
      description,
      is_active,
      location_type,
      source_type,
      source_id,
      external_reference,
      sync_status
    FROM public.inventory_locations
    WHERE location_type = 'site'
      AND UPPER(BTRIM(external_reference)) = $1
    ORDER BY is_active DESC, updated_at DESC, created_at DESC, id DESC
    FOR UPDATE
    `,
    [reference]
  );
  return rows;
}

async function verifyDiscoverable(
  client: pg.Client,
  locationId: string,
  reference: string
): Promise<DiscoveryRow | null> {
  const { rows } = await client.query<DiscoveryRow>(
    `
    SELECT
      id,
      name,
      location_type,
      source_type,
      external_reference,
      is_active
    FROM public.inventory_locations
    WHERE id = $1
      AND is_active = TRUE
      AND location_type = 'site'
      AND source_type IS DISTINCT FROM 'legacy_quote'
      AND UPPER(BTRIM(external_reference)) = $2
    LIMIT 1
    `,
    [locationId, reference]
  );
  return rows[0] || null;
}

async function countActiveSites(client: pg.Client, reference: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `
    SELECT COUNT(*)::TEXT AS count
    FROM public.inventory_locations
    WHERE is_active = TRUE
      AND location_type = 'site'
      AND UPPER(BTRIM(external_reference)) = $1
    `,
    [reference]
  );
  return Number(rows[0]?.count || 0);
}

async function main(): Promise<void> {
  const options = parseRepairQuoteSiteCliArgs(process.argv.slice(2));
  if (options.help || !options.quoteReference) {
    printUsage();
    if (!options.quoteReference && !options.help) {
      throw new Error('Provide --quote-reference <REF>.');
    }
    return;
  }

  const reference = normalizeRepairExternalReference(options.quoteReference);
  if (!reference) {
    throw new Error('Quote reference is empty after normalization.');
  }

  const client = createClient(getConnectionString());
  await client.connect();

  try {
    await client.query('BEGIN');
    // Match live-merge / project-alias lock ordering to avoid races and deadlocks.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      'quote-project-number-alias-write',
    ]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `quote-site-location:${reference}`,
    ]);

    const quote = await loadCanonicalQuote(client, reference);
    const locations = quote ? await loadSiteLocations(client, reference) : [];
    const retiredAlias = quote ? await isRetiredMergeAlias(client, quote, reference) : false;
    const decision = decideRepairQuoteSiteLocation({
      quote,
      reference,
      locations,
      isRetiredMergeAlias: retiredAlias,
    });

    console.log(JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      reference,
      quote: quote
        ? {
            id: quote.id,
            status: quote.status,
            commercial_status: quote.commercial_status,
            is_latest_version: quote.is_latest_version,
            revision_number: quote.revision_number,
            has_site_address: Boolean(quote.site_address?.trim()),
          }
        : null,
      existing_locations: locations.map((location) => ({
        id: location.id,
        is_active: location.is_active,
        source_type: location.source_type,
        source_id: location.source_id,
        sync_status: location.sync_status,
      })),
      decision,
    }, null, 2));

    if (!decision.safe) {
      await client.query('ROLLBACK');
      process.exitCode = 1;
      return;
    }

    if (!options.apply) {
      await client.query('ROLLBACK');
      console.log('Dry-run complete. Re-run with --apply to write.');
      return;
    }

    if (!quote) {
      throw new Error('Quote disappeared after decision.');
    }

    const label = getQuoteSiteLocationLabel(quote);
    const name = buildQuoteSiteLocationName(reference, label);
    const description = quote.site_address?.trim() || quote.subject_line?.trim() || null;
    const actorUserId = quote.updated_by || quote.created_by || null;
    const now = new Date().toISOString();
    let locationId: string;

    if (decision.action === 'unchanged') {
      locationId = decision.locationId;
      const current = locations.find((location) => location.id === locationId);
      if (!current) {
        throw new Error(`Active site ${locationId} disappeared under lock.`);
      }
      if (needsQuoteSiteMetadataSync({
        location: current,
        quote,
        reference,
        name,
        description,
      })) {
        await client.query(
          `
          UPDATE public.inventory_locations
          SET
            name = $2,
            description = $3,
            is_active = TRUE,
            location_type = 'site',
            source_type = 'quote',
            source_id = $4,
            external_reference = $5,
            sync_status = 'synced',
            source_synced_at = $6::timestamptz,
            linked_van_id = NULL,
            linked_hgv_id = NULL,
            linked_plant_id = NULL,
            updated_by = $7,
            updated_at = $6::timestamptz
          WHERE id = $1
          `,
          [locationId, name, description, quote.id, reference, now, actorUserId]
        );
      }
    } else if (decision.action === 'reactivate') {
      locationId = decision.locationId;
      await client.query(
        `
        UPDATE public.inventory_locations
        SET
          name = $2,
          description = $3,
          is_active = TRUE,
          location_type = 'site',
          source_type = 'quote',
          source_id = $4,
          external_reference = $5,
          sync_status = 'synced',
          source_synced_at = $6::timestamptz,
          linked_van_id = NULL,
          linked_hgv_id = NULL,
          linked_plant_id = NULL,
          updated_by = $7,
          updated_at = $6::timestamptz
        WHERE id = $1
        `,
        [locationId, name, description, quote.id, reference, now, actorUserId]
      );
    } else {
      const inserted = await client.query<{ id: string }>(
        `
        INSERT INTO public.inventory_locations (
          name,
          description,
          is_active,
          location_type,
          source_type,
          source_id,
          external_reference,
          sync_status,
          source_synced_at,
          linked_van_id,
          linked_hgv_id,
          linked_plant_id,
          created_by,
          updated_by
        ) VALUES (
          $1, $2, TRUE, 'site', 'quote', $3, $4, 'synced', $5::timestamptz,
          NULL, NULL, NULL, $6, $6
        )
        RETURNING id
        `,
        [name, description, quote.id, reference, now, actorUserId]
      );
      locationId = inserted.rows[0].id;
    }

    const activeCount = await countActiveSites(client, reference);
    if (activeCount !== 1) {
      throw new Error(`Postcondition failed: expected exactly 1 active site for ${reference}, found ${activeCount}.`);
    }

    const discovered = await verifyDiscoverable(client, locationId, reference);
    if (!discovered) {
      throw new Error(`Postcondition failed: active site ${locationId} is not discoverable for inventory selectors.`);
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      applied: true,
      reference,
      action: decision.action,
      location_id: locationId,
      discoverable: true,
      active_site_count: activeCount,
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
