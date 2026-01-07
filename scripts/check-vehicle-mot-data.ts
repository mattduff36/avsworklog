/**
 * Check what MOT data is currently stored in the database for FE24 TYO
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkVehicleMotData() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found');
    process.exit(1);
  }

  // Parse the connection string and configure SSL
  const url = new URL(connectionString);
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Try different formatting variations
    const regVariations = ['FE24TYO', 'FE24 TYO', 'fe24tyo', 'fe24 tyo'];
    
    console.log('🔍 Searching for vehicle with reg variations:', regVariations.join(', '));
    console.log('='.repeat(70));

    // Get vehicle and maintenance data - search with LIKE to catch any variation
    const result = await client.query(`
      SELECT 
        v.id,
        v.reg_number,
        v.created_at as vehicle_created_at,
        vm.mot_due_date,
        vm.mot_expiry_date,
        vm.mot_first_used_date,
        vm.mot_year_of_manufacture,
        vm.last_mot_api_sync,
        vm.mot_api_sync_status,
        vm.mot_api_sync_error,
        vm.mot_raw_data,
        vm.created_at as maintenance_created_at,
        vm.updated_at as maintenance_updated_at
      FROM vehicles v
      LEFT JOIN vehicle_maintenance vm ON v.id = vm.vehicle_id
      WHERE REPLACE(UPPER(v.reg_number), ' ', '') = 'FE24TYO'
    `);

    if (result.rows.length === 0) {
      console.log('\n❌ Vehicle not found in database');
      console.log('   The vehicle may not have been synced yet');
      return;
    }

    const data = result.rows[0];
    
    console.log('\n📊 DATABASE RECORDS:\n');
    console.log('Vehicle ID:', data.id);
    console.log('Registration:', data.reg_number);
    console.log('Vehicle Created:', data.vehicle_created_at);
    
    if (!data.mot_due_date) {
      console.log('\n⚠️  NO MAINTENANCE RECORD FOUND');
      console.log('   The vehicle exists but has no vehicle_maintenance entry');
      console.log('   You need to run a DVLA sync to populate maintenance data');
    } else {
      console.log('\nMaintenance Data:');
      console.log('  MOT Due Date:', data.mot_due_date);
      console.log('  MOT Expiry Date:', data.mot_expiry_date);
      console.log('  First Used Date:', data.mot_first_used_date);
      console.log('  Year of Manufacture:', data.mot_year_of_manufacture);
      console.log('  Last MOT API Sync:', data.last_mot_api_sync);
      console.log('  MOT API Sync Status:', data.mot_api_sync_status);
      console.log('  MOT API Sync Error:', data.mot_api_sync_error);
      
      if (data.mot_raw_data) {
        console.log('\n  Raw MOT Data from Database:');
        const rawData = data.mot_raw_data;
        console.log('   ', JSON.stringify(rawData, null, 4).replace(/\n/g, '\n    '));
      }
      
      // Analysis
      console.log('\n🔍 ANALYSIS:\n');
      
      if (data.mot_due_date === '2027-03-20') {
        console.log('✅ Database has CORRECT MOT due date: 2027-03-20');
        console.log('   This matches what the MOT API currently returns');
      } else if (data.mot_due_date === '2026-02-28') {
        console.log('❌ Database has WRONG MOT due date: 2026-02-28');
        console.log('   Should be: 2027-03-20 (3 years from registration)');
        console.log('\n💡 SOLUTION: Run a manual DVLA sync to update this vehicle');
      } else {
        console.log('⚠️  Database has unexpected MOT due date:', data.mot_due_date);
        console.log('   Expected: 2027-03-20');
      }
    }

    console.log('\n' + '='.repeat(70));
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

checkVehicleMotData();

