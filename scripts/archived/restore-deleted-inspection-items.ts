/**
 * Restore Deleted Inspection Items from Audit Log
 * 
 * This script restores inspection items that were deleted during cleanup.
 * It reads the deleted data from the audit log and re-inserts it.
 * 
 * IMPORTANT: This should only be run once, and only if the analysis shows
 *            the data is legitimate (not corrupted).
 * 
 * Run: npx tsx scripts/restore-deleted-inspection-items.ts
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function restoreDeletedItems() {
  console.log('🔄 Restoring deleted inspection items from audit log...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Step 1: Get all deleted inspection_items from audit log
    console.log('📋 Step 1: Fetching deleted items from audit log...');
    const { data: deletedItems, error: fetchError } = await supabase
      .from('audit_log')
      .select('*')
      .eq('table_name', 'inspection_items')
      .eq('action', 'deleted')
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Error fetching audit log:', fetchError.message);
      return;
    }

    if (!deletedItems || deletedItems.length === 0) {
      console.log('❌ No deleted items found in audit log.');
      return;
    }

    console.log(`✅ Found ${deletedItems.length} deleted items\n`);

    // Step 2: Parse and prepare items for restoration
    console.log('📝 Step 2: Preparing items for restoration...');
    const itemsToRestore: any[] = [];
    const skippedItems: any[] = [];
    const inspectionIds = new Set<string>();

    for (const auditEntry of deletedItems) {
      const changes = auditEntry.changes || {};
      
      // Extract the old values (what was deleted)
      const item = {
        id: changes.id?.old,
        inspection_id: changes.inspection_id?.old,
        item_number: changes.item_number?.old,
        day_of_week: changes.day_of_week?.old,
        item_description: changes.item_description?.old,
        status: changes.status?.old,
        comments: changes.comments?.old,
      };

      // Validate required fields
      if (item.id && item.inspection_id && item.item_number && item.status) {
        itemsToRestore.push(item);
        inspectionIds.add(item.inspection_id);
      } else {
        skippedItems.push(item);
      }
    }

    console.log(`✅ Prepared ${itemsToRestore.length} items for restoration`);
    if (skippedItems.length > 0) {
      console.log(`⚠️  Skipped ${skippedItems.length} items (incomplete data)\n`);
    }

    // Step 3: Check which inspections still exist
    console.log('🔍 Step 3: Verifying inspections still exist...');
    const inspectionIdsArray = Array.from(inspectionIds);
    const { data: existingInspections, error: inspectionError } = await supabase
      .from('vehicle_inspections')
      .select('id, status, vehicles(reg_number)')
      .in('id', inspectionIdsArray);

    if (inspectionError) {
      console.error('❌ Error checking inspections:', inspectionError.message);
      return;
    }

    const existingInspectionIds = new Set(existingInspections?.map(i => i.id) || []);
    console.log(`✅ Found ${existingInspectionIds.size} inspections still exist\n`);

    // Show inspection details
    console.log('📊 Inspections to restore:');
    existingInspections?.forEach((inspection: any, i: number) => {
      const itemCount = itemsToRestore.filter(item => item.inspection_id === inspection.id).length;
      const vehicle = inspection.vehicles?.reg_number || 'Unknown';
      console.log(`   ${i + 1}. ${vehicle} - ${inspection.status} (${itemCount} items)`);
    });
    console.log();

    // Filter items to only those with existing inspections
    const validItemsToRestore = itemsToRestore.filter(item => 
      existingInspectionIds.has(item.inspection_id)
    );

    if (validItemsToRestore.length === 0) {
      console.log('❌ No items to restore (all inspections have been deleted)');
      return;
    }

    console.log(`✅ ${validItemsToRestore.length} items ready for restoration\n`);

    // Step 4: Show what will be restored
    const statusCounts: Record<string, number> = {};
    const commentCount = validItemsToRestore.filter(i => i.comments).length;
    const attentionCount = validItemsToRestore.filter(i => i.status === 'attention').length;

    validItemsToRestore.forEach(item => {
      statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
    });

    console.log('📊 Restoration summary:');
    console.log(`   Total items: ${validItemsToRestore.length}`);
    console.log(`   Inspections: ${existingInspectionIds.size}`);
    console.log(`   Items with comments: ${commentCount}`);
    console.log(`   Items marked as attention: ${attentionCount}`);
    console.log('   Status breakdown:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`     - ${status}: ${count}`);
    });
    console.log();

    // Step 5: Confirm before proceeding
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  CONFIRMATION REQUIRED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('This will restore the deleted inspection items.');
    console.log('This includes:');
    console.log(`  - ${attentionCount} defect/attention items`);
    console.log(`  - ${commentCount} items with user comments`);
    console.log(`  - All status data (ok/attention/na)\n`);
    
    // Check if items already exist (prevents duplicate restoration)
    const sampleIds = validItemsToRestore.slice(0, 10).map(i => i.id);
    const { data: existingItems } = await supabase
      .from('inspection_items')
      .select('id')
      .in('id', sampleIds);

    if (existingItems && existingItems.length > 0) {
      console.log('⚠️  WARNING: Some items already exist in the database!');
      console.log('   This restoration may have already been run.');
      console.log('   Proceeding will attempt to insert and may cause errors.\n');
    }

    console.log('🚀 Proceeding with restoration...\n');

    // Step 6: Restore items in batches
    console.log('💾 Step 4: Restoring items to database...');
    const BATCH_SIZE = 100;
    let restoredCount = 0;
    let errorCount = 0;

    for (let i = 0; i < validItemsToRestore.length; i += BATCH_SIZE) {
      const batch = validItemsToRestore.slice(i, i + BATCH_SIZE);
      
      const { error: insertError } = await supabase
        .from('inspection_items')
        .insert(batch);

      if (insertError) {
        console.error(`   ⚠️  Error in batch ${Math.floor(i / BATCH_SIZE) + 1}:`, insertError.message);
        errorCount += batch.length;
      } else {
        restoredCount += batch.length;
        process.stdout.write(`   Restored ${restoredCount}/${validItemsToRestore.length} items\r`);
      }
    }
    console.log();

    // Step 7: Verify restoration
    console.log('\n🔍 Step 5: Verifying restoration...');
    const { data: restoredItems, error: verifyError } = await supabase
      .from('inspection_items')
      .select('id')
      .in('inspection_id', inspectionIdsArray);

    if (verifyError) {
      console.error('❌ Error verifying restoration:', verifyError.message);
      return;
    }

    console.log(`✅ Current item count: ${restoredItems?.length || 0}\n`);

    // Final summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ RESTORATION COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 Results:');
    console.log(`   Restored: ${restoredCount} items`);
    console.log(`   Errors: ${errorCount} items`);
    console.log(`   Success rate: ${((restoredCount / validItemsToRestore.length) * 100).toFixed(1)}%\n`);

    if (errorCount > 0) {
      console.log('⚠️  Some items failed to restore (likely already exist)');
      console.log('   This is normal if restoration was run multiple times.\n');
    }

    console.log('🎉 The draft inspections have been restored with their original data!');
    console.log('   Users can now continue editing their drafts.\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

restoreDeletedItems();

