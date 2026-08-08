/**
 * Apply additive closure fixes for unified asset service scheduling.
 *
 * Usage: npx tsx scripts/run-asset-service-review-fixes-migration.ts
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260808_asset_service_review_fixes.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  process.exit(1);
}

async function main() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    const { rows: triggerRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM pg_trigger
      WHERE tgname = 'trg_protect_vehicle_maintenance_service_state'
        AND NOT tgisinternal
    `);
    if (triggerRows[0]?.count !== '1') {
      throw new Error('Expected service-state protection trigger');
    }
    const { rows: undoTriggerRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM pg_trigger
      WHERE tgname = 'trg_prevent_completed_service_task_undo'
        AND NOT tgisinternal
    `);
    if (undoTriggerRows[0]?.count !== '1') {
      throw new Error('Expected completed Service undo protection trigger');
    }

    const { rows: policyRows } = await client.query<{ with_check: string | null }>(`
      SELECT with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'asset_service_events'
        AND policyname = 'Managers insert service events'
    `);
    if (
      policyRows.length !== 1 ||
      !policyRows[0].with_check?.includes('effective_is_manager_admin')
    ) {
      throw new Error('Expected manager-only service event insert policy');
    }

    const { rows: testRows } = await client.query<{ dirty_count: string }>(`
      SELECT COUNT(*)::text AS dirty_count
      FROM public.vehicle_maintenance vm
      JOIN public.hgvs h ON h.id = vm.hgv_id
      WHERE (
        UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) = 'TE57HGV'
        OR LOWER(COALESCE(h.nickname, '')) = 'test-hgv'
      )
        AND (
          vm.next_service_mileage IS NOT NULL
          OR vm.last_service_mileage IS NOT NULL
          OR vm.last_service_template_id IS NOT NULL
          OR vm.next_service_template_id IS NOT NULL
          OR vm.next_service_rotation_step_id IS NOT NULL
        )
    `);
    if (testRows[0]?.dirty_count !== '0') {
      throw new Error('TEST-HGV still has unified service state');
    }

    const { rows: cascadeRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM pg_constraint
      WHERE conrelid = 'public.asset_service_events'::regclass
        AND conname IN (
          'asset_service_events_van_id_fkey',
          'asset_service_events_hgv_id_fkey',
          'asset_service_events_plant_id_fkey'
        )
        AND confdeltype = 'r'
    `);
    if (cascadeRows[0]?.count !== '3') {
      throw new Error('Expected restrictive asset service event foreign keys');
    }

    console.log('✅ Asset service review fixes migration applied');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void main();
