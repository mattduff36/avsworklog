import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260806155426_quote_inventory_site_location_sync_hardening.sql';
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

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const client = createClient(getConnectionString());
  await client.connect();
  try {
    if (!apply) {
      console.log(JSON.stringify({
        mode: 'dry-run',
        migration: MIGRATION_FILE,
        expected_40106_location_id: EXPECTED_40106_LOCATION_ID,
      }, null, 2));
      return;
    }

    const sql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8');
    await client.query(sql);

    const { rows } = await client.query<{ id: string }>(`
      SELECT id
      FROM public.inventory_locations
      WHERE location_type = 'site'
        AND is_active = TRUE
        AND source_type = 'quote'
        AND UPPER(BTRIM(external_reference)) = '40106-GH'
    `);

    console.log(JSON.stringify({
      applied: true,
      target_40106_gh_id: rows[0]?.id || null,
      preserved: rows[0]?.id === EXPECTED_40106_LOCATION_ID,
    }, null, 2));

    if (rows[0]?.id !== EXPECTED_40106_LOCATION_ID) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
