import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inspection photos storage policy migration...\n');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected!\n');

    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260316_fix_inspection_photos_storage_policies.sql'),
      'utf-8'
    );

    await client.query(sql);
    console.log('Migration applied successfully.\n');

    const { rows } = await client.query(`
      SELECT policyname, cmd
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND policyname IN (
          'Users can upload inspection photos',
          'Anyone can view inspection photos',
          'Users can delete own inspection photos'
        )
      ORDER BY policyname;
    `);

    console.log('Verified policies:');
    rows.forEach((row) => {
      console.log(`  - ${row.policyname} (${row.cmd})`);
    });

    if (rows.length !== 3) {
      throw new Error(`Expected 3 policies, found ${rows.length}`);
    }

    console.log('\nInspection photos storage policy migration completed successfully!');
  } catch (err: unknown) {
    const pgErr = err as { message?: string; detail?: string; hint?: string };
    console.error('MIGRATION FAILED:', pgErr.message || 'Unknown error');
    if (pgErr.detail) console.error('  Detail:', pgErr.detail);
    if (pgErr.hint) console.error('  Hint:', pgErr.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
