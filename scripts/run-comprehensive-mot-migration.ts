import * as dotenv from 'dotenv';
import * as path from 'path';
import pg from 'pg';
import * as fs from 'fs';

// Load .env.local explicitly
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function runMigration() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found in environment');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read migration file
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20251223_add_comprehensive_mot_data.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Running migration: 20251223_add_comprehensive_mot_data.sql\n');
    console.log('⏳ This migration creates:');
    console.log('   - 14 vehicle-level MOT data fields');
    console.log('   - mot_test_history table (complete test history)');
    console.log('   - mot_test_defects table (advisory items & failures)');
    console.log('   - mot_test_comments table (tester comments)');
    console.log('   - Helper functions for MOT data queries\n');
    
    await client.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!\n');
    console.log('📊 Database Schema Updates:');
    console.log('\n🚗 vehicle_maintenance table - New MOT fields:');
    console.log('   - mot_make, mot_model, mot_first_used_date');
    console.log('   - mot_registration_date, mot_manufacture_date');
    console.log('   - mot_engine_size, mot_fuel_type');
    console.log('   - mot_primary_colour, mot_secondary_colour');
    console.log('   - mot_vehicle_id, mot_registration');
    console.log('   - mot_vin, mot_v5c_reference, mot_dvla_id');
    
    console.log('\n📋 mot_test_history table:');
    console.log('   - Stores complete MOT test history');
    console.log('   - Test results, dates, odometer readings');
    console.log('   - Test station information');
    
    console.log('\n⚠️  mot_test_defects table:');
    console.log('   - Advisory items, minor/major/dangerous defects');
    console.log('   - Failure items (PRS, FAIL)');
    console.log('   - Location details (nearside, offside, etc.)');
    
    console.log('\n💬 mot_test_comments table:');
    console.log('   - Tester comments from MOT tests');
    
    console.log('\n🔧 Helper Functions:');
    console.log('   - get_latest_mot_test(vehicle_id)');
    console.log('   - get_latest_passed_mot(vehicle_id)');
    console.log('   - count_mot_defects_by_type(mot_test_id)');
    
    console.log('\n🔒 Row Level Security:');
    console.log('   - RLS policies created for all new tables');
    console.log('   - User access based on vehicle permissions');
    
    console.log('\n✅ Ready to sync MOT data from GOV.UK MOT History API!');

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();

