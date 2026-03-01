import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) throw new Error('POSTGRES_URL_NON_POOLING not set in .env.local');

  const sqlPath = join(
    process.cwd(),
    'supabase/migrations/20260301_fix_vehicle_maintenance_unique_constraints.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Running: fix vehicle_maintenance unique constraints\n');
  await client.query(sql);
  console.log('Migration applied');

  // Verify the three full unique constraints exist
  const { rows } = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) def
    FROM pg_constraint
    WHERE conrelid = 'public.vehicle_maintenance'::regclass
      AND contype = 'u'
    ORDER BY conname
  `);
  console.log('\nUnique constraints on vehicle_maintenance:');
  rows.forEach((r) => console.log(' ', r.conname, '|', r.def));

  const names = rows.map((r) => r.conname);
  if (
    names.includes('unique_vm_van_id') &&
    names.includes('unique_vm_hgv_id') &&
    names.includes('unique_vm_plant_id')
  ) {
    console.log('\nVerification passed: all three FK unique constraints present');
  } else {
    throw new Error('Verification failed: expected unique_vm_van_id / unique_vm_hgv_id / unique_vm_plant_id');
  }

  // Test the upsert syntax that the app actually uses
  await client.query('BEGIN');
  try {
    await client.query(`
      INSERT INTO public.vehicle_maintenance (van_id, dvla_sync_status, updated_at)
      VALUES ('00000000-0000-0000-0000-000000000001', 'success', NOW())
      ON CONFLICT (van_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
    `);
    console.log('Test upsert ON CONFLICT (van_id): OK');
  } finally {
    await client.query('ROLLBACK');
  }

  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
