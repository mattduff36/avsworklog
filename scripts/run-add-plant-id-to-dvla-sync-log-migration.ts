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
    'supabase/migrations/20260301_add_plant_id_to_dvla_sync_log.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Running: add plant_id to dvla_sync_log');
  await client.query(sql);
  console.log('Migration applied');

  const { rows } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'dvla_sync_log'
      AND column_name  = 'plant_id'
  `);
  if (rows.length === 1) {
    console.log('Verified: plant_id column exists on dvla_sync_log');
  } else {
    throw new Error('Verification failed: plant_id not found on dvla_sync_log');
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
