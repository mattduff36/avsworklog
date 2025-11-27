/**
 * Cleanup script for corrupted draft inspections
 * 
 * This script:
 * 1. Finds all draft inspections
 * 2. Deletes ALL inspection items for those drafts
 * 3. Resets the drafts to a clean state (empty)
 * 
 * This is necessary because a bug caused all items to default to 'ok',
 * resulting in drafts showing 98 items all marked as complete when they weren't.
 * 
 * Run with: npx tsx scripts/cleanup-corrupted-draft-inspections.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupDraftInspections() {
  console.log('🧹 Starting cleanup of corrupted draft inspections...\n');

  try {
    // Step 1: Find all draft inspections
    console.log('📋 Step 1: Finding all draft inspections...');
    const { data: draftInspections, error: fetchError } = await supabase
      .from('vehicle_inspections')
      .select(`
        id,
        inspection_date,
        inspection_end_date,
        vehicles (
          reg_number
        )
      `)
      .eq('status', 'draft')
      .order('created_at', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch draft inspections: ${fetchError.message}`);
    }

    const draftCount = draftInspections?.length || 0;
    console.log(`   Found ${draftCount} draft inspection(s)\n`);

    if (draftCount === 0) {
      console.log('✅ No draft inspections found. Nothing to clean up.');
      return;
    }

    // Display drafts that will be cleaned
    console.log('📝 Draft inspections that will be reset:\n');
    draftInspections?.forEach((draft: any, index: number) => {
      const vehicle = draft.vehicles?.reg_number || 'Unknown vehicle';
      const dateRange = draft.inspection_end_date 
        ? `${draft.inspection_date} to ${draft.inspection_end_date}`
        : draft.inspection_date;
      console.log(`   ${index + 1}. ${vehicle} - ${dateRange} (ID: ${draft.id.substring(0, 8)}...)`);
    });

    console.log('\n⚠️  WARNING: This will DELETE ALL inspection items for these drafts!');
    console.log('   Users will need to re-complete their draft inspections from scratch.\n');

    // Step 2: Count existing items before deletion
    console.log('📊 Step 2: Counting existing inspection items...');
    let totalItemsDeleted = 0;

    for (const draft of draftInspections || []) {
      const { count, error: countError } = await supabase
        .from('inspection_items')
        .select('*', { count: 'exact', head: true })
        .eq('inspection_id', draft.id);

      if (!countError && count) {
        totalItemsDeleted += count;
      }
    }

    console.log(`   Total items to be deleted: ${totalItemsDeleted}\n`);

    // Step 3: Delete all items for draft inspections
    console.log('🗑️  Step 3: Deleting all inspection items for drafts...');
    
    const draftIds = draftInspections?.map(d => d.id) || [];
    
    const { error: deleteError } = await supabase
      .from('inspection_items')
      .delete()
      .in('inspection_id', draftIds);

    if (deleteError) {
      throw new Error(`Failed to delete inspection items: ${deleteError.message}`);
    }

    console.log(`   ✅ Successfully deleted ${totalItemsDeleted} inspection items\n`);

    // Step 4: Verify cleanup
    console.log('✓ Step 4: Verifying cleanup...');
    
    const { count: remainingCount, error: verifyError } = await supabase
      .from('inspection_items')
      .select('*', { count: 'exact', head: true })
      .in('inspection_id', draftIds);

    if (verifyError) {
      console.error('   ⚠️  Warning: Could not verify cleanup');
    } else {
      console.log(`   Remaining items: ${remainingCount || 0}`);
      if (remainingCount === 0) {
        console.log('   ✅ All items successfully removed\n');
      } else {
        console.log('   ⚠️  Warning: Some items may remain\n');
      }
    }

    // Summary
    console.log('='.repeat(60));
    console.log('📊 CLEANUP SUMMARY');
    console.log('='.repeat(60));
    console.log(`Draft inspections found: ${draftCount}`);
    console.log(`Inspection items deleted: ${totalItemsDeleted}`);
    console.log(`\n✅ Cleanup complete!`);
    console.log('\n📝 Next steps for users:');
    console.log('   - Users with draft inspections will need to re-complete them');
    console.log('   - The drafts are now in a clean state (empty)');
    console.log('   - The bug that caused this issue has been fixed\n');

  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
    process.exit(1);
  }
}

// Run cleanup
cleanupDraftInspections().then(() => {
  console.log('🎉 Script completed successfully!');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

