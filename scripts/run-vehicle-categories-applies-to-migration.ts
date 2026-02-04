import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260204_add_vehicle_categories_applies_to.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Vehicle Categories applies_to Migration...\n');

  const url = new URL(connectionString);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');

    // Verify migration
    const verifyResult = await client.query(`
      SELECT name, applies_to, 
        (SELECT COUNT(*) FROM vehicles WHERE category_id = vehicle_categories.id) as vehicle_count,
        (SELECT COUNT(*) FROM plant WHERE category_id = vehicle_categories.id) as plant_count
      FROM vehicle_categories
      ORDER BY name
      LIMIT 10;
    `);

    console.log('🔍 Sample categories with applies_to:');
    verifyResult.rows.forEach((row) => {
      console.log(`   - ${row.name}: applies_to=[${row.applies_to.join(', ')}], vehicles=${row.vehicle_count}, plant=${row.plant_count}`);
    });

    console.log('\n🎉 Vehicle categories applies_to migration complete!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
