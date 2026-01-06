/**
 * Fix vehicles that are in vehicle_archive but still showing as active
 * This happened when the archive succeeded but the DELETE failed due to FK constraints
 */

import { config } from 'dotenv';
import { Client } from 'pg';
import { parse } from 'pg-connection-string';

// Load environment variables
config({ path: '.env.local' });

async function fixArchivedVehicles() {
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

    // Find vehicles that are in vehicle_archive but not archived in vehicles table
    const findQuery = `
      SELECT 
        va.vehicle_id,
        va.reg_number,
        v.status as current_status
      FROM vehicle_archive va
      INNER JOIN vehicles v ON va.vehicle_id = v.id
      WHERE v.status != 'archived'
      ORDER BY va.archived_at DESC;
    `;

    console.log('[INFO] Finding vehicles that need to be marked as archived...');
    const result = await client.query(findQuery);

    if (result.rows.length === 0) {
      console.log('[SUCCESS] No vehicles need fixing. All archived vehicles are correctly marked.');
      return;
    }

    console.log(`[INFO] Found ${result.rows.length} vehicle(s) that need to be marked as archived:\n`);
    result.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.reg_number} (ID: ${row.vehicle_id})`);
      console.log(`     Current status: ${row.current_status} (should be 'archived')\n`);
    });

    // Update vehicles to archived status
    const updateQuery = `
      UPDATE vehicles
      SET status = 'archived'
      WHERE id IN (
        SELECT va.vehicle_id
        FROM vehicle_archive va
        INNER JOIN vehicles v ON va.vehicle_id = v.id
        WHERE v.status != 'archived'
      )
      RETURNING id, reg_number;
    `;

    console.log('[INFO] Updating vehicle statuses to "archived"...');
    const updateResult = await client.query(updateQuery);

    console.log(`\n[SUCCESS] Updated ${updateResult.rows.length} vehicle(s):`);
    updateResult.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.reg_number} (ID: ${row.id})`);
    });

    console.log('\n[INFO] ✅ All archived vehicles are now correctly marked.');
    console.log('[INFO] Active vehicles list will no longer show these vehicles.');
    console.log('[INFO] They will only appear in the "Deleted Vehicles" tab.');

  } catch (error) {
    console.error('[ERROR] Failed to fix archived vehicles:', error);
    throw error;
  } finally {
    await client.end();
    console.log('\n[INFO] Database connection closed.');
  }
}

// Run the fix
fixArchivedVehicles()
  .then(() => {
    console.log('\n✅ Fix completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fix failed:', error.message);
    process.exit(1);
  });

