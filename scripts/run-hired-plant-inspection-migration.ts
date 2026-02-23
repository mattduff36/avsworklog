import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260223_add_hired_plant_inspection_support.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Hired Plant Inspection Support Migration...\n');

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

    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    console.log('   - Adding is_hired_plant column');
    console.log('   - Adding hired_plant_id_serial column');
    console.log('   - Adding hired_plant_description column');
    console.log('   - Adding hired_plant_hiring_company column');
    console.log('   - Replacing check_inspections_asset constraint (3-way)');
    console.log('   - Creating unique index for hired plant deduplication\n');

    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');

    console.log('🔍 Verifying changes...');

    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'vehicle_inspections'
        AND column_name LIKE 'hired_%' OR column_name = 'is_hired_plant'
      ORDER BY column_name
    `);

    if (columns.length > 0) {
      console.log('✅ New columns:');
      columns.forEach(c => {
        console.log(`   - ${c.column_name} (${c.data_type}, nullable: ${c.is_nullable}, default: ${c.column_default || 'none'})`);
      });
    }

    const { rows: constraints } = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'vehicle_inspections'::regclass
        AND conname = 'check_inspections_asset'
    `);

    if (constraints.length > 0) {
      console.log('✅ Constraint check_inspections_asset exists');
    }

    const { rows: indexes } = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'vehicle_inspections'
        AND indexname LIKE '%hired%'
    `);

    if (indexes.length > 0) {
      console.log('✅ Indexes:');
      indexes.forEach(idx => {
        console.log(`   - ${idx.indexname}`);
      });
    }

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);

    if (error.message?.includes('already exists')) {
      console.log('✅ Already applied - no action needed!');
      process.exit(0);
    }

    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
