/**
 * Script: Clear all GPS Tracker IDs
 * Purpose: Remove all tracker_id values from vehicle_maintenance table
 * Date: 2026-01-15
 * 
 * These tracker IDs were added in error and need to be cleared
 */

import { config } from 'dotenv';
import { Client } from 'pg';
import { parse } from 'pg-connection-string';

// Load environment variables
config({ path: '.env.local' });

async function clearTrackerIds() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING not found in environment variables');
  }

  // Parse connection string
  const pgConfig = parse(connectionString);
  
  // Create client with SSL config
  const client = new Client({
    host: pgConfig.host!,
    port: parseInt(pgConfig.port || '5432'),
    user: pgConfig.user!,
    password: pgConfig.password!,
    database: pgConfig.database!,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully');

    // Get count of vehicles with tracker_id
    const countResult = await client.query(
      'SELECT COUNT(*) FROM vehicle_maintenance WHERE tracker_id IS NOT NULL'
    );
    const count = parseInt(countResult.rows[0].count);
    console.log(`Found ${count} vehicle(s) with tracker_id values`);

    if (count === 0) {
      console.log('No tracker IDs to clear');
      return;
    }

    // Update all tracker_id values to NULL
    console.log('Clearing all tracker_id values...');
    const updateResult = await client.query(
      'UPDATE vehicle_maintenance SET tracker_id = NULL WHERE tracker_id IS NOT NULL'
    );
    
    console.log(`✅ Successfully cleared ${updateResult.rowCount} tracker_id value(s)`);

    // Verify
    const verifyResult = await client.query(
      'SELECT COUNT(*) FROM vehicle_maintenance WHERE tracker_id IS NOT NULL'
    );
    const remaining = parseInt(verifyResult.rows[0].count);
    
    if (remaining === 0) {
      console.log('✅ Verification: All tracker_id values have been cleared');
    } else {
      console.warn(`⚠️ Warning: ${remaining} tracker_id value(s) still remain`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

// Run the script
clearTrackerIds()
  .then(() => {
    console.log('\n🎉 Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
