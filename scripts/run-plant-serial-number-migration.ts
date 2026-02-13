import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260213_enforce_plant_serial_number_constraints.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Plant Serial Number Constraints Migration...\n');

  // Parse connection string with SSL config
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
    console.log('   - Normalizing existing serial numbers');
    console.log('   - Setting empty strings to NULL');
    console.log('   - Setting invalid values to NULL');
    console.log('   - De-duplicating serial numbers');
    console.log('   - Widening column to TEXT');
    console.log('   - Adding CHECK constraint');
    console.log('   - Creating partial UNIQUE index\n');
    
    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');
    
    // Verify constraints
    console.log('🔍 Verifying constraints...');
    
    const { rows: constraints } = await client.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type
      FROM pg_constraint
      WHERE conrelid = 'plant'::regclass
        AND conname LIKE '%serial%'
    `);

    if (constraints.length > 0) {
      console.log('✅ Constraints created:');
      constraints.forEach(c => {
        console.log(`   - ${c.constraint_name} (${c.constraint_type})`);
      });
    }

    // Verify index
    const { rows: indexes } = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'plant'
        AND indexname LIKE '%serial%'
    `);

    if (indexes.length > 0) {
      console.log('✅ Indexes created:');
      indexes.forEach(idx => {
        console.log(`   - ${idx.indexname}`);
      });
    }

    // Show count of nulled-out values
    const { rows: stats } = await client.query(`
      SELECT 
        COUNT(*) as total_plants,
        COUNT(serial_number) as with_serial,
        COUNT(*) - COUNT(serial_number) as without_serial
      FROM plant
    `);
    
    if (stats.length > 0) {
      console.log('\n📊 Serial Number Statistics:');
      console.log(`   - Total plant assets: ${stats[0].total_plants}`);
      console.log(`   - With serial number: ${stats[0].with_serial}`);
      console.log(`   - Without serial number: ${stats[0].without_serial}`);
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
