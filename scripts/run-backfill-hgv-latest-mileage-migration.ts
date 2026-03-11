import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

  const sqlPath = join(
    process.cwd(),
    'supabase/migrations/20260311_backfill_hgv_latest_mileage_from_inspections.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Running: backfill HGV latest mileage from inspections');
  await client.query(sql);
  console.log('Migration applied');

  const { rows } = await client.query(`
    WITH latest_hgv_mileage AS (
      SELECT DISTINCT ON (hi.hgv_id)
        hi.hgv_id,
        hi.current_mileage
      FROM public.hgv_inspections hi
      WHERE hi.hgv_id IS NOT NULL
        AND hi.current_mileage IS NOT NULL
      ORDER BY
        hi.hgv_id,
        hi.inspection_date DESC,
        hi.submitted_at DESC NULLS LAST,
        hi.created_at DESC,
        hi.id DESC
    )
    SELECT
      COUNT(*) FILTER (WHERE h.current_mileage = lhm.current_mileage) AS hgvs_synced_count,
      COUNT(*) FILTER (WHERE vm.current_mileage = lhm.current_mileage) AS maintenance_synced_count
    FROM latest_hgv_mileage lhm
    LEFT JOIN public.hgvs h ON h.id = lhm.hgv_id
    LEFT JOIN public.vehicle_maintenance vm ON vm.hgv_id = lhm.hgv_id;
  `);

  const result = rows[0] as { hgvs_synced_count: string; maintenance_synced_count: string };
  console.log(`Verified hgvs rows synced: ${result.hgvs_synced_count}`);
  console.log(`Verified vehicle_maintenance rows synced: ${result.maintenance_synced_count}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
