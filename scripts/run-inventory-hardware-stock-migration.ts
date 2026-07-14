import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260714_inventory_hardware_stock.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inventory Hardware stock migration...');

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
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const [
      { rows: tableRows },
      { rows: functionRows },
      { rows: starterRows },
    ] = await Promise.all([
      client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'inventory_hardware_items',
            'inventory_hardware_balances',
            'inventory_hardware_transaction_batches',
            'inventory_hardware_transactions'
          )
      `),
      client.query<{ routine_name: string }>(`
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = 'public'
          AND routine_name IN (
            'inventory_apply_hardware_adjustments',
            'inventory_transfer_hardware_stock'
          )
      `),
      client.query<{ count: string }>(`
        SELECT COUNT(*)::TEXT AS count
        FROM public.inventory_hardware_items
        WHERE name_normalized IN (
          'heras fencing',
          'cones',
          'cone tops',
          'road plates',
          'derv tank',
          'machine breaker',
          'floor saw',
          'generator',
          'tamp'
        )
      `),
    ]);

    if (tableRows.length !== 4) {
      throw new Error('Inventory Hardware tables were not fully created');
    }
    if (functionRows.length !== 2) {
      throw new Error('Inventory Hardware stock functions were not fully created');
    }
    if (Number(starterRows[0]?.count || 0) !== 9) {
      throw new Error('Inventory Hardware starter catalogue was not fully seeded');
    }

    await client.query('BEGIN');
    try {
      const { rows: verificationRows } = await client.query<{
        item_id: string;
        from_location_id: string;
        to_location_id: string | null;
        from_before: number;
        to_before: number;
      }>(`
        WITH selected_item AS (
          SELECT id
          FROM public.inventory_hardware_items
          WHERE is_active = TRUE
          ORDER BY sort_order, name
          LIMIT 1
        ),
        selected_locations AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY name, id) AS row_number
          FROM public.inventory_locations
          WHERE is_active = TRUE
          ORDER BY name, id
          LIMIT 2
        )
        SELECT
          selected_item.id AS item_id,
          source.id AS from_location_id,
          destination.id AS to_location_id,
          COALESCE(source_balance.quantity, 0)::INTEGER AS from_before,
          COALESCE(destination_balance.quantity, 0)::INTEGER AS to_before
        FROM selected_item
        JOIN selected_locations source ON source.row_number = 1
        LEFT JOIN selected_locations destination ON destination.row_number = 2
        LEFT JOIN public.inventory_hardware_balances source_balance
          ON source_balance.hardware_item_id = selected_item.id
          AND source_balance.location_id = source.id
        LEFT JOIN public.inventory_hardware_balances destination_balance
          ON destination_balance.hardware_item_id = selected_item.id
          AND destination_balance.location_id = destination.id
      `);

      const verification = verificationRows[0];
      if (!verification) {
        throw new Error('An active Hardware item and Inventory location are required for verification');
      }

      await client.query(
        `SELECT public.inventory_apply_hardware_adjustments(
          'add',
          'Delivery',
          'Migration verification',
          $1::JSONB,
          NULL::UUID
        )`,
        [JSON.stringify([{
          item_id: verification.item_id,
          location_id: verification.from_location_id,
          quantity: 2,
        }])],
      );

      if (verification.to_location_id) {
        await client.query(
          `SELECT public.inventory_transfer_hardware_stock(
            $1::JSONB,
            'Migration verification',
            NULL::UUID
          )`,
          [JSON.stringify([{
            item_id: verification.item_id,
            from_location_id: verification.from_location_id,
            to_location_id: verification.to_location_id,
            quantity: 1,
          }])],
        );

        const { rows: balanceRows } = await client.query<{ location_id: string; quantity: number }>(`
          SELECT location_id, quantity
          FROM public.inventory_hardware_balances
          WHERE hardware_item_id = $1
            AND location_id IN ($2, $3)
        `, [
          verification.item_id,
          verification.from_location_id,
          verification.to_location_id,
        ]);
        const quantities = new Map(balanceRows.map((row) => [row.location_id, row.quantity]));
        if (
          quantities.get(verification.from_location_id) !== verification.from_before + 1
          || quantities.get(verification.to_location_id) !== verification.to_before + 1
        ) {
          throw new Error('Inventory Hardware transfer verification returned unexpected balances');
        }
      }

      await client.query('ROLLBACK');
    } catch (verificationError) {
      await client.query('ROLLBACK');
      throw verificationError;
    }

    console.log('Inventory Hardware stock migration completed.');
  } catch (error) {
    console.error(
      'Inventory Hardware stock migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
