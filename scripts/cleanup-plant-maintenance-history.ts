#!/usr/bin/env tsx

/**
 * Cleanup Plant Maintenance History
 * 
 * Removes maintenance history entries for plant records that:
 * 1. Have no actual changes (blank updates where old_value = new_value = null)
 * 2. Contain the word "test" in the comment field
 * 
 * This script is safe to run multiple times.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const { Client } = pg;

interface HistoryEntry {
  id: string;
  plant_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  comment: string;
  created_at: string;
  updated_by_name: string;
}

async function cleanupPlantMaintenanceHistory() {
  console.log('🧹 Starting Plant Maintenance History Cleanup...\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING environment variable is not set');
  }

  const config = parseConnectionString(connectionString);
  
  const client = new Client({
    host: config.host!,
    port: parseInt(config.port || '5432', 10),
    database: config.database!,
    user: config.user!,
    password: config.password!,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // ========================================================================
    // STEP 1: Find and count entries to delete
    // ========================================================================
    
    console.log('📊 Analyzing maintenance history entries...\n');

    const countQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE old_value IS NULL AND new_value IS NULL) as blank_count,
        COUNT(*) FILTER (WHERE comment ILIKE '%test%') as test_count,
        COUNT(*) FILTER (WHERE old_value IS NULL AND new_value IS NULL AND comment ILIKE '%test%') as both_count,
        COUNT(*) as total_to_delete
      FROM maintenance_history
      WHERE plant_id IS NOT NULL
        AND (
          (old_value IS NULL AND new_value IS NULL) -- Blank updates
          OR comment ILIKE '%test%' -- Contains "test"
        )
    `;

    const countResult = await client.query(countQuery);
    const counts = countResult.rows[0];

    console.log('Found entries to delete:');
    console.log(`  - Blank updates (no actual change): ${counts.blank_count}`);
    console.log(`  - Contains "test" in comment: ${counts.test_count}`);
    console.log(`  - Both conditions: ${counts.both_count}`);
    console.log(`  - Total entries to delete: ${counts.total_to_delete}\n`);

    if (parseInt(counts.total_to_delete) === 0) {
      console.log('✅ No entries to delete. Database is clean!');
      return;
    }

    // ========================================================================
    // STEP 2: Show sample entries that will be deleted
    // ========================================================================

    console.log('📋 Sample entries that will be deleted:\n');

    const sampleQuery = `
      SELECT 
        id,
        plant_id,
        field_name,
        old_value,
        new_value,
        comment,
        created_at,
        updated_by_name
      FROM maintenance_history
      WHERE plant_id IS NOT NULL
        AND (
          (old_value IS NULL AND new_value IS NULL)
          OR comment ILIKE '%test%'
        )
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const sampleResult = await client.query<HistoryEntry>(sampleQuery);
    
    sampleResult.rows.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.field_name}`);
      console.log(`   Plant ID: ${entry.plant_id}`);
      console.log(`   Old Value: ${entry.old_value || 'null'}`);
      console.log(`   New Value: ${entry.new_value || 'null'}`);
      console.log(`   Comment: "${entry.comment}"`);
      console.log(`   Created: ${new Date(entry.created_at).toLocaleString()}`);
      console.log(`   By: ${entry.updated_by_name}`);
      console.log('');
    });

    // ========================================================================
    // STEP 3: Confirm deletion
    // ========================================================================

    console.log(`⚠️  About to delete ${counts.total_to_delete} maintenance history entries.`);
    console.log('This action cannot be undone.\n');

    // Check if running in non-interactive mode (CI/automation)
    if (process.env.CI || process.env.AUTO_CONFIRM === 'true') {
      console.log('🤖 Auto-confirm enabled, proceeding with deletion...\n');
    } else {
      // In interactive mode, require manual confirmation
      console.log('To proceed, set AUTO_CONFIRM=true environment variable.\n');
      console.log('Example: AUTO_CONFIRM=true tsx scripts/cleanup-plant-maintenance-history.ts');
      console.log('\n❌ Deletion cancelled (safety check)');
      return;
    }

    // ========================================================================
    // STEP 4: Delete entries
    // ========================================================================

    console.log('🗑️  Deleting entries...\n');

    const deleteQuery = `
      DELETE FROM maintenance_history
      WHERE plant_id IS NOT NULL
        AND (
          (old_value IS NULL AND new_value IS NULL)
          OR comment ILIKE '%test%'
        )
    `;

    const deleteResult = await client.query(deleteQuery);
    
    console.log(`✅ Successfully deleted ${deleteResult.rowCount} maintenance history entries\n`);

    // ========================================================================
    // STEP 5: Verify cleanup
    // ========================================================================

    console.log('🔍 Verifying cleanup...\n');

    const verifyQuery = `
      SELECT COUNT(*) as remaining_count
      FROM maintenance_history
      WHERE plant_id IS NOT NULL
        AND (
          (old_value IS NULL AND new_value IS NULL)
          OR comment ILIKE '%test%'
        )
    `;

    const verifyResult = await client.query(verifyQuery);
    const remainingCount = parseInt(verifyResult.rows[0].remaining_count);

    if (remainingCount === 0) {
      console.log('✅ Cleanup verified! No problematic entries remain.\n');
    } else {
      console.warn(`⚠️  Warning: ${remainingCount} entries still remain. This may indicate a database issue.\n`);
    }

    // ========================================================================
    // STEP 6: Show current statistics
    // ========================================================================

    console.log('📊 Final statistics:\n');

    const statsQuery = `
      SELECT 
        COUNT(*) as total_plant_history,
        COUNT(DISTINCT plant_id) as unique_plants,
        MIN(created_at) as oldest_entry,
        MAX(created_at) as newest_entry
      FROM maintenance_history
      WHERE plant_id IS NOT NULL
    `;

    const statsResult = await client.query(statsQuery);
    const stats = statsResult.rows[0];

    console.log(`Total plant maintenance history entries: ${stats.total_plant_history}`);
    console.log(`Unique plants with history: ${stats.unique_plants}`);
    if (stats.oldest_entry) {
      console.log(`Oldest entry: ${new Date(stats.oldest_entry).toLocaleString()}`);
      console.log(`Newest entry: ${new Date(stats.newest_entry).toLocaleString()}`);
    }

    console.log('\n✅ Cleanup completed successfully!');

  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
    throw error;
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the cleanup
cleanupPlantMaintenanceHistory()
  .then(() => {
    console.log('\n✨ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
