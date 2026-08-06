import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

const EXPECTED_40106_LOCATION_ID = '8ccad4c8-b6fc-45a9-9f6d-edb685be3341';

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

async function verifyReadonly(client: pg.Client): Promise<Record<string, unknown>> {
  const missing = await client.query<{ count: string }>(`
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

  const duplicates = await client.query<{ count: string }>(`
    SELECT COUNT(*)::TEXT AS count
    FROM (
      SELECT UPPER(BTRIM(external_reference))
      FROM public.inventory_locations
      WHERE location_type = 'site'
        AND is_active = TRUE
        AND external_reference IS NOT NULL
      GROUP BY UPPER(BTRIM(external_reference))
      HAVING COUNT(*) > 1
    ) d
  `);

  const target = await client.query<{ id: string; source_id: string }>(`
    SELECT id, source_id::TEXT
    FROM public.inventory_locations
    WHERE location_type = 'site'
      AND is_active = TRUE
      AND source_type = 'quote'
      AND UPPER(BTRIM(external_reference)) = '40106-GH'
  `);

  const result = {
    missing_open_sites: Number(missing.rows[0]?.count || 0),
    duplicate_active_sites: Number(duplicates.rows[0]?.count || 0),
    target_40106_gh_count: target.rows.length,
    target_40106_gh_id: target.rows[0]?.id || null,
    target_40106_gh_id_preserved: target.rows[0]?.id === EXPECTED_40106_LOCATION_ID,
    ok: Number(missing.rows[0]?.count || 0) === 0
      && Number(duplicates.rows[0]?.count || 0) === 0
      && target.rows.length === 1
      && target.rows[0]?.id === EXPECTED_40106_LOCATION_ID,
  };
  return result;
}

async function verifyLifecycleRollback(client: pg.Client): Promise<Record<string, unknown>> {
  const suffix = Date.now().toString(36).toUpperCase();
  const reference = `QSL-TEST-${suffix}`;
  const quoteId = crypto.randomUUID();
  const customerIdResult = await client.query<{ id: string }>(`
    SELECT id FROM public.customers ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1
  `);
  const customerId = customerIdResult.rows[0]?.id;
  if (!customerId) {
    throw new Error('Lifecycle verification requires at least one customer row.');
  }

  await client.query('BEGIN');
  try {
    await client.query(
      `
      INSERT INTO public.quotes (
        id, quote_reference, base_quote_reference, quote_thread_id,
        customer_id, quote_date, validity_days, attention_name, attention_email,
        site_address, subject_line, project_description, scope,
        status, commercial_status, pricing_mode, subtotal, total,
        revision_number, revision_type, version_label, is_latest_version
      ) VALUES (
        $1, $2, $2, $1,
        $3, CURRENT_DATE, 30, 'Verify', 'verify@example.com',
        'Test Site Line', 'Lifecycle verify', 'Summary', 'Scope',
        'draft', 'open', 'attachments_only', 0, 0,
        0, 'original', 'Original', TRUE
      )
      `,
      [quoteId, reference, customerId]
    );

    // Deferred triggers fire at commit; force reconciliation now for in-transaction assert.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    const created = await client.query<{ id: string }>(`
      SELECT id
      FROM public.inventory_locations
      WHERE location_type = 'site'
        AND is_active = TRUE
        AND UPPER(BTRIM(external_reference)) = $1
    `, [reference]);

    if (created.rows.length !== 1) {
      throw new Error(`QSL-001 failed: expected 1 active site, found ${created.rows.length}`);
    }

    const locationId = created.rows[0].id;

    await client.query(`
      UPDATE public.quotes
      SET status = 'lost', updated_at = NOW()
      WHERE id = $1
    `, [quoteId]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    const archived = await client.query<{ is_active: boolean }>(`
      SELECT is_active FROM public.inventory_locations WHERE id = $1
    `, [locationId]);
    if (archived.rows[0]?.is_active !== false) {
      throw new Error('QSL-004 failed: lost quote did not archive site');
    }

    await client.query(`
      UPDATE public.quotes
      SET status = 'sent', commercial_status = 'open', updated_at = NOW()
      WHERE id = $1
    `, [quoteId]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    const reactivated = await client.query<{ id: string; is_active: boolean }>(`
      SELECT id, is_active FROM public.inventory_locations WHERE id = $1
    `, [locationId]);
    if (!reactivated.rows[0]?.is_active) {
      throw new Error('QSL-004 failed: reopen did not reactivate same location id');
    }

    const renamedReference = `${reference}-B`;
    await client.query(`
      UPDATE public.quotes
      SET quote_reference = $2, base_quote_reference = $2, updated_at = NOW()
      WHERE id = $1
    `, [quoteId, renamedReference]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    const oldSites = await client.query<{ is_active: boolean }>(`
      SELECT is_active FROM public.inventory_locations WHERE id = $1
    `, [locationId]);
    const newSites = await client.query<{ id: string }>(`
      SELECT id
      FROM public.inventory_locations
      WHERE location_type = 'site'
        AND is_active = TRUE
        AND UPPER(BTRIM(external_reference)) = $1
    `, [renamedReference]);
    if (oldSites.rows[0]?.is_active !== false) {
      throw new Error('QSL-011 failed: renamed-away reference left an active site');
    }
    if (newSites.rows.length !== 1) {
      throw new Error('QSL-011 failed: renamed quote did not create/activate new reference site');
    }

    await client.query(`
      INSERT INTO public.inventory_items (
        item_number, item_number_normalized, name, category, location_id, status
      ) VALUES (
        $1, $1, 'Protected stock fixture', 'minor_plant', $2, 'active'
      )
    `, [`QSL-STOCK-${suffix}`, newSites.rows[0].id]);

    let stockBlocked = false;
    await client.query('SAVEPOINT qsl_stock');
    try {
      await client.query(`
        UPDATE public.quotes SET status = 'lost', updated_at = NOW() WHERE id = $1
      `, [quoteId]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      stockBlocked = error instanceof Error && /protected stock/i.test(error.message);
      await client.query('ROLLBACK TO SAVEPOINT qsl_stock');
    }
    if (!stockBlocked) {
      throw new Error('QSL-012 failed: stock-bearing site archive was not blocked');
    }

    // QSL-010 style: project site identity transfers to converted quote.
    // Restore deferred mode so quote insert does not reconcile before conversion updates.
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    const projectReference = `8${String(Date.now()).slice(-4)}-QV`;
    const projectId = crypto.randomUUID();
    const convertedQuoteId = crypto.randomUUID();
    await client.query(`
      INSERT INTO public.quote_project_numbers (
        id, project_reference, status, title, description, manager_profile_id, requester_initials
      )
      SELECT
        $1::uuid,
        $2,
        'open',
        'Project convert',
        'Project convert desc',
        profiles.id,
        'QV'
      FROM public.profiles
      ORDER BY profiles.created_at DESC NULLS LAST, profiles.id DESC
      LIMIT 1
    `, [projectId, projectReference]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    const projectSite = await client.query<{ id: string }>(`
      SELECT id FROM public.inventory_locations
      WHERE location_type = 'site' AND is_active = TRUE AND UPPER(BTRIM(external_reference)) = $1
    `, [projectReference]);
    if (projectSite.rows.length !== 1) {
      throw new Error('QSL-010 setup failed: open project did not create site');
    }
    const projectLocationId = projectSite.rows[0].id;

    await client.query(
      `
      INSERT INTO public.quotes (
        id, quote_reference, base_quote_reference, quote_thread_id,
        customer_id, quote_date, validity_days, attention_name, attention_email,
        site_address, subject_line, project_description, scope,
        status, commercial_status, pricing_mode, subtotal, total,
        revision_number, revision_type, version_label, is_latest_version
      ) VALUES (
        $1, $2, $2, $1,
        $3, CURRENT_DATE, 30, 'Verify', 'verify@example.com',
        'Converted Site', 'Converted quote', 'Summary', 'Scope',
        'draft', 'open', 'attachments_only', 0, 0,
        0, 'original', 'Original', TRUE
      )
      `,
      [convertedQuoteId, projectReference, customerId]
    );
    await client.query(`
      UPDATE public.quote_project_numbers
      SET status = 'converted', converted_quote_id = $2, updated_at = NOW()
      WHERE id = $1
    `, [projectId, convertedQuoteId]);
    // Invoke reconciler after both quote insert and conversion update are visible.
    await client.query(`SELECT private.reconcile_quote_site_location($1, NULL)`, [projectReference]);

    const convertedSite = await client.query<{ id: string; source_type: string; source_id: string }>(`
      SELECT id, source_type, source_id::TEXT
      FROM public.inventory_locations
      WHERE location_type = 'site' AND UPPER(BTRIM(external_reference)) = $1
      ORDER BY is_active DESC
      LIMIT 1
    `, [projectReference]);
    if (
      convertedSite.rows[0]?.id !== projectLocationId
      || convertedSite.rows[0]?.source_type !== 'quote'
      || convertedSite.rows[0]?.source_id !== convertedQuoteId
    ) {
      throw new Error('QSL-010 failed: project site identity was not preserved/transferred to quote');
    }

    return {
      lifecycle_ok: true,
      reference,
      location_id: locationId,
      renamed_reference: renamedReference,
      stock_archive_blocked: stockBlocked,
      project_conversion_location_preserved: true,
      project_location_id: projectLocationId,
    };
  } finally {
    await client.query('ROLLBACK');
  }
}

async function verifyMergeAliasArchive(client: pg.Client): Promise<Record<string, unknown>> {
  const customer = await client.query<{ id: string }>(`
    SELECT id FROM public.customers ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1
  `);
  const actor = await client.query<{ id: string }>(`
    SELECT id FROM public.profiles ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1
  `);
  if (!customer.rows[0]?.id || !actor.rows[0]?.id) {
    throw new Error('Merge verification requires customer and profile rows.');
  }

  const survivorId = crypto.randomUUID();
  const aliasId = crypto.randomUUID();
  const survivorRef = `8${String(Date.now()).slice(-4)}-MS`;
  const aliasRef = `8${String(Date.now() + 1).slice(-4)}-MA`;
  const groupId = crypto.randomUUID();

  await client.query('BEGIN');
  try {
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    for (const row of [
      { id: survivorId, reference: survivorRef },
      { id: aliasId, reference: aliasRef },
    ]) {
      await client.query(
        `
        INSERT INTO public.quotes (
          id, quote_reference, base_quote_reference, quote_thread_id,
          customer_id, quote_date, validity_days, attention_name, attention_email,
          site_address, subject_line, project_description, scope,
          status, commercial_status, pricing_mode, subtotal, total,
          revision_number, revision_type, version_label, is_latest_version
        ) VALUES (
          $1, $2, $2, $1,
          $3, CURRENT_DATE, 30, 'Merge', 'merge@example.com',
          'Merge Site', 'Merge quote', 'Summary', 'Scope',
          'sent', 'open', 'attachments_only', 0, 0,
          0, 'original', 'Original', TRUE
        )
        `,
        [row.id, row.reference, customer.rows[0].id]
      );
    }
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    await client.query(`
      INSERT INTO public.quote_merge_groups (
        id, survivor_quote_thread_id, merge_mode, merged_by
      ) VALUES ($1, $2, 'grouped', $3)
    `, [groupId, survivorId, actor.rows[0].id]);
    await client.query(`
      INSERT INTO public.quote_merge_members (
        merge_group_id, quote_thread_id, source_latest_quote_id, base_quote_reference, is_survivor
      ) VALUES
        ($1, $2, $2, $3, TRUE),
        ($1, $4, $4, $5, FALSE)
    `, [groupId, survivorId, survivorRef, aliasId, aliasRef]);
    await client.query(`
      INSERT INTO public.quote_reference_aliases (
        alias_reference, merge_group_id, source_quote_thread_id, canonical_quote_thread_id, canonical_reference, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [aliasRef, groupId, aliasId, survivorId, survivorRef, actor.rows[0].id]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    const survivorSite = await client.query<{ is_active: boolean }>(`
      SELECT is_active FROM public.inventory_locations
      WHERE location_type = 'site' AND UPPER(BTRIM(external_reference)) = $1
    `, [survivorRef]);
    const aliasSite = await client.query<{ is_active: boolean }>(`
      SELECT is_active FROM public.inventory_locations
      WHERE location_type = 'site' AND UPPER(BTRIM(external_reference)) = $1
    `, [aliasRef]);

    if (survivorSite.rows[0]?.is_active !== true) {
      throw new Error('QSL-009 failed: survivor site is not active');
    }
    if (aliasSite.rows[0]?.is_active !== false) {
      throw new Error('QSL-009 failed: alias site was not archived');
    }

    return {
      merge_ok: true,
      survivor_reference: survivorRef,
      alias_reference: aliasRef,
    };
  } finally {
    await client.query('ROLLBACK');
  }
}

async function verifyStockConcurrencyGuard(connectionString: string): Promise<Record<string, unknown>> {
  const writer = createClient(connectionString);
  const archiver = createClient(connectionString);
  await writer.connect();
  await archiver.connect();

  const suffix = Date.now().toString(36).toUpperCase();
  const reference = `QSL-CONC-${suffix}`;
  const quoteId = crypto.randomUUID();

  try {
    const customer = await writer.query<{ id: string }>(`
      SELECT id FROM public.customers ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1
    `);
    if (!customer.rows[0]?.id) {
      throw new Error('Concurrency verification requires a customer row.');
    }

    await writer.query('BEGIN');
    await writer.query(
      `
      INSERT INTO public.quotes (
        id, quote_reference, base_quote_reference, quote_thread_id,
        customer_id, quote_date, validity_days, attention_name, attention_email,
        site_address, subject_line, project_description, scope,
        status, commercial_status, pricing_mode, subtotal, total,
        revision_number, revision_type, version_label, is_latest_version
      ) VALUES (
        $1, $2, $2, $1,
        $3, CURRENT_DATE, 30, 'Verify', 'verify@example.com',
        'Concurrency Site', 'Concurrency verify', 'Summary', 'Scope',
        'sent', 'open', 'attachments_only', 0, 0,
        0, 'original', 'Original', TRUE
      )
      `,
      [quoteId, reference, customer.rows[0].id]
    );
    await writer.query('SET CONSTRAINTS ALL IMMEDIATE');
    const location = await writer.query<{ id: string }>(`
      SELECT id FROM public.inventory_locations
      WHERE location_type = 'site' AND is_active = TRUE AND UPPER(BTRIM(external_reference)) = $1
    `, [reference]);
    if (location.rows.length !== 1) {
      throw new Error('Concurrency setup failed to create active site');
    }
    const locationId = location.rows[0].id;
    await writer.query('COMMIT');

    await archiver.query('BEGIN');
    await archiver.query(`SELECT private.archive_site_location_if_empty($1::uuid, NULL)`, [locationId]);

    let stockRejected = false;
    const blockedInsert = (async () => {
      await writer.query('BEGIN');
      await writer.query(`
        INSERT INTO public.inventory_items (
          item_number, item_number_normalized, name, category, location_id, status
        ) VALUES (
          $1, $1, 'Concurrent stock', 'minor_plant', $2, 'active'
        )
      `, [`QSL-CONC-ITEM-${suffix}`, locationId]);
      await writer.query('COMMIT');
    })();

    await new Promise((resolve) => setTimeout(resolve, 250));
    await archiver.query('COMMIT');

    try {
      await blockedInsert;
    } catch (error) {
      stockRejected = error instanceof Error && /inactive location/i.test(error.message);
      await writer.query('ROLLBACK').catch(() => undefined);
    }

    // Hardware quantity-only increase against inactive location must also fail.
    let hardwareRejected = false;
    const hardwareItem = await writer.query<{ id: string }>(`
      SELECT id FROM public.inventory_hardware_items WHERE is_active = TRUE ORDER BY sort_order, id LIMIT 1
    `);
    if (hardwareItem.rows[0]?.id) {
      await writer.query('BEGIN');
      await writer.query(`UPDATE public.inventory_locations SET is_active = TRUE, sync_status = 'synced' WHERE id = $1`, [locationId]);
      await writer.query(`
        INSERT INTO public.inventory_hardware_balances (hardware_item_id, location_id, quantity)
        VALUES ($1, $2, 0)
        ON CONFLICT (hardware_item_id, location_id) DO UPDATE SET quantity = 0
      `, [hardwareItem.rows[0].id, locationId]);
      await writer.query(`UPDATE public.inventory_locations SET is_active = FALSE, sync_status = 'archived' WHERE id = $1`, [locationId]);
      await writer.query('COMMIT');
      try {
        await writer.query('BEGIN');
        await writer.query(`
          UPDATE public.inventory_hardware_balances
          SET quantity = 1
          WHERE hardware_item_id = $1 AND location_id = $2
        `, [hardwareItem.rows[0].id, locationId]);
        await writer.query('COMMIT');
      } catch (error) {
        hardwareRejected = error instanceof Error && /inactive location/i.test(error.message);
        await writer.query('ROLLBACK').catch(() => undefined);
      }
    } else {
      hardwareRejected = true;
    }

    // Serialized reactivation on inactive location must fail.
    let reactivationRejected = false;
    try {
      await writer.query('BEGIN');
      // Temporarily reactivate location to insert inactive item, then archive again.
      await writer.query(`UPDATE public.inventory_locations SET is_active = TRUE, sync_status = 'synced' WHERE id = $1`, [locationId]);
      await writer.query(`
        INSERT INTO public.inventory_items (
          item_number, item_number_normalized, name, category, location_id, status
        ) VALUES (
          $1, $1, 'Retired fixture', 'minor_plant', $2, 'retired'
        )
      `, [`QSL-CONC-INACT-${suffix}`, locationId]);
      await writer.query(`UPDATE public.inventory_locations SET is_active = FALSE, sync_status = 'archived' WHERE id = $1`, [locationId]);
      await writer.query(`
        UPDATE public.inventory_items
        SET status = 'active'
        WHERE item_number_normalized = $1
      `, [`QSL-CONC-INACT-${suffix}`]);
      await writer.query('COMMIT');
    } catch (error) {
      reactivationRejected = error instanceof Error && /inactive location/i.test(error.message);
      await writer.query('ROLLBACK').catch(() => undefined);
    }

    await writer.query('BEGIN');
    await writer.query(`DELETE FROM public.inventory_items WHERE item_number_normalized IN ($1, $2)`, [
      `QSL-CONC-ITEM-${suffix}`,
      `QSL-CONC-INACT-${suffix}`,
    ]);
    await writer.query(`DELETE FROM public.inventory_hardware_balances WHERE location_id = $1`, [locationId]);
    await writer.query(`UPDATE public.quotes SET status = 'lost', commercial_status = 'closed' WHERE id = $1`, [quoteId]);
    await writer.query('SET CONSTRAINTS ALL IMMEDIATE');
    await writer.query('COMMIT');

    if (!stockRejected) {
      throw new Error('QSL-STOCK-CONCURRENCY failed: stock insert into archived location was not rejected');
    }
    if (!hardwareRejected) {
      throw new Error('QSL-HARDWARE-QUANTITY-CONCURRENCY failed: quantity increase on inactive location was not rejected');
    }
    if (!reactivationRejected) {
      throw new Error('QSL-SERIALIZED-REACTIVATION failed: activating item on inactive location was not rejected');
    }

    return {
      concurrency_ok: true,
      stock_rejected_on_inactive: stockRejected,
      hardware_quantity_rejected_on_inactive: hardwareRejected,
      serialized_reactivation_rejected_on_inactive: reactivationRejected,
      reference,
      location_id: locationId,
    };
  } finally {
    await writer.end().catch(() => undefined);
    await archiver.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const mode = process.argv.includes('--lifecycle')
    ? 'lifecycle'
    : process.argv.includes('--concurrency')
      ? 'concurrency'
      : 'readonly';
  const connectionString = getConnectionString();

  if (mode === 'concurrency') {
    const concurrency = await verifyStockConcurrencyGuard(connectionString);
    console.log(JSON.stringify({ mode, concurrency }, null, 2));
    return;
  }

  const client = createClient(connectionString);
  await client.connect();
  try {
    if (mode === 'readonly') {
      const result = await verifyReadonly(client);
      console.log(JSON.stringify({ mode, ...result }, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    const lifecycle = await verifyLifecycleRollback(client);
    const merge = await verifyMergeAliasArchive(client);
    const readonly = await verifyReadonly(client);
    await client.end();
    const concurrency = await verifyStockConcurrencyGuard(connectionString);
    console.log(JSON.stringify({ mode, lifecycle, merge, readonly, concurrency }, null, 2));
    if (!readonly.ok || !lifecycle.lifecycle_ok || !merge.merge_ok || !concurrency.concurrency_ok) {
      process.exitCode = 1;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
