import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString)
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');

  const sqlPath = join(
    process.cwd(),
    'supabase/migrations/20260302_add_hgv_maintenance_fields_and_categories.sql'
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
  console.log('Running: add HGV maintenance fields and categories');
  await client.query(sql);
  console.log('Migration applied');

  const { rows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_maintenance'
      AND column_name IN (
        'six_weekly_inspection_due_date',
        'fire_extinguisher_due_date',
        'taco_calibration_due_date'
      )
    ORDER BY column_name
  `);

  if (rows.length !== 3)
    throw new Error('Verification failed: expected all 3 HGV maintenance columns');

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
