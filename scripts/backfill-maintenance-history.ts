/**
 * Backfill Maintenance History from Audit Log
 * 
 * This script creates maintenance_history entries for vehicle_maintenance
 * changes that were logged in audit_log but missed maintenance_history
 * due to the bug where .single() was used on multi-row inserts.
 * 
 * Run with: npx tsx scripts/backfill-maintenance-history.ts
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

async function backfillMaintenanceHistory() {
  console.log('🔄 Backfilling Maintenance History from Audit Log...\n');

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

    // Get all vehicle_maintenance audit log entries
    const auditQuery = `
      SELECT 
        al.*,
        vm.vehicle_id,
        p.full_name as user_name
      FROM audit_log al
      LEFT JOIN vehicle_maintenance vm ON vm.id = al.record_id
      LEFT JOIN profiles p ON p.id = al.user_id
      WHERE al.table_name = 'vehicle_maintenance'
        AND al.action = 'updated'
      ORDER BY al.created_at DESC
    `;

    const { rows: auditEntries } = await client.query(auditQuery);
    console.log(`📊 Found ${auditEntries.length} vehicle_maintenance audit entries\n`);

    if (auditEntries.length === 0) {
      console.log('ℹ️  No audit entries found. The changes may have occurred before the audit trigger was added.');
      console.log('   You may need to manually create history entries based on known changes.\n');
      return;
    }

    let insertedCount = 0;
    let skippedCount = 0;

    for (const audit of auditEntries) {
      if (!audit.vehicle_id) {
        console.log(`⚠️  Skipping audit entry ${audit.id} - vehicle not found`);
        skippedCount++;
        continue;
      }

      // Parse the changes JSON
      const changes = audit.changes || {};
      const changeKeys = Object.keys(changes);

      if (changeKeys.length === 0) {
        console.log(`⚠️  Skipping audit entry ${audit.id} - no changes recorded`);
        skippedCount++;
        continue;
      }

      console.log(`\n📝 Processing audit entry for vehicle_id: ${audit.vehicle_id}`);
      console.log(`   User: ${audit.user_name || 'Unknown'}`);
      console.log(`   Date: ${new Date(audit.created_at).toLocaleString()}`);
      console.log(`   Fields changed: ${changeKeys.join(', ')}`);

      // Create a maintenance_history entry for each changed field
      for (const fieldName of changeKeys) {
        const change = changes[fieldName];
        const oldValue = change.old !== null && change.old !== undefined ? String(change.old) : null;
        const newValue = change.new !== null && change.new !== undefined ? String(change.new) : null;

        // Determine value type
        let valueType: 'date' | 'mileage' | 'text' = 'text';
        if (fieldName.includes('date') || fieldName.includes('expiry')) {
          valueType = 'date';
        } else if (fieldName.includes('mileage')) {
          valueType = 'mileage';
        }

        // Check if history entry already exists
        const checkQuery = `
          SELECT id FROM maintenance_history
          WHERE vehicle_id = $1
            AND field_name = $2
            AND old_value = $3
            AND new_value = $4
            AND updated_by = $5
            AND created_at = $6
        `;

        const { rows: existing } = await client.query(checkQuery, [
          audit.vehicle_id,
          fieldName,
          oldValue,
          newValue,
          audit.user_id,
          audit.created_at
        ]);

        if (existing.length > 0) {
          console.log(`   ⏭️  Skipping ${fieldName} - history entry already exists`);
          skippedCount++;
          continue;
        }

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

        const comment = `Backfilled from audit log - Change made via Vehicle Maintenance update`;

        await client.query(insertQuery, [
          audit.vehicle_id,
          fieldName,
          oldValue,
          newValue,
          valueType,
          comment,
          audit.user_id,
          audit.user_name || 'Unknown User',
          audit.created_at
        ]);

        console.log(`   ✅ Created history entry for ${fieldName}`);
        insertedCount++;
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ BACKFILL COMPLETED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Summary:`);
    console.log(`   ✅ History entries created: ${insertedCount}`);
    console.log(`   ⏭️  Entries skipped (already exist): ${skippedCount}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n❌ Backfill failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the backfill
backfillMaintenanceHistory().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
