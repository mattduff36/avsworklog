import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const TARGET_PROJECT_REF = 'lrhufzqfzeutgvudcowy';
const sqlFile = 'supabase/migrations/20260819170000_system_accounts.sql';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

if (!connectionString.includes(TARGET_PROJECT_REF)) {
  console.error('Database connection string does not target the approved Supabase project.');
  process.exit(1);
}

async function runMigration() {
  console.log('Running system accounts migration...');

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

    const { rows: teamRows } = await client.query<{
      id: string;
      name: string;
      is_system: boolean;
      timesheet_type: string | null;
      active: boolean;
    }>(`
      SELECT id, name, is_system, timesheet_type, active
      FROM public.org_teams
      WHERE id = 'system_accounts'
    `);
    if (
      teamRows.length !== 1
      || teamRows[0]?.name !== 'System Accounts'
      || teamRows[0]?.is_system !== true
      || teamRows[0]?.active !== true
      || teamRows[0]?.timesheet_type !== null
    ) {
      throw new Error('System Accounts team was not seeded correctly');
    }

    const { rows: permissionRows } = await client.query<{ enabled_count: string }>(`
      SELECT COUNT(*)::TEXT AS enabled_count
      FROM public.team_module_permissions
      WHERE team_id = 'system_accounts'
        AND enabled = TRUE
    `);
    if (Number.parseInt(permissionRows[0]?.enabled_count || '1', 10) !== 0) {
      throw new Error('System Accounts team defaults must all be disabled');
    }

    const { rows: kioskRows } = await client.query<{
      kiosk_user_id: string;
      is_system_account: boolean;
      team_id: string | null;
      annual_holiday_allowance_days: string | null;
      inventory_access_level: number | null;
      live_bank_holidays: string;
      snapshot_rows: string;
    }>(`
      SELECT
        config.kiosk_user_id,
        profile.is_system_account,
        profile.team_id,
        profile.annual_holiday_allowance_days::TEXT,
        (
          SELECT access_level
          FROM public.user_module_permissions
          WHERE user_id = config.kiosk_user_id
            AND module_name = 'inventory'
        ) AS inventory_access_level,
        (
          SELECT COUNT(*)::TEXT
          FROM public.absences
          WHERE profile_id = config.kiosk_user_id
            AND is_bank_holiday IS TRUE
        ) AS live_bank_holidays,
        (
          SELECT COUNT(*)::TEXT
          FROM private.system_account_absence_snapshots
          WHERE snapshot_key = 'yard-kiosk-system-accounts-v1'
        ) AS snapshot_rows
      FROM public.inventory_kiosk_config AS config
      JOIN public.profiles AS profile
        ON profile.id = config.kiosk_user_id
      WHERE config.id = 1
    `);

    if (kioskRows.length === 1) {
      const kiosk = kioskRows[0];
      if (kiosk.is_system_account !== true || kiosk.team_id !== 'system_accounts') {
        throw new Error('Configured kiosk was not assigned as a system account');
      }
      if (Number(kiosk.annual_holiday_allowance_days) !== 0) {
        throw new Error('Configured kiosk holiday allowance must be 0');
      }
      if (kiosk.inventory_access_level !== 1) {
        throw new Error('Configured kiosk Inventory override must remain Level 1');
      }
      if (Number.parseInt(kiosk.live_bank_holidays, 10) !== 0) {
        throw new Error('Configured kiosk still has bank-holiday absences');
      }
      if (Number.parseInt(kiosk.snapshot_rows, 10) < 1) {
        throw new Error('Kiosk bank-holiday rows were not snapshotted before delete');
      }
    }

    const { rows: closeFnRows } = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'close_absence_financial_year_bookings'
    `);
    if (!closeFnRows[0]?.definition.includes('is_system_account')) {
      throw new Error('Year-close function does not skip system accounts');
    }

    const { rows: scopeFnRows } = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'list_daily_allocation_scope_profile_ids'
    `);
    if (!scopeFnRows[0]?.definition.includes('is_system_account')) {
      throw new Error('Daily allocation scope function does not skip system accounts');
    }

    console.log('System accounts migration completed and verified.');
  } catch (error) {
    console.error(
      'System accounts migration failed:',
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
