import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260722_inventory_kiosk_remote_control.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

interface VerificationRow {
  active_device_count: string;
  device_column_count: string;
  pairing_column_count: string;
  unique_index_count: string;
}

async function runMigration() {
  console.log('Running Inventory Yard kiosk remote control migration...');

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

    const { rows } = await client.query<VerificationRow>(`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM public.inventory_kiosk_devices
          WHERE revoked_at IS NULL
        ) AS active_device_count,
        (
          SELECT COUNT(*)::text
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'inventory_kiosk_devices'
            AND column_name IN (
              'revoked_reason',
              'superseded_by_device_id',
              'supersedes_device_id',
              'last_workflow_snapshot',
              'workflow_state_version',
              'last_snapshot_at',
              'control_holder_user_id',
              'control_session_id',
              'control_acquired_at',
              'control_lease_expires_at'
            )
        ) AS device_column_count,
        (
          SELECT COUNT(*)::text
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'inventory_kiosk_pairing_sessions'
            AND column_name = 'replaces_device_id'
        ) AS pairing_column_count,
        (
          SELECT COUNT(*)::text
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'inventory_kiosk_devices'
            AND indexname = 'inventory_kiosk_devices_one_active_idx'
        ) AS unique_index_count
    `);

    const verification = rows[0];
    if (
      !verification ||
      Number(verification.active_device_count) > 1 ||
      Number(verification.device_column_count) !== 10 ||
      Number(verification.pairing_column_count) !== 1 ||
      Number(verification.unique_index_count) !== 1
    ) {
      throw new Error('Yard kiosk remote control schema verification failed');
    }

    console.log(
      `Inventory Yard kiosk remote control migration completed with ${verification.active_device_count} active device(s).`,
    );
  } catch (error) {
    console.error(
      'Inventory Yard kiosk remote control migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
