import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
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

    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260206_fix_plant_delete_policy.sql'),
      'utf-8'
    );

    await client.query(sql);
    console.log('DELETE policy updated: is_super_admin -> is_manager_admin');

    // Verify
    const { rows } = await client.query(`
      SELECT policyname, cmd
      FROM pg_policies
      WHERE tablename = 'plant'
      ORDER BY policyname;
    `);

    console.log('\nCurrent plant policies:');
    for (const row of rows) {
      console.log(`  ${row.cmd.padEnd(8)} ${row.policyname}`);
    }

    console.log('\nMIGRATION COMPLETE');
  } catch (err: any) {
    console.error('MIGRATION FAILED:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
