import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/add-absence-system.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Absence & Leave System Migration...\n');

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

    console.log('📄 Executing absence system migration...');
    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');
    
    // Verify changes
    console.log('🔍 Verifying tables...');
    
    const { rows: absenceReasons } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'absence_reasons'
    `);
    
    const { rows: absences } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'absences'
    `);
    
    const { rows: profileColumn } = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'profiles' 
      AND column_name = 'annual_holiday_allowance_days'
    `);
    
    const { rows: reasonCount } = await client.query(`
      SELECT COUNT(*) as count FROM absence_reasons
    `);

    if (absenceReasons.length > 0) {
      console.log('✅ absence_reasons table created');
    }
    
    if (absences.length > 0) {
      console.log('✅ absences table created');
    }
    
    if (profileColumn.length > 0) {
      console.log('✅ annual_holiday_allowance_days column added to profiles');
    }
    
    if (reasonCount.length > 0) {
      console.log(`✅ Seeded ${reasonCount[0].count} absence reasons`);
    }
    
    console.log('\n🎉 Absence & Leave System is ready to use!');

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);
    
    if (error.message?.includes('already exists')) {
      console.log('\n✅ Migration already applied - no action needed!');
      console.log('The absence system tables are already in place.');
      process.exit(0);
    }
    
    console.error('\n💡 Troubleshooting:');
    console.error('1. Check your .env.local has POSTGRES_URL_NON_POOLING');
    console.error('2. Verify database connection string is correct');
    console.error('3. Check SQL syntax in supabase/add-absence-system.sql');
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

