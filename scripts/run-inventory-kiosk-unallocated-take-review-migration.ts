import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260819151500_inventory_kiosk_unallocated_take_review.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('Running Inventory kiosk unallocated take review migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const [
      { rows: transferRows },
      { rows: helperGrantRows },
      { rows: publicGrantRows },
      { rows: triggerRows },
      { rows: orphanRows },
    ] = await Promise.all([
      client.query<{ id: string; name: string; location_type: string; is_active: boolean }>(`
        SELECT id, name, location_type, is_active
        FROM public.inventory_locations
        WHERE location_type = 'transfer'
           OR LOWER(BTRIM(name)) = 'in transfer'
      `),
      client.query<{
        proname: string;
        service_execute: boolean;
        public_execute: boolean;
        authenticated_execute: boolean;
      }>(`
        SELECT
          p.proname,
          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute,
          has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private'
          AND p.proname IN (
            'inventory_allow_transfer_mutation',
            'inventory_kiosk_action_lifecycle',
            'inventory_location_is_transfer',
            'inventory_require_transfer_location'
          )
      `),
      client.query<{
        proname: string;
        service_execute: boolean;
        public_execute: boolean;
        authenticated_execute: boolean;
      }>(`
        SELECT
          p.proname,
          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute,
          has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'inventory_kiosk_execute_unallocated_take',
            'inventory_allocate_unallocated_kiosk_take'
          )
      `),
      client.query<{ definition: string }>(`
        SELECT pg_get_functiondef(p.oid) AS definition
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private'
          AND p.proname = 'protect_inventory_kiosk_unallocated_action'
      `),
      client.query<{ kind: string; count: string }>(`
        SELECT 'pending_without_open_action' AS kind, COUNT(*)::TEXT AS count
        FROM public.inventory_kiosk_transfer_batches AS batch
        LEFT JOIN public.reminder_actions AS action
          ON action.id = batch.reminder_action_id
        WHERE batch.allocation_status = 'pending'
          AND (action.id IS NULL OR action.status <> 'open')
        UNION ALL
        SELECT 'open_action_without_pending_batch', COUNT(*)::TEXT
        FROM public.reminder_actions AS action
        LEFT JOIN public.inventory_kiosk_transfer_batches AS batch
          ON batch.reminder_action_id = action.id
         AND batch.allocation_status = 'pending'
        WHERE action.workflow_key = 'inventory_kiosk_unallocated_take'
          AND action.status = 'open'
          AND batch.id IS NULL
        UNION ALL
        SELECT 'resolved_action_without_allocated_batch', COUNT(*)::TEXT
        FROM public.reminder_actions AS action
        LEFT JOIN public.inventory_kiosk_transfer_batches AS batch
          ON batch.reminder_action_id = action.id
         AND batch.allocation_status = 'allocated'
        WHERE action.workflow_key = 'inventory_kiosk_unallocated_take'
          AND action.status = 'resolved'
          AND batch.id IS NULL
      `),
    ]);

    const activeTransfer = transferRows.filter((row) => row.is_active && row.location_type === 'transfer');
    if (activeTransfer.length !== 1 || activeTransfer[0]?.name !== 'In transfer') {
      throw new Error('YK-DB-001 failed: expected exactly one active In transfer location');
    }
    if (transferRows.length !== 1) {
      throw new Error('YK-DB-001 failed: extra In transfer or transfer-type rows exist');
    }
    if (helperGrantRows.length !== 4 || helperGrantRows.some((row) => (
      !row.service_execute || row.public_execute || row.authenticated_execute
    ))) {
      throw new Error('Private transfer helpers must be service_role executable only');
    }
    if (publicGrantRows.length !== 2 || publicGrantRows.some((row) => (
      !row.service_execute || row.public_execute || row.authenticated_execute
    ))) {
      throw new Error('YK-AUTH-001 failed: take/allocate RPCs must be service_role only');
    }
    if (!triggerRows[0]?.definition.includes('NEW.workflow_key IS DISTINCT FROM OLD.workflow_key')) {
      throw new Error('YK-ACTION-001 failed: lifecycle trigger must block workflow_key escape');
    }
    if (orphanRows.some((row) => Number.parseInt(row.count, 10) !== 0)) {
      throw new Error(`YK-INVAR-001 failed: ${JSON.stringify(orphanRows)}`);
    }

    console.log('Inventory kiosk unallocated take review migration verified.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Inventory kiosk unallocated take review migration failed:', message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
