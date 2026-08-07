import { config } from 'dotenv';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const describeDb = connectionString ? describe : describe.skip;

describeDb('INV-CHECK-RECON runtime reconciliation', () => {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  async function cleanupItem(itemId: string) {
    await client.query('SET session_replication_role = replica');
    await client.query('DELETE FROM public.inventory_check_history WHERE item_id = $1', [itemId]);
    await client.query('DELETE FROM public.inventory_items WHERE id = $1', [itemId]);
    await client.query('SET session_replication_role = DEFAULT');
  }

  it('INV-CHECK-RECON-001 dry-run is mutation-free and INV-CHECK-RECON-002 repairs only allowlisted rows', async () => {
    // spawnSync + npx startup can exceed the default Vitest timeout.
    const location = await client.query<{ id: string }>(`
      SELECT id FROM public.inventory_locations WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1
    `);
    const category = await client.query<{ slug: string }>(`
      SELECT slug FROM public.inventory_item_categories WHERE is_active = TRUE ORDER BY name ASC LIMIT 1
    `);
    const actor = await client.query<{ id: string }>(`
      SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1
    `);

    const itemNumber = `TMP-R-${randomUUID().slice(0, 8).toUpperCase()}`;
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO public.inventory_items (
        item_number, item_number_normalized, name, category, location_id,
        last_checked_at, check_interval_days, status, created_by, updated_by
      ) VALUES (
        $1, lower($1), 'Reconcile temp', $2, $3, '2026-05-01', 30, 'active', $4, $4
      ) RETURNING id
    `, [itemNumber, category.rows[0].slug, location.rows[0].id, actor.rows[0].id]);
    const itemId = inserted.rows[0].id;

    try {
      await client.query(`
        SELECT public.inventory_record_check(
          $1::uuid, '2026-06-15'::date, $2::uuid, 'recon seed', NULL, NULL, NULL, FALSE, $3::uuid
        )
      `, [itemId, actor.rows[0].id, randomUUID()]);

      // Force an item_behind_history state by temporarily bypassing the guard.
      await client.query('SET session_replication_role = replica');
      await client.query(`UPDATE public.inventory_items SET last_checked_at = '2026-05-01' WHERE id = $1`, [itemId]);
      await client.query('SET session_replication_role = DEFAULT');

      const historyBefore = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM public.inventory_check_history',
      );

      const dryRun = spawnSync('npx', ['tsx', 'scripts/reconcile-inventory-check-dates.ts'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: true,
      });
      expect(dryRun.status).toBe(0);
      expect(dryRun.stdout).toContain(itemNumber);
      expect(dryRun.stdout).toContain('item_behind_history');

      const historyAfterDryRun = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM public.inventory_check_history',
      );
      expect(historyAfterDryRun.rows[0].count).toBe(historyBefore.rows[0].count);

      const allowlistDir = mkdtempSync(join(tmpdir(), 'inv-check-recon-'));
      const allowlistPath = join(allowlistDir, 'allowlist.json');
      writeFileSync(allowlistPath, JSON.stringify({
        entries: [{
          item_id: itemId,
          item_number: itemNumber,
          expected_last_checked_at: '2026-05-01',
          expected_max_checked_at: '2026-06-15',
        }],
      }));

      const apply = spawnSync(
        'npx',
        [
          'tsx',
          'scripts/reconcile-inventory-check-dates.ts',
          '--apply',
          '--confirm-apply',
          '--allowlist',
          allowlistPath,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          shell: true,
        },
      );
      expect(apply.status).toBe(0);
      expect(apply.stdout).toContain('Applied repairs for 1 item(s).');

      const repaired = await client.query<{ last_checked_at: Date | string }>(
        'SELECT last_checked_at FROM public.inventory_items WHERE id = $1',
        [itemId],
      );
      const repairedText = repaired.rows[0].last_checked_at instanceof Date
        ? `${repaired.rows[0].last_checked_at.getFullYear()}-${String(repaired.rows[0].last_checked_at.getMonth() + 1).padStart(2, '0')}-${String(repaired.rows[0].last_checked_at.getDate()).padStart(2, '0')}`
        : String(repaired.rows[0].last_checked_at);
      expect(repairedText).toContain('2026-06-15');

      const driftedAllowlistPath = join(allowlistDir, 'drift.json');
      writeFileSync(driftedAllowlistPath, JSON.stringify({
        entries: [{
          item_id: itemId,
          item_number: itemNumber,
          expected_last_checked_at: '2026-05-01',
          expected_max_checked_at: '2026-06-15',
        }],
      }));
      const drift = spawnSync(
        'npx',
        [
          'tsx',
          'scripts/reconcile-inventory-check-dates.ts',
          '--apply',
          '--confirm-apply',
          '--allowlist',
          driftedAllowlistPath,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          shell: true,
        },
      );
      expect(drift.status).not.toBe(0);
      expect(`${drift.stdout}\n${drift.stderr}`).toMatch(/Drift:/);
    } finally {
      await cleanupItem(itemId);
    }
  }, 60_000);
});
