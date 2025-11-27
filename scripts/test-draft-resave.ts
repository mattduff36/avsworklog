/**
 * Test script to reproduce and verify the duplicate key constraint issue
 * 
 * This simulates the exact scenario:
 * 1. Create a draft with Monday items
 * 2. Save it (insert items)
 * 3. Add Tuesday items
 * 4. Save again (should delete old items, insert all items)
 * 
 * Run with: npx tsx scripts/test-draft-resave.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testDraftResave() {
  console.log('🧪 Testing draft re-save with duplicate key constraint...\n');

  let inspectionId: string | null = null;

  try {
    // Get test data
    const { data: users } = await supabase.from('profiles').select('id').limit(1);
    const { data: vehicles } = await supabase.from('vehicles').select('id').eq('status', 'active').limit(1);

    if (!users || !vehicles) throw new Error('Missing test data');

    const userId = users[0].id;
    const vehicleId = vehicles[0].id;

    // Step 1: Create draft inspection
    console.log('📋 Step 1: Creating draft inspection...');
    const { data: inspection, error: createError } = await supabase
      .from('vehicle_inspections')
      .insert({
        vehicle_id: vehicleId,
        user_id: userId,
        inspection_date: '2025-11-25',
        inspection_end_date: '2025-12-01',
        current_mileage: 80000,
        status: 'draft',
      })
      .select()
      .single();

    if (createError || !inspection) throw createError;
    inspectionId = inspection.id;
    console.log(`✅ Created draft: ${inspectionId.substring(0, 8)}...\n`);

    // Step 2: Add Monday items
    console.log('📋 Step 2: Adding Monday items (14 items)...');
    const mondayItems = [];
    for (let i = 1; i <= 14; i++) {
      mondayItems.push({
        inspection_id: inspectionId,
        item_number: i,
        item_description: `Item ${i}`,
        day_of_week: 1,
        status: 'ok',
      });
    }

    const { error: mondayError } = await supabase
      .from('inspection_items')
      .insert(mondayItems);

    if (mondayError) throw mondayError;
    console.log(`✅ Added 14 Monday items\n`);

    // Step 3: Simulate re-save (add Tuesday, delete all, re-insert)
    console.log('📋 Step 3: Simulating re-save (adding Tuesday)...');
    
    // First, delete existing items
    console.log('   Deleting existing items...');
    const { data: deletedItems, error: deleteError } = await supabase
      .from('inspection_items')
      .delete()
      .eq('inspection_id', inspectionId)
      .select();

    if (deleteError) {
      console.error('❌ Delete failed:', deleteError.message);
      throw deleteError;
    }

    console.log(`   ✅ Deleted ${deletedItems?.length || 0} items`);

    // Now insert all items (Monday + Tuesday)
    const allItems = [
      ...mondayItems,
      ...Array.from({ length: 14 }, (_, i) => ({
        inspection_id: inspectionId,
        item_number: i + 1,
        item_description: `Item ${i + 1}`,
        day_of_week: 2,
        status: 'ok',
      })),
    ];

    console.log(`   Inserting ${allItems.length} items (14 Mon + 14 Tue)...`);
    const { data: insertedItems, error: insertError } = await supabase
      .from('inspection_items')
      .insert(allItems)
      .select();

    if (insertError) {
      console.error('❌ Insert failed:', insertError.message);
      throw insertError;
    }

    console.log(`   ✅ Inserted ${insertedItems?.length || 0} items\n`);

    // Step 4: Verify
    console.log('📋 Step 4: Verifying data...');
    const { data: finalItems } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', inspectionId);

    const total = finalItems?.length || 0;
    const monCount = finalItems?.filter(i => i.day_of_week === 1).length || 0;
    const tueCount = finalItems?.filter(i => i.day_of_week === 2).length || 0;

    console.log(`   Total items: ${total}`);
    console.log(`   Monday: ${monCount}`);
    console.log(`   Tuesday: ${tueCount}`);

    if (total === 28 && monCount === 14 && tueCount === 14) {
      console.log('\n✅ SUCCESS! Re-save worked correctly!');
      console.log('   No duplicate key constraint error occurred.');
    } else {
      console.log('\n⚠️  Warning: Unexpected item counts');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error);
  } finally {
    if (inspectionId) {
      console.log('\n🧹 Cleaning up...');
      await supabase.from('vehicle_inspections').delete().eq('id', inspectionId);
      console.log('✅ Cleanup complete');
    }
  }
}

testDraftResave();

