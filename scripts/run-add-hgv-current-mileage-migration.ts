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
    'supabase/migrations/20260301_add_current_mileage_to_hgvs.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Running: add current_mileage to hgvs');
  await client.query(sql);
  console.log('Migration applied');

  const { rows } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hgvs'
      AND column_name = 'current_mileage'
  `);

  if (rows.length === 1) {
    console.log('Verified: current_mileage column exists on hgvs');
  } else {
    throw new Error('Verification failed: current_mileage not found on hgvs');
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
