import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260309_fix_vehicle_to_van_applies_to.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Fix vehicle→van applies_to Migration...\n');

  const url = new URL(connectionString!);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    const result = await client.query(migrationSQL);
    const rowCount = (result as pg.QueryResult).rowCount ?? 0;
    console.log(`✅ Updated ${rowCount} row(s)\n`);

    // Verify
    const verifyResult = await client.query(`
      SELECT name, applies_to
      FROM maintenance_categories
      ORDER BY name;
    `);

    console.log('🔍 Current applies_to values:');
    verifyResult.rows.forEach((row) => {
      console.log(`   - ${row.name}: [${(row.applies_to || []).join(', ')}]`);
    });

    const badRows = verifyResult.rows.filter(
      (r) => (r.applies_to || []).includes('vehicle')
    );
    if (badRows.length > 0) {
      console.error('\n⚠️  Some rows still contain "vehicle":');
      badRows.forEach((r) => console.error(`   - ${r.name}`));
    } else {
      console.log('\n✅ No rows contain "vehicle" — all use "van" now');
    }

    console.log('\n🎉 Migration complete!\n');
  } catch (err: unknown) {
    console.error('\n❌ Migration failed:');
    console.error(err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
