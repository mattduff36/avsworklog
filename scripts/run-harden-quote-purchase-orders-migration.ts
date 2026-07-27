import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260727132410_harden_quote_purchase_orders.sql';

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
    console.log('Running quote purchase-order hardening migration...');
    await client.connect();
    await client.query(readFileSync(resolve(process.cwd(), sqlFile), 'utf-8'));

    const integrityResult = await client.query<{
      quote_delete_action: string;
      line_delete_action: string;
      nullable_line_ids: string;
      orphan_threads: string;
      missed_backfills: string;
    }>(`
      SELECT
        (
          SELECT confdeltype
          FROM pg_constraint
          WHERE conname = 'quote_purchase_orders_quote_id_fkey'
        ) AS quote_delete_action,
        (
          SELECT confdeltype
          FROM pg_constraint
          WHERE conname = 'quote_purchase_order_lines_quote_line_item_id_fkey'
        ) AS line_delete_action,
        (
          SELECT COUNT(*)::text
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'quote_purchase_order_lines'
            AND column_name = 'quote_line_item_id'
            AND is_nullable = 'YES'
        ) AS nullable_line_ids,
        (
          SELECT COUNT(*)::text
          FROM public.quote_purchase_orders po
          WHERE NOT EXISTS (
            SELECT 1
            FROM public.quotes q
            WHERE q.quote_thread_id = po.quote_thread_id
          )
        ) AS orphan_threads,
        (
          SELECT COUNT(DISTINCT q.quote_thread_id)::text
          FROM public.quotes q
          WHERE (q.po_number IS NOT NULL OR q.po_value IS NOT NULL)
            AND NOT EXISTS (
              SELECT 1
              FROM public.quote_purchase_orders po
              WHERE po.quote_thread_id = q.quote_thread_id
            )
        ) AS missed_backfills
    `);

    const integrity = integrityResult.rows[0];
    if (
      integrity?.quote_delete_action !== 'r'
      || integrity?.line_delete_action !== 'c'
      || integrity?.nullable_line_ids !== '0'
      || integrity?.orphan_threads !== '0'
      || integrity?.missed_backfills !== '0'
    ) {
      throw new Error('Quote purchase-order integrity verification failed');
    }

    console.log('Quote purchase-order hardening migration completed and verified.');
  } catch (error) {
    console.error(
      'Quote purchase-order hardening migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
