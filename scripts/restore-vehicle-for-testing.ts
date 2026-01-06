/**
 * Restore NV16 AXC to active status for testing the archive workflow
 */

import { config } from 'dotenv';
import { Client } from 'pg';
import { parse } from 'pg-connection-string';

// Load environment variables
config({ path: '.env.local' });

async function restoreVehicle() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING not found in .env.local');
  }

  const config = parse(connectionString);
  const client = new Client({
    host: config.host!,
    port: parseInt(config.port || '5432'),
    user: config.user!,
    password: config.password!,
    database: config.database!,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('[INFO] Connecting to database...');
    await client.connect();
    console.log('[INFO] Connected successfully\n');

    const regNumber = 'NV16 AXC';

    // Find the vehicle and its archive record
    const findQuery = `
      SELECT 
        v.id,
        v.reg_number,
        v.status,
        va.id as archive_id
      FROM vehicles v
      LEFT JOIN vehicle_archive va ON va.vehicle_id = v.id
      WHERE v.reg_number = $1;
    `;

    console.log(`[INFO] Looking for vehicle: ${regNumber}...`);
    const findResult = await client.query(findQuery, [regNumber]);

    if (findResult.rows.length === 0) {
      console.log(`[ERROR] Vehicle ${regNumber} not found in database.`);
      return;
    }

    const vehicle = findResult.rows[0];
    console.log(`[INFO] Found vehicle:`);
    console.log(`  ID: ${vehicle.id}`);
    console.log(`  Registration: ${vehicle.reg_number}`);
    console.log(`  Current Status: ${vehicle.status}`);
    console.log(`  Archive Record ID: ${vehicle.archive_id || 'None'}\n`);

    // Step 1: Delete from vehicle_archive if exists
    if (vehicle.archive_id) {
      console.log('[INFO] Removing archive record...');
      const deleteArchiveQuery = `
        DELETE FROM vehicle_archive
        WHERE id = $1
        RETURNING id, reg_number;
      `;
      const deleteResult = await client.query(deleteArchiveQuery, [vehicle.archive_id]);
      console.log(`[SUCCESS] Deleted archive record for ${deleteResult.rows[0].reg_number}\n`);
    } else {
      console.log('[INFO] No archive record found (already removed)\n');
    }

    // Step 2: Update vehicle status to active
    if (vehicle.status !== 'active') {
      console.log('[INFO] Setting vehicle status to active...');
      const updateQuery = `
        UPDATE vehicles
        SET status = 'active'
        WHERE id = $1
        RETURNING id, reg_number, status;
      `;
      const updateResult = await client.query(updateQuery, [vehicle.id]);
      console.log(`[SUCCESS] ${updateResult.rows[0].reg_number} is now ${updateResult.rows[0].status}\n`);
    } else {
      console.log('[INFO] Vehicle is already active\n');
    }

    console.log('[INFO] ✅ Vehicle restored successfully!');
    console.log('[INFO] NV16 AXC is now in the Active Vehicles table.');
    console.log('[INFO] Ready for testing the archive workflow.');

  } catch (error) {
    console.error('[ERROR] Failed to restore vehicle:', error);
    throw error;
  } finally {
    await client.end();
    console.log('\n[INFO] Database connection closed.');
  }
}

// Run the restoration
restoreVehicle()
  .then(() => {
    console.log('\n✅ Restoration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Restoration failed:', error.message);
    process.exit(1);
  });

