/**
 * Create Baseline Maintenance History for DVLA-Synced Data
 * 
 * This script creates maintenance_history entries for vehicles that have
 * been synced via DVLA API but don't have corresponding history entries.
 * 
 * It creates "baseline" entries to establish the current state in the history log.
 * 
 * Run with: npx tsx scripts/create-dvla-baseline-history.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

interface VehicleWithDvlaData {
  id: string;
  vehicle_id: string;
  reg_number: string;
  tax_due_date: string | null;
  mot_due_date: string | null;
  last_dvla_sync: string;
  dvla_sync_status: string;
}

async function createBaselineHistory() {
  console.log('🔄 Creating Baseline Maintenance History for DVLA-Synced Data...\n');

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Get all vehicles with successful DVLA sync that have tax or MOT data
    const vehiclesQuery = `
      SELECT 
        vm.id,
        vm.vehicle_id,
        v.reg_number,
        vm.tax_due_date,
        vm.mot_due_date,
        vm.last_dvla_sync,
        vm.dvla_sync_status
      FROM vehicle_maintenance vm
      JOIN vehicles v ON v.id = vm.vehicle_id
      WHERE vm.last_dvla_sync IS NOT NULL
        AND vm.dvla_sync_status = 'success'
        AND (vm.tax_due_date IS NOT NULL OR vm.mot_due_date IS NOT NULL)
      ORDER BY vm.last_dvla_sync DESC
    `;

    const { rows: vehicles } = await client.query<VehicleWithDvlaData>(vehiclesQuery);
    console.log(`📊 Found ${vehicles.length} vehicles with DVLA sync data\n`);

    if (vehicles.length === 0) {
      console.log('ℹ️  No vehicles with DVLA sync data found.\n');
      return;
    }

    let insertedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const vehicle of vehicles) {
      const syncDate = vehicle.last_dvla_sync;
      const syncDateStr = new Date(syncDate).toLocaleString();
      
      // Check for existing tax_due_date history from DVLA sync
      if (vehicle.tax_due_date) {
        const checkTaxQuery = `
          SELECT id FROM maintenance_history
          WHERE vehicle_id = $1
            AND field_name = 'tax_due_date'
            AND (
              comment LIKE '%DVLA%'
              OR comment LIKE '%dvla%'
              OR updated_by_name LIKE '%DVLA%'
            )
            AND ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamp))) < 3600
        `;

        const { rows: existingTax } = await client.query(checkTaxQuery, [
          vehicle.vehicle_id,
          syncDate
        ]);

        if (existingTax.length > 0) {
          console.log(`⏭️  [${vehicle.reg_number}] tax_due_date - DVLA history entry already exists`);
          skippedCount++;
        } else {
          // Check if ANY tax_due_date history entry exists within 1 hour of sync
          const checkAnyTaxQuery = `
            SELECT id FROM maintenance_history
            WHERE vehicle_id = $1
              AND field_name = 'tax_due_date'
              AND new_value = $2
          `;
          
          const { rows: anyExistingTax } = await client.query(checkAnyTaxQuery, [
            vehicle.vehicle_id,
            vehicle.tax_due_date
          ]);

          if (anyExistingTax.length > 0) {
            console.log(`⏭️  [${vehicle.reg_number}] tax_due_date - value already in history`);
            skippedCount++;
          } else {
            // Insert baseline history entry
            const insertQuery = `
              INSERT INTO maintenance_history (
                vehicle_id,
                field_name,
                old_value,
                new_value,
                value_type,
                comment,
                updated_by,
                updated_by_name,
                created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `;

            const comment = `Tax due date synced via DVLA API for ${vehicle.reg_number} (baseline entry)`;

            try {
              await client.query(insertQuery, [
                vehicle.vehicle_id,
                'tax_due_date',
                null, // No old value since this is a baseline
                vehicle.tax_due_date,
                'date',
                comment,
                null, // System action
                'DVLA API Sync (Backfill)',
                syncDate
              ]);

              console.log(`✅ [${vehicle.reg_number}] tax_due_date: → ${vehicle.tax_due_date} (synced ${syncDateStr})`);
              insertedCount++;
            } catch (err: any) {
              console.error(`❌ [${vehicle.reg_number}] Failed to insert tax_due_date baseline: ${err.message}`);
              errorCount++;
            }
          }
        }
      }

      // Check for existing mot_due_date history from DVLA sync
      if (vehicle.mot_due_date) {
        const checkMotQuery = `
          SELECT id FROM maintenance_history
          WHERE vehicle_id = $1
            AND field_name = 'mot_due_date'
            AND (
              comment LIKE '%DVLA%'
              OR comment LIKE '%dvla%'
              OR comment LIKE '%MOT API%'
              OR updated_by_name LIKE '%DVLA%'
            )
            AND ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamp))) < 3600
        `;

        const { rows: existingMot } = await client.query(checkMotQuery, [
          vehicle.vehicle_id,
          syncDate
        ]);

        if (existingMot.length > 0) {
          console.log(`⏭️  [${vehicle.reg_number}] mot_due_date - DVLA history entry already exists`);
          skippedCount++;
        } else {
          // Check if ANY mot_due_date history entry exists with this value
          const checkAnyMotQuery = `
            SELECT id FROM maintenance_history
            WHERE vehicle_id = $1
              AND field_name = 'mot_due_date'
              AND new_value = $2
          `;
          
          const { rows: anyExistingMot } = await client.query(checkAnyMotQuery, [
            vehicle.vehicle_id,
            vehicle.mot_due_date
          ]);

          if (anyExistingMot.length > 0) {
            console.log(`⏭️  [${vehicle.reg_number}] mot_due_date - value already in history`);
            skippedCount++;
          } else {
            // Insert baseline history entry
            const insertQuery = `
              INSERT INTO maintenance_history (
                vehicle_id,
                field_name,
                old_value,
                new_value,
                value_type,
                comment,
                updated_by,
                updated_by_name,
                created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `;

            const comment = `MOT due date synced via DVLA/MOT API for ${vehicle.reg_number} (baseline entry)`;

            try {
              await client.query(insertQuery, [
                vehicle.vehicle_id,
                'mot_due_date',
                null, // No old value since this is a baseline
                vehicle.mot_due_date,
                'date',
                comment,
                null, // System action
                'DVLA API Sync (Backfill)',
                syncDate
              ]);

              console.log(`✅ [${vehicle.reg_number}] mot_due_date: → ${vehicle.mot_due_date} (synced ${syncDateStr})`);
              insertedCount++;
            } catch (err: any) {
              console.error(`❌ [${vehicle.reg_number}] Failed to insert mot_due_date baseline: ${err.message}`);
              errorCount++;
            }
          }
        }
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ BASELINE HISTORY CREATION COMPLETED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Summary:`);
    console.log(`   ✅ History entries created: ${insertedCount}`);
    console.log(`   ⏭️  Entries skipped (already exist): ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📝 Note: These are "baseline" entries showing the current state.');
    console.log('   Future DVLA syncs will show old → new value changes.\n');

  } catch (error: any) {
    console.error('\n❌ Baseline creation failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the baseline creation
createBaselineHistory().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
