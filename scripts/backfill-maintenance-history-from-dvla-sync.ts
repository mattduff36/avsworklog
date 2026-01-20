/**
 * Backfill Maintenance History from DVLA Sync Log
 * 
 * This script creates maintenance_history entries for DVLA API sync operations
 * that updated tax_due_date or mot_due_date but weren't logged to maintenance_history
 * (before the logging was added).
 * 
 * Run with: npx tsx scripts/backfill-maintenance-history-from-dvla-sync.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

interface DvlaSyncLogEntry {
  id: string;
  vehicle_id: string;
  registration_number: string;
  sync_status: string;
  fields_updated: string[] | null;
  tax_due_date_old: string | null;
  tax_due_date_new: string | null;
  mot_due_date_old: string | null;
  mot_due_date_new: string | null;
  triggered_by: string | null;
  trigger_type: string | null;
  created_at: string;
  user_name: string | null;
}

async function backfillFromDvlaSyncLog() {
  console.log('🔄 Backfilling Maintenance History from DVLA Sync Log...\n');

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

    // Get all successful DVLA sync log entries with field updates
    const syncLogQuery = `
      SELECT 
        dsl.*,
        p.full_name as user_name
      FROM dvla_sync_log dsl
      LEFT JOIN profiles p ON p.id = dsl.triggered_by
      WHERE dsl.sync_status = 'success'
        AND (
          (dsl.tax_due_date_old IS DISTINCT FROM dsl.tax_due_date_new AND dsl.tax_due_date_new IS NOT NULL)
          OR (dsl.mot_due_date_old IS DISTINCT FROM dsl.mot_due_date_new AND dsl.mot_due_date_new IS NOT NULL)
          OR (dsl.fields_updated IS NOT NULL AND array_length(dsl.fields_updated, 1) > 0)
        )
      ORDER BY dsl.created_at ASC
    `;

    const { rows: syncEntries } = await client.query<DvlaSyncLogEntry>(syncLogQuery);
    console.log(`📊 Found ${syncEntries.length} DVLA sync entries with updates\n`);

    if (syncEntries.length === 0) {
      console.log('ℹ️  No DVLA sync entries with updates found.\n');
      return;
    }

    let insertedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const sync of syncEntries) {
      const vehicleReg = sync.registration_number;
      const syncDate = new Date(sync.created_at);
      const syncDateStr = syncDate.toLocaleString();
      
      // Determine who made the change
      let updaterName: string;
      if (sync.trigger_type === 'automatic') {
        updaterName = 'Scheduled DVLA Sync';
      } else if (sync.user_name) {
        updaterName = `${sync.user_name} (via DVLA Sync)`;
      } else {
        updaterName = 'DVLA API Sync';
      }

      // Check for tax_due_date change
      if (sync.tax_due_date_old !== sync.tax_due_date_new && sync.tax_due_date_new) {
        // Check if history entry already exists (to avoid duplicates)
        const checkQuery = `
          SELECT id FROM maintenance_history
          WHERE vehicle_id = $1
            AND field_name = 'tax_due_date'
            AND (old_value = $2 OR (old_value IS NULL AND $2 IS NULL))
            AND new_value = $3
            AND ABS(EXTRACT(EPOCH FROM (created_at - $4::timestamp))) < 60
        `;

        const { rows: existing } = await client.query(checkQuery, [
          sync.vehicle_id,
          sync.tax_due_date_old,
          sync.tax_due_date_new,
          sync.created_at
        ]);

        if (existing.length > 0) {
          console.log(`⏭️  [${vehicleReg}] tax_due_date - history entry already exists`);
          skippedCount++;
        } else {
          // Insert maintenance_history entry
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

          const comment = sync.trigger_type === 'automatic'
            ? `Tax due date updated automatically via scheduled DVLA API sync for ${vehicleReg}`
            : `Tax due date updated automatically via DVLA API sync for ${vehicleReg}`;

          try {
            await client.query(insertQuery, [
              sync.vehicle_id,
              'tax_due_date',
              sync.tax_due_date_old,
              sync.tax_due_date_new,
              'date',
              comment,
              sync.triggered_by,
              updaterName,
              sync.created_at
            ]);

            console.log(`✅ [${vehicleReg}] tax_due_date: ${sync.tax_due_date_old || 'null'} → ${sync.tax_due_date_new} (${syncDateStr})`);
            insertedCount++;
          } catch (err: any) {
            console.error(`❌ [${vehicleReg}] Failed to insert tax_due_date history: ${err.message}`);
            errorCount++;
          }
        }
      }

      // Check for mot_due_date change (from fields_updated or explicit columns)
      const fieldsUpdated = sync.fields_updated || [];
      const hasMotUpdate = fieldsUpdated.some(f => f.toLowerCase().includes('mot_due_date'));
      
      if (hasMotUpdate || (sync.mot_due_date_old !== sync.mot_due_date_new && sync.mot_due_date_new)) {
        const oldMotDate = sync.mot_due_date_old;
        const newMotDate = sync.mot_due_date_new;

        if (oldMotDate !== newMotDate && newMotDate) {
          // Check if history entry already exists
          const checkQuery = `
            SELECT id FROM maintenance_history
            WHERE vehicle_id = $1
              AND field_name = 'mot_due_date'
              AND (old_value = $2 OR (old_value IS NULL AND $2 IS NULL))
              AND new_value = $3
              AND ABS(EXTRACT(EPOCH FROM (created_at - $4::timestamp))) < 60
          `;

          const { rows: existing } = await client.query(checkQuery, [
            sync.vehicle_id,
            oldMotDate,
            newMotDate,
            sync.created_at
          ]);

          if (existing.length > 0) {
            console.log(`⏭️  [${vehicleReg}] mot_due_date - history entry already exists`);
            skippedCount++;
          } else {
            // Determine if MOT was calculated from first registration
            const wasCalculated = fieldsUpdated.some(f => f.includes('calculated'));
            
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

            let comment: string;
            if (wasCalculated) {
              comment = sync.trigger_type === 'automatic'
                ? `MOT due date calculated from first registration via scheduled DVLA API sync for ${vehicleReg}`
                : `MOT due date calculated from first registration via DVLA API sync for ${vehicleReg}`;
            } else {
              comment = sync.trigger_type === 'automatic'
                ? `MOT due date updated automatically via scheduled DVLA/MOT API sync for ${vehicleReg}`
                : `MOT due date updated automatically via DVLA/MOT API sync for ${vehicleReg}`;
            }

            try {
              await client.query(insertQuery, [
                sync.vehicle_id,
                'mot_due_date',
                oldMotDate,
                newMotDate,
                'date',
                comment,
                sync.triggered_by,
                updaterName,
                sync.created_at
              ]);

              console.log(`✅ [${vehicleReg}] mot_due_date: ${oldMotDate || 'null'} → ${newMotDate} (${syncDateStr})`);
              insertedCount++;
            } catch (err: any) {
              console.error(`❌ [${vehicleReg}] Failed to insert mot_due_date history: ${err.message}`);
              errorCount++;
            }
          }
        }
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ BACKFILL FROM DVLA SYNC LOG COMPLETED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Summary:`);
    console.log(`   ✅ History entries created: ${insertedCount}`);
    console.log(`   ⏭️  Entries skipped (already exist): ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n❌ Backfill failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the backfill
backfillFromDvlaSyncLog().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
