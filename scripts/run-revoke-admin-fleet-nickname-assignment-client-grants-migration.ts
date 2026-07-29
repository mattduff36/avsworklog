import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260729121000_revoke_admin_fleet_nickname_assignment_client_grants.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('Revoking client grants on admin fleet nickname assignment RPCs...');

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
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf-8'));

    const { rows } = await client.query<{
      grantee: string;
      privilege_type: string;
    }>(`
      SELECT grantee, privilege_type
      FROM information_schema.routine_privileges
      WHERE specific_schema = 'public'
        AND routine_name IN (
          'clear_fleet_assignment_for_asset',
          'ensure_fleet_inventory_location',
          'admin_apply_fleet_asset_nickname_assignment'
        )
        AND grantee IN ('anon', 'authenticated', 'PUBLIC')
    `);

    if (rows.length > 0) {
      throw new Error(`Client roles still have privileges: ${JSON.stringify(rows)}`);
    }

    console.log('Migration completed successfully. Client roles have no EXECUTE grants.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
