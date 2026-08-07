import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

const describeDb = connectionString ? describe : describe.skip;

describeDb('inventory_record_check database integrity', () => {
  const url = new URL(connectionString!);

  function createClient() {
    return new Client({
      host: url.hostname,
      port: Number.parseInt(url.port || '5432', 10),
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: { rejectUnauthorized: false },
    });
  }

  const client = createClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  async function withRollback(run: () => Promise<void>) {
    await client.query('BEGIN');
    try {
      await run();
    } finally {
      await client.query('ROLLBACK');
    }
  }

  async function cleanupItem(itemId: string) {
    await client.query('SET session_replication_role = replica');
    await client.query('DELETE FROM public.inventory_check_history WHERE item_id = $1', [itemId]);
    await client.query('DELETE FROM public.inventory_items WHERE id = $1', [itemId]);
    await client.query('SET session_replication_role = DEFAULT');
  }

  function asDateOnly(value: Date | string): string {
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    const text = String(value);
    const match = text.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return asDateOnly(parsed);
    }

    return text;
  }

  async function createTempItem() {
    const location = await client.query<{ id: string }>(`
      SELECT id
      FROM public.inventory_locations
      WHERE is_active = TRUE
      ORDER BY created_at ASC
      LIMIT 1
    `);
    const locationId = location.rows[0]?.id;
    expect(locationId).toBeTruthy();

    const category = await client.query<{ slug: string }>(`
      SELECT slug
      FROM public.inventory_item_categories
      WHERE is_active = TRUE
      ORDER BY name ASC
      LIMIT 1
    `);
    const categorySlug = category.rows[0]?.slug;
    expect(categorySlug).toBeTruthy();

    const actor = await client.query<{ id: string }>(`
      SELECT id
      FROM public.profiles
      ORDER BY created_at ASC
      LIMIT 1
    `);
    const actorId = actor.rows[0]?.id;
    expect(actorId).toBeTruthy();

    const itemNumber = `TMP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO public.inventory_items (
        item_number,
        item_number_normalized,
        name,
        category,
        location_id,
        last_checked_at,
        check_interval_days,
        status,
        created_by,
        updated_by
      )
      VALUES (
        $1,
        lower($1),
        'Temporary integrity item',
        $2,
        $3,
        '2026-01-01',
        30,
        'active',
        $4,
        $4
      )
      RETURNING id
    `, [itemNumber, categorySlug, locationId, actorId]);

    return {
      itemId: inserted.rows[0].id,
      actorId: actorId!,
    };
  }

  it('INV-CHECK-TXN-001 persists history and authoritative item date atomically', async () => {
    await withRollback(async () => {
      const { itemId, actorId } = await createTempItem();
      const submissionId = randomUUID();

      const { rows } = await client.query(`
        SELECT *
        FROM public.inventory_record_check(
          $1::uuid,
          '2026-06-01'::date,
          $2::uuid,
          'txn test',
          NULL,
          NULL,
          NULL,
          FALSE,
          $3::uuid
        )
      `, [itemId, actorId, submissionId]);

      expect(rows).toHaveLength(1);
      expect(asDateOnly(rows[0].checked_at)).toBe('2026-06-01');

      const item = await client.query<{ last_checked_at: Date | string }>(
        'SELECT last_checked_at FROM public.inventory_items WHERE id = $1',
        [itemId],
      );
      expect(asDateOnly(item.rows[0].last_checked_at)).toBe('2026-06-01');
    });
  });

  it('INV-CHECK-IDEMP-001 returns the same check for a repeated submission id', async () => {
    await withRollback(async () => {
      const { itemId, actorId } = await createTempItem();
      const submissionId = randomUUID();

      const first = await client.query(`
        SELECT id, checked_at
        FROM public.inventory_record_check(
          $1::uuid, '2026-06-01'::date, $2::uuid, NULL, NULL, NULL, NULL, FALSE, $3::uuid
        )
      `, [itemId, actorId, submissionId]);

      const second = await client.query(`
        SELECT id, checked_at
        FROM public.inventory_record_check(
          $1::uuid, '2026-06-02'::date, $2::uuid, NULL, NULL, NULL, NULL, TRUE, $3::uuid
        )
      `, [itemId, actorId, submissionId]);

      expect(second.rows[0].id).toBe(first.rows[0].id);

      const historyCount = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM public.inventory_check_history WHERE item_id = $1',
        [itemId],
      );
      expect(historyCount.rows[0].count).toBe('1');
    });
  });

  it('INV-CHECK-TXN-002 rolls back history when synchronization fails', async () => {
    await withRollback(async () => {
      const { itemId, actorId } = await createTempItem();

      await client.query(`
        CREATE OR REPLACE FUNCTION pg_temp.block_last_checked_sync()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          IF NEW.last_checked_at IS DISTINCT FROM OLD.last_checked_at THEN
            RAISE EXCEPTION 'forced sync failure';
          END IF;
          RETURN NEW;
        END;
        $fn$;
      `);
      await client.query(`
        CREATE TRIGGER trg_temp_block_last_checked_sync
        BEFORE UPDATE OF last_checked_at ON public.inventory_items
        FOR EACH ROW
        EXECUTE FUNCTION pg_temp.block_last_checked_sync();
      `);

      await client.query('SAVEPOINT before_forced_sync_failure');
      await expect(client.query(`
        SELECT public.inventory_record_check(
          $1::uuid, '2026-06-01'::date, $2::uuid, NULL, NULL, NULL, NULL, FALSE, $3::uuid
        )
      `, [itemId, actorId, randomUUID()])).rejects.toThrow(/forced sync failure/i);
      await client.query('ROLLBACK TO SAVEPOINT before_forced_sync_failure');

      const historyCount = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM public.inventory_check_history WHERE item_id = $1',
        [itemId],
      );
      expect(historyCount.rows[0].count).toBe('0');
    });
  });

  it('INV-CHECK-CONC-001 keeps the authoritative date at the maximum checked_at under concurrency', async () => {
    const { itemId, actorId } = await createTempItem();
    const clientA = createClient();
    const clientB = createClient();
    await clientA.connect();
    await clientB.connect();

    try {
      await Promise.all([
        clientA.query(`
          SELECT public.inventory_record_check(
            $1::uuid, '2026-06-10'::date, $2::uuid, NULL, NULL, NULL, NULL, TRUE, $3::uuid
          )
        `, [itemId, actorId, randomUUID()]),
        clientB.query(`
          SELECT public.inventory_record_check(
            $1::uuid, '2026-06-01'::date, $2::uuid, NULL, NULL, NULL, NULL, FALSE, $3::uuid
          )
        `, [itemId, actorId, randomUUID()]),
      ]);

      const item = await client.query<{ last_checked_at: Date | string }>(
        'SELECT last_checked_at FROM public.inventory_items WHERE id = $1',
        [itemId],
      );
      expect(asDateOnly(item.rows[0].last_checked_at)).toBe('2026-06-10');

      const historyCount = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM public.inventory_check_history WHERE item_id = $1',
        [itemId],
      );
      expect(historyCount.rows[0].count).toBe('2');
    } finally {
      await clientA.end();
      await clientB.end();
      await cleanupItem(itemId);
    }
  });

  it('INV-CHECK-GUARD-001 blocks divergent history-backed last_checked updates and allows no-history edits', async () => {
    await withRollback(async () => {
      const { itemId, actorId } = await createTempItem();

      await expect(client.query(
        `UPDATE public.inventory_items SET last_checked_at = '2026-02-01' WHERE id = $1`,
        [itemId],
      )).resolves.toBeTruthy();

      await client.query(`
        SELECT public.inventory_record_check(
          $1::uuid, '2026-06-01'::date, $2::uuid, NULL, NULL, NULL, NULL, FALSE, $3::uuid
        )
      `, [itemId, actorId, randomUUID()]);

      await expect(client.query(
        `UPDATE public.inventory_items SET last_checked_at = '2026-02-01' WHERE id = $1`,
        [itemId],
      )).rejects.toThrow(/INVENTORY_LAST_CHECKED_HISTORY_MISMATCH|check_violation/i);
    });
  });

  it('INV-CHECK-HISTORY-001 blocks history updates and deletes', async () => {
    await withRollback(async () => {
      const { itemId, actorId } = await createTempItem();
      const inserted = await client.query<{ id: string }>(`
        SELECT id
        FROM public.inventory_record_check(
          $1::uuid, '2026-06-01'::date, $2::uuid, NULL, NULL, NULL, NULL, FALSE, $3::uuid
        )
      `, [itemId, actorId, randomUUID()]);

      await client.query('SAVEPOINT before_history_update');
      await expect(client.query(
        `UPDATE public.inventory_check_history SET note = 'changed' WHERE id = $1`,
        [inserted.rows[0].id],
      )).rejects.toThrow(/INVENTORY_CHECK_HISTORY_APPEND_ONLY|check_violation/i);
      await client.query('ROLLBACK TO SAVEPOINT before_history_update');

      await client.query('SAVEPOINT before_history_delete');
      await expect(client.query(
        `DELETE FROM public.inventory_check_history WHERE id = $1`,
        [inserted.rows[0].id],
      )).rejects.toThrow(/INVENTORY_CHECK_HISTORY_APPEND_ONLY|check_violation/i);
      await client.query('ROLLBACK TO SAVEPOINT before_history_delete');
    });
  });

  it('INV-CHECK-AUTH-001 denies execute and direct history inserts for anon/authenticated', async () => {
    const { rows } = await client.query<{ grantee: string; privilege_type: string }>(`
      SELECT grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE specific_schema = 'public'
        AND routine_name = 'inventory_record_check'
    `);

    expect(rows.some((row) => row.grantee === 'service_role' && row.privilege_type === 'EXECUTE')).toBe(true);
    expect(rows.some((row) => row.grantee === 'PUBLIC' && row.privilege_type === 'EXECUTE')).toBe(false);
    expect(rows.some((row) => row.grantee === 'anon' && row.privilege_type === 'EXECUTE')).toBe(false);
    expect(rows.some((row) => row.grantee === 'authenticated' && row.privilege_type === 'EXECUTE')).toBe(false);

    await withRollback(async () => {
      const { itemId, actorId } = await createTempItem();

      await client.query('SAVEPOINT auth_rpc');
      await client.query('SET LOCAL ROLE authenticated');
      await expect(client.query(`
        SELECT public.inventory_record_check(
          $1::uuid, '2026-06-01'::date, $2::uuid, NULL, NULL, NULL, NULL, FALSE, $3::uuid
        )
      `, [itemId, actorId, randomUUID()])).rejects.toThrow(/permission denied|must be owner/i);
      await client.query('ROLLBACK TO SAVEPOINT auth_rpc');

      await client.query('SAVEPOINT auth_insert');
      await client.query('SET LOCAL ROLE authenticated');
      await expect(client.query(`
        INSERT INTO public.inventory_check_history (
          item_id, checked_at, interval_days, checked_by
        ) VALUES ($1::uuid, '2026-06-01'::date, 30, $2::uuid)
      `, [itemId, actorId])).rejects.toThrow(/permission denied|row-level security|policy/i);
      await client.query('ROLLBACK TO SAVEPOINT auth_insert');
    });
  });

  it('INV-CHECK-ROUTE-001 equivalent: unconfirmed future dates fail inside the RPC', async () => {
    await withRollback(async () => {
      const { itemId, actorId } = await createTempItem();
      await expect(client.query(`
        SELECT public.inventory_record_check(
          $1::uuid,
          ((timezone('Europe/London', now()))::date + 3),
          $2::uuid,
          NULL,
          NULL,
          NULL,
          NULL,
          FALSE,
          $3::uuid
        )
      `, [itemId, actorId, randomUUID()])).rejects.toThrow(/FUTURE_CHECK_CONFIRMATION_REQUIRED/);
    });
  });

  it('INV-CHECK-STATUS-001 serializes retirement against an in-flight check lock', async () => {
    const { itemId, actorId } = await createTempItem();
    const locker = createClient();
    const checker = createClient();
    await locker.connect();
    await checker.connect();

    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM public.inventory_items WHERE id = $1 FOR UPDATE', [itemId]);

      const checkPromise = checker.query(`
        SELECT public.inventory_record_check(
          $1::uuid, '2026-06-01'::date, $2::uuid, NULL, NULL, NULL, NULL, FALSE, $3::uuid
        )
      `, [itemId, actorId, randomUUID()]);

      await new Promise((resolve) => setTimeout(resolve, 150));
      await locker.query(`UPDATE public.inventory_items SET status = 'retired' WHERE id = $1`, [itemId]);
      await locker.query('COMMIT');

      await expect(checkPromise).rejects.toThrow(/Retired inventory items cannot be checked/);
    } finally {
      await locker.query('ROLLBACK').catch(() => undefined);
      await locker.end();
      await checker.end();
      await cleanupItem(itemId);
    }
  });

  it('INV-CHECK-STATUS-001 allows the check when it acquires the lock before retirement', async () => {
    const { itemId, actorId } = await createTempItem();
    const checker = createClient();
    const retirer = createClient();
    await checker.connect();
    await retirer.connect();

    try {
      await checker.query('BEGIN');
      await checker.query(`
        SELECT public.inventory_record_check(
          $1::uuid, '2026-06-01'::date, $2::uuid, NULL, NULL, NULL, NULL, FALSE, $3::uuid
        )
      `, [itemId, actorId, randomUUID()]);

      const retirePromise = retirer.query(
        `UPDATE public.inventory_items SET status = 'retired' WHERE id = $1`,
        [itemId],
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await checker.query('COMMIT');
      await retirePromise;

      const item = await client.query<{ status: string; last_checked_at: Date | string }>(
        'SELECT status, last_checked_at FROM public.inventory_items WHERE id = $1',
        [itemId],
      );
      expect(item.rows[0].status).toBe('retired');
      expect(asDateOnly(item.rows[0].last_checked_at)).toBe('2026-06-01');
    } finally {
      await checker.query('ROLLBACK').catch(() => undefined);
      await checker.end();
      await retirer.end();
      await cleanupItem(itemId);
    }
  });

  it('INV-CHECK-MIG-001 migration remains idempotent and keeps expected objects', async () => {
    const migrationSql = await import('node:fs').then((fs) => (
      fs.readFileSync(
        resolve(process.cwd(), 'supabase/migrations/20260807155000_inventory_check_date_integrity.sql'),
        'utf8',
      )
    ));

    await client.query(migrationSql);

    const { rows: functionRows } = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE specific_schema = 'public'
        AND routine_name = 'inventory_record_check'
    `);
    expect(functionRows).toHaveLength(1);

    const { rows: triggerRows } = await client.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'trg_inventory_check_history_sync_last_checked',
          'trg_inventory_items_last_checked_history_guard',
          'trg_inventory_check_history_append_only_update',
          'trg_inventory_check_history_append_only_delete'
        )
    `);
    expect(triggerRows).toHaveLength(4);
  });
});
