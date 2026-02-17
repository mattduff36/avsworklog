import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260217_add_maintenance_category_period.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error(
    'Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local'
  );
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Maintenance Category Period Migration...\n');

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
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

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');

    // Verify column exists
    const { rows: columnCheck } = await client.query(`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_name = 'maintenance_categories' AND column_name = 'period_value'
    `);

    if (columnCheck.length > 0) {
      console.log('✅ period_value column verified');
      console.log(`   Type: ${columnCheck[0].data_type}, Nullable: ${columnCheck[0].is_nullable}\n`);
    } else {
      console.log('⚠️  period_value column not found after migration');
    }

    // Show all categories with their period values
    const { rows: categories } = await client.query(`
      SELECT name, type, period_value
      FROM maintenance_categories
      ORDER BY name
    `);

    if (categories.length > 0) {
      console.log('📦 Category period values:');
      categories.forEach((cat) => {
        const unit = cat.type === 'date' ? 'months' : cat.type === 'mileage' ? 'miles' : 'hours';
        console.log(`   - ${cat.name}: ${cat.period_value.toLocaleString()} ${unit}`);
      });
    }
  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);

    if (error.message?.includes('already exists')) {
      console.log('✅ Already applied - no action needed!');
      process.exit(0);
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
