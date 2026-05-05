import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260505_backfill_hgv_full_service_category_values.sql';

async function runMigration() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

  if (!connectionString) {
    console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
    process.exit(1);
  }

  const url = new URL(connectionString);
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running HGV full service category backfill...');
    await client.connect();

    const migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
    await client.query(migrationSQL);

    const verification = await client.query<{
      category_name: string;
      last_mileage: number | null;
      due_mileage: number | null;
      current_mileage: number | null;
    }>(`
      SELECT
        category.name AS category_name,
        value.last_mileage,
        value.due_mileage,
        maintenance.current_mileage
      FROM public.hgvs hgv
      JOIN public.vehicle_maintenance maintenance ON maintenance.hgv_id = hgv.id
      JOIN public.maintenance_categories category
        ON LOWER(category.name) IN ('engine service', 'full service')
      LEFT JOIN public.asset_maintenance_category_values value
        ON value.hgv_id = hgv.id
       AND value.maintenance_category_id = category.id
      WHERE hgv.reg_number = 'VS71 AVS'
      ORDER BY category.name
    `);

    console.log('VS71 AVS service category values:');
    for (const row of verification.rows) {
      console.log(
        `${row.category_name}: last=${row.last_mileage ?? 'not set'}, due=${row.due_mileage ?? 'not set'}, current=${row.current_mileage ?? 'not set'}`
      );
    }

    const failedRows = verification.rows.filter((row) =>
      row.current_mileage != null &&
      row.due_mileage != null &&
      row.due_mileage <= row.current_mileage
    );

    if (failedRows.length > 0) {
      throw new Error('Verification failed: VS71 AVS still has an overdue HGV service category');
    }

    console.log('HGV full service category backfill completed successfully');
  } catch (error) {
    console.error('HGV full service category backfill failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error('Unexpected migration failure:', error);
  process.exit(1);
});
