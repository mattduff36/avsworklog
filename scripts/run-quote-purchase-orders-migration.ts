import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260727_quote_purchase_orders.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

async function runMigration() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running quote purchase orders migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf-8'));

    const [ordersResult, linesResult, policyResult] = await Promise.all([
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'quote_purchase_orders'
      `),
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'quote_purchase_order_lines'
      `),
      client.query<{ policyname: string }>(`
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'quote_purchase_orders'
          AND policyname = 'quote_purchase_orders_select'
      `),
    ]);

    if (ordersResult.rowCount !== 1) {
      throw new Error('quote_purchase_orders table was not created');
    }
    if (linesResult.rowCount !== 1) {
      throw new Error('quote_purchase_order_lines table was not created');
    }
    if (policyResult.rowCount !== 1) {
      throw new Error('quote_purchase_orders select policy was not created');
    }

    const countResult = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM public.quote_purchase_orders
    `);
    console.log(`Backfilled/existing purchase orders: ${countResult.rows[0]?.count || '0'}`);
    console.log('Quote purchase orders migration completed.');
  } catch (error) {
    console.error(
      'Quote purchase orders migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
