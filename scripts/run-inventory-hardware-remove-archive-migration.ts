import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260714_inventory_hardware_remove_archive.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inventory Hardware archive-removal migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const { rows: beforeRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::TEXT AS count
      FROM public.inventory_hardware_items
      WHERE is_active = FALSE
    `);

    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows: verificationRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::TEXT AS count
      FROM public.inventory_hardware_items
      WHERE is_active = FALSE
    `);
    const remainingArchivedCount = Number(verificationRows[0]?.count || 0);
    if (remainingArchivedCount !== 0) {
      throw new Error(`${remainingArchivedCount} archived Hardware items remain`);
    }

    console.log(`Processed ${Number(beforeRows[0]?.count || 0)} archived Hardware items.`);
    console.log('Inventory Hardware archive-removal migration completed.');
  } catch (error) {
    console.error(
      'Inventory Hardware archive-removal migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
