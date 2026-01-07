/**
 * Fix the incorrect MOT due date for FE24 TYO by running a manual sync
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import pg from 'pg';
import { createMotHistoryService } from '../lib/services/mot-history-api';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function fixMotDate() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found');
    process.exit(1);
  }

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

    const regNumber = 'FE24 TYO';
    console.log('🔧 Fixing MOT date for:', regNumber);
    console.log('='.repeat(70));

    // Get vehicle ID
    const vehicleResult = await client.query(
      "SELECT id, reg_number FROM vehicles WHERE REPLACE(UPPER(reg_number), ' ', '') = 'FE24TYO'"
    );

    if (vehicleResult.rows.length === 0) {
      console.error('\n❌ Vehicle not found');
      process.exit(1);
    }

    const vehicle = vehicleResult.rows[0];
    console.log('\n📋 Vehicle ID:', vehicle.id);
    console.log('   Registration:', vehicle.reg_number);

    // Call MOT API
    console.log('\n📡 Calling MOT API...');
    const motService = createMotHistoryService();
    
    if (!motService) {
      console.error('❌ MOT service not configured');
      process.exit(1);
    }

    const motData = await motService.getMotExpiryData('FE24TYO');
    
    console.log('\n✅ MOT API Response:');
    console.log('   motExpiryDate:', motData.motExpiryDate);
    console.log('   motStatus:', motData.motStatus);
    console.log('   Raw data fields:');
    console.log('     registrationDate:', motData.rawData.registrationDate);
    console.log('     motTestDueDate:', motData.rawData.motTestDueDate);
    console.log('     firstUsedDate:', motData.rawData.firstUsedDate);

    if (!motData.motExpiryDate) {
      console.error('\n❌ No MOT expiry date returned from API');
      process.exit(1);
    }

    // Update the database
    console.log('\n💾 Updating database...');
    
    const updates: any = {
      mot_due_date: motData.motExpiryDate,
      mot_expiry_date: motData.motExpiryDate,
      mot_raw_data: JSON.stringify(motData.rawData),
      last_mot_api_sync: new Date().toISOString(),
      mot_api_sync_status: 'success',
      mot_api_sync_error: null,
      updated_at: new Date().toISOString(),
    };

    // Add additional fields from raw data
    if (motData.rawData.make) updates.mot_make = motData.rawData.make;
    if (motData.rawData.model) updates.mot_model = motData.rawData.model;
    if (motData.rawData.fuelType) updates.mot_fuel_type = motData.rawData.fuelType;
    if (motData.rawData.primaryColour) updates.mot_primary_colour = motData.rawData.primaryColour;
    if (motData.rawData.registration) updates.mot_registration = motData.rawData.registration;
    if (motData.rawData.manufactureYear) updates.mot_year_of_manufacture = parseInt(motData.rawData.manufactureYear);
    if (motData.rawData.registrationDate) updates.mot_first_used_date = motData.rawData.registrationDate;

    // Check if record exists
    const checkResult = await client.query(
      'SELECT vehicle_id FROM vehicle_maintenance WHERE vehicle_id = $1',
      [vehicle.id]
    );

    if (checkResult.rows.length === 0) {
      // Insert new record
      console.log('   Creating new maintenance record...');
      updates.vehicle_id = vehicle.id;
      
      const columns = Object.keys(updates).join(', ');
      const placeholders = Object.keys(updates).map((_, i) => `$${i + 1}`).join(', ');
      const values = Object.values(updates);
      
      await client.query(
        `INSERT INTO vehicle_maintenance (${columns}) VALUES (${placeholders})`,
        values
      );
    } else {
      // Update existing record
      console.log('   Updating existing maintenance record...');
      
      const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 1}`).join(', ');
      const values = [...Object.values(updates), vehicle.id];
      
      await client.query(
        `UPDATE vehicle_maintenance SET ${setClauses} WHERE vehicle_id = $${values.length}`,
        values
      );
    }

    console.log('\n✅ SUCCESS!');
    console.log('\n   Old MOT Due Date: 2026-02-28 ❌');
    console.log('   New MOT Due Date:', motData.motExpiryDate, '✅');
    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

fixMotDate();

