import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260312_absence_fy_archival.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}
const dbUrl = connectionString;

async function runMigration() {
  console.log('Running absence FY archival migration...\n');

  const url = new URL(dbUrl);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSQL);
    console.log('Migration executed');

    const verification = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name IN ('absences_archive', 'absence_financial_year_archives')
      ORDER BY table_name;
    `);

    console.log('Verified archive tables:');
    verification.rows.forEach((row: { table_name: string }) => {
      console.log(`  - ${row.table_name}`);
    });
  } catch (error) {
    console.error('Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
