import * as dotenv from 'dotenv';
import * as path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkMotColumns() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found');
    process.exit(1);
  }

  // Parse connection string and add SSL config
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check for MOT columns in vehicle_maintenance
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'vehicle_maintenance' 
      AND column_name LIKE 'mot_%'
      ORDER BY column_name;
    `);

    if (columnCheck.rows.length > 0) {
      console.log('✅ MOT columns already exist in vehicle_maintenance:');
      columnCheck.rows.forEach(row => console.log(`   - ${row.column_name}`));
    } else {
      console.log('❌ No MOT columns found - migration needs to run');
    }

    // Check for MOT tables
    const tableCheck = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename LIKE 'mot_%';
    `);

    console.log('\n📋 MOT-related tables:');
    if (tableCheck.rows.length > 0) {
      tableCheck.rows.forEach(row => console.log(`   - ${row.tablename}`));
    } else {
      console.log('   None found');
    }

  } catch (error: any) {
    console.error('❌ Check failed:', error.message);
  } finally {
    await client.end();
  }
}

checkMotColumns();




