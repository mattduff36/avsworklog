import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  process.exit(1);
}

async function run() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Add columns
    await client.query('ALTER TABLE plant ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ NULL');
    await client.query("ALTER TABLE plant ADD COLUMN IF NOT EXISTS retire_reason VARCHAR(50) NULL");
    console.log('Columns added: retired_at, retire_reason');

    // Backfill existing retired records
    const res = await client.query(
      "UPDATE plant SET retired_at = updated_at WHERE status = 'retired' AND retired_at IS NULL"
    );
    console.log(`Backfilled ${res.rowCount} existing retired record(s)`);

    console.log('\nMIGRATION COMPLETE');
  } catch (err: any) {
    console.error('MIGRATION FAILED:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
