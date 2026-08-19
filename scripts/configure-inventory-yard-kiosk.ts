import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const emailArgument = process.argv.find((argument) => argument.startsWith('--email='));
const email = emailArgument?.slice('--email='.length).trim().toLowerCase() || '';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

if (!email) {
  console.error('Provide the kiosk account email with --email=<address>');
  process.exit(1);
}

async function configureKiosk() {
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
    await client.query('BEGIN');

    const { rows: userRows } = await client.query<{ id: string; role_id: string | null }>(`
      SELECT auth_user.id, profile.role_id
      FROM auth.users AS auth_user
      JOIN public.profiles AS profile
        ON profile.id = auth_user.id
      WHERE LOWER(auth_user.email) = $1
      LIMIT 2
    `, [email]);

    if (userRows.length !== 1) {
      throw new Error(
        userRows.length === 0
          ? 'A matching auth user and profile were not found'
          : 'More than one matching kiosk account was found',
      );
    }

    const kioskUserId = userRows[0].id;
    if (!userRows[0].role_id) {
      throw new Error('The kiosk profile must have a job role before it can use Inventory');
    }

    const inventoryAccessLevel = 1;

    await client.query(`SELECT set_config('app.system_account_maintenance', 'on', true)`);

    await client.query(`
      INSERT INTO public.user_module_permissions (
        user_id,
        module_name,
        access_level,
        updated_by
      )
      VALUES ($1, 'inventory', $2, $1)
      ON CONFLICT (user_id, module_name) DO UPDATE
      SET access_level = EXCLUDED.access_level,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
    `, [kioskUserId, inventoryAccessLevel]);

    await client.query(`
      UPDATE public.profiles
      SET
        team_id = 'system_accounts',
        is_system_account = TRUE,
        annual_holiday_allowance_days = 0
      WHERE id = $1
    `, [kioskUserId]);

    await client.query(`
      INSERT INTO public.inventory_kiosk_config (
        id,
        kiosk_user_id,
        is_enabled,
        note,
        updated_by
      )
      VALUES (
        1,
        $1,
        TRUE,
        'Dedicated Yard kiosk account',
        $1
      )
      ON CONFLICT (id) DO UPDATE
      SET kiosk_user_id = EXCLUDED.kiosk_user_id,
          is_enabled = TRUE,
          note = EXCLUDED.note,
          updated_by = EXCLUDED.updated_by
    `, [kioskUserId]);

    const { rows: verificationRows } = await client.query<{
      configured: boolean;
      inventory_access_level: number;
      is_system_account: boolean;
      team_id: string | null;
      annual_holiday_allowance_days: string | null;
    }>(`
      SELECT
        EXISTS (
        SELECT 1
        FROM public.inventory_kiosk_config
        WHERE id = 1
          AND kiosk_user_id = $1
          AND is_enabled = TRUE
        ) AS configured,
        COALESCE((
          SELECT access_level
          FROM public.user_module_permissions
          WHERE user_id = $1
            AND module_name = 'inventory'
        ), 0)::INTEGER AS inventory_access_level,
        profile.is_system_account,
        profile.team_id,
        profile.annual_holiday_allowance_days::TEXT
      FROM public.profiles AS profile
      WHERE profile.id = $1
    `, [kioskUserId]);

    if (
      verificationRows[0]?.configured !== true
      || verificationRows[0]?.inventory_access_level !== 1
      || verificationRows[0]?.is_system_account !== true
      || verificationRows[0]?.team_id !== 'system_accounts'
      || Number(verificationRows[0]?.annual_holiday_allowance_days) !== 0
    ) {
      throw new Error('The Yard kiosk configuration could not be verified');
    }

    await client.query('COMMIT');
    console.log(`Configured ${email} as the active Yard kiosk account.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(
      'Inventory Yard kiosk configuration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

configureKiosk().catch((error) => {
  console.error(error);
  process.exit(1);
});
