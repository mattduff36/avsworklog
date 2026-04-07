import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260407_add_maintenance_category_period_unit.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error(
    'Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local'
  );
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Maintenance Category Period Unit Migration...\n');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);
    console.log('✅ MIGRATION COMPLETED!\n');

    const { rows: categories } = await client.query(`
      SELECT name, type, period_value, period_unit
      FROM maintenance_categories
      WHERE name IN ('6 Weekly Inspection Due', 'Tax Due Date', 'Service Due', 'Service Due (Hours)')
      ORDER BY name
    `);

    console.log('📦 Verified category periods:');
    categories.forEach((category) => {
      console.log(
        `   - ${category.name}: ${category.period_value.toLocaleString()} ${category.period_unit}`
      );
    });
  } catch (err: unknown) {
    console.error(
      '❌ MIGRATION FAILED:',
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
