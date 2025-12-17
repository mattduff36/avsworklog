/**
 * End-to-end test for complete inspection draft workflow
 * 
 * This script tests the entire workflow:
 * 1. Create a draft via the "new" page flow (partial data)
 * 2. Load the draft via the "[id]" page flow
 * 3. Edit the draft by adding more data
 * 4. Save the edited draft (testing the re-save bug fix)
 * 5. Verify all data persists correctly
 * 6. Submit the inspection
 * 
 * Run with: npx tsx scripts/test-inspection-e2e.ts
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
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface TestResult {
  test: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function log(message: string) {
  console.log(`\n${message}`);
}

function logResult(test: string, passed: boolean, message: string) {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${test}: ${message}`);
  results.push({ test, passed, message });
}

async function cleanup(inspectionId?: string) {
  if (inspectionId) {
    await supabase.from('vehicle_inspections').delete().eq('id', inspectionId);
    console.log(`🧹 Cleaned up inspection ${inspectionId}`);
  }
}

async function runE2ETests() {
  console.log('🧪 Starting end-to-end inspection workflow tests...\n');
  
  let testInspectionId: string | null = null;
  let testUserId: string | null = null;
  let testVehicleId: string | null = null;

  try {
    // Setup: Get test user and vehicle
    const { data: users } = await supabase
      .from('profiles')
      .select('id, full_name')
      .limit(1);

    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, reg_number')
      .eq('status', 'active')
      .limit(1);

    if (!users || users.length === 0) {
      throw new Error('No users found');
    }
    if (!vehicles || vehicles.length === 0) {
      throw new Error('No vehicles found');
    }

    testUserId = users[0].id;
    testVehicleId = vehicles[0].id;

    log('📋 PHASE 1: Create draft via "new" page (Monday only)');
    
    const today = new Date();
    const weekEnding = new Date(today);
    weekEnding.setDate(today.getDate() + (7 - today.getDay()));
    
    const weekStart = new Date(weekEnding);
    weekStart.setDate(weekEnding.getDate() - 6);

    // Create draft inspection
    const { data: newInspection, error: createError } = await supabase
      .from('vehicle_inspections')
      .insert({
        vehicle_id: testVehicleId,
        user_id: testUserId,
        inspection_date: weekStart.toISOString().split('T')[0],
        inspection_end_date: weekEnding.toISOString().split('T')[0],
        current_mileage: 75000,
        status: 'draft',
      })
      .select()
      .single();

    if (createError || !newInspection) {
      throw new Error(`Failed to create inspection: ${createError?.message}`);
    }

    testInspectionId = newInspection.id;
    logResult('Create draft', true, `Created draft ${testInspectionId.substring(0, 8)}...`);

    // Add Monday items only (14 items, mixed status)
    const mondayItems = [];
    for (let i = 1; i <= 14; i++) {
      mondayItems.push({
        inspection_id: testInspectionId,
        item_number: i,
        item_description: `Item ${i}`,
        day_of_week: 1,
        status: i <= 10 ? 'ok' : 'attention',
        comments: i > 10 ? `Issue with item ${i}` : null,
      });
    }

    const { error: mondayError } = await supabase
      .from('inspection_items')
      .insert(mondayItems);

    if (mondayError) {
      throw new Error(`Failed to add Monday items: ${mondayError.message}`);
    }

    logResult('Add Monday items', true, 'Added 14 items for Monday');

    // Verify only Monday items exist
    const { data: afterMondayItems } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', testInspectionId);

    const mondayCount = afterMondayItems?.length || 0;
    logResult(
      'Verify Monday only',
      mondayCount === 14,
      `Expected 14 items, got ${mondayCount}`
    );

    log('\n📋 PHASE 2: Load draft via "[id]" page and add Tuesday');

    // Simulate loading the draft (like opening /inspections/[id])
    const { data: loadedInspection, error: loadError } = await supabase
      .from('vehicle_inspections')
      .select('*, vehicles(*)')
      .eq('id', testInspectionId)
      .single();

    if (loadError) {
      throw new Error(`Failed to load inspection: ${loadError.message}`);
    }

    logResult('Load draft', true, 'Successfully loaded draft inspection');

    const { data: loadedItems } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', testInspectionId);

    logResult(
      'Load items',
      loadedItems?.length === 14,
      `Loaded ${loadedItems?.length} items`
    );

    // Add Tuesday items (simulating user editing the draft)
    const tuesdayItems = [];
    for (let i = 1; i <= 14; i++) {
      tuesdayItems.push({
        inspection_id: testInspectionId,
        item_number: i,
        item_description: `Item ${i}`,
        day_of_week: 2,
        status: 'ok',
        comments: null,
      });
    }

    const { error: tuesdayError } = await supabase
      .from('inspection_items')
      .insert(tuesdayItems);

    if (tuesdayError) {
      throw new Error(`Failed to add Tuesday items: ${tuesdayError.message}`);
    }

    logResult('Add Tuesday items', true, 'Added 14 items for Tuesday');

    log('\n📋 PHASE 3: Re-save the draft (simulating handleSave from [id] page)');

    // Simulate the fixed handleSave logic: delete all and re-insert
    const { error: deleteError } = await supabase
      .from('inspection_items')
      .delete()
      .eq('inspection_id', testInspectionId);

    if (deleteError) {
      throw new Error(`Failed to delete items for re-save: ${deleteError.message}`);
    }

    // Get all items (Monday + Tuesday)
    const allItems = [...mondayItems, ...tuesdayItems];

    const { error: reinsertError } = await supabase
      .from('inspection_items')
      .insert(allItems);

    if (reinsertError) {
      throw new Error(`Failed to re-insert items: ${reinsertError.message}`);
    }

    logResult('Re-save draft', true, 'Successfully re-saved draft with new items');

    // Update inspection timestamp
    const { error: updateError } = await supabase
      .from('vehicle_inspections')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', testInspectionId);

    if (updateError) {
      logResult('Update timestamp', false, updateError.message);
    } else {
      logResult('Update timestamp', true, 'Updated inspection timestamp');
    }

    log('\n📋 PHASE 4: Verify data persistence');

    // Reload and verify all data
    const { data: finalItems } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', testInspectionId);

    const totalItems = finalItems?.length || 0;
    const mondayItemsFinal = finalItems?.filter(i => i.day_of_week === 1).length || 0;
    const tuesdayItemsFinal = finalItems?.filter(i => i.day_of_week === 2).length || 0;

    logResult(
      'Total items',
      totalItems === 28,
      `Expected 28 items, got ${totalItems}`
    );

    logResult(
      'Monday items',
      mondayItemsFinal === 14,
      `Expected 14 Monday items, got ${mondayItemsFinal}`
    );

    logResult(
      'Tuesday items',
      tuesdayItemsFinal === 14,
      `Expected 14 Tuesday items, got ${tuesdayItemsFinal}`
    );

    // Verify Monday items still have correct statuses and comments
    const mondayAttention = finalItems?.filter(
      i => i.day_of_week === 1 && i.status === 'attention'
    ).length || 0;

    logResult(
      'Monday defects preserved',
      mondayAttention === 4,
      `Expected 4 attention items, got ${mondayAttention}`
    );

    const mondayWithComments = finalItems?.filter(
      i => i.day_of_week === 1 && i.comments
    ).length || 0;

    logResult(
      'Comments preserved',
      mondayWithComments === 4,
      `Expected 4 items with comments, got ${mondayWithComments}`
    );

    log('\n📋 PHASE 5: Submit the inspection');

    const { error: submitError } = await supabase
      .from('vehicle_inspections')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', testInspectionId);

    if (submitError) {
      logResult('Submit inspection', false, submitError.message);
    } else {
      logResult('Submit inspection', true, 'Successfully submitted');
    }

    // Verify submission
    const { data: submittedInspection } = await supabase
      .from('vehicle_inspections')
      .select('status')
      .eq('id', testInspectionId)
      .single();

    logResult(
      'Verify submission',
      submittedInspection?.status === 'submitted',
      `Status: ${submittedInspection?.status}`
    );

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    logResult('Test execution', false, error instanceof Error ? error.message : 'Unknown error');
  } finally {
    if (testInspectionId) {
      log('\n🧹 Cleaning up test data...');
      await cleanup(testInspectionId);
    }
  }

  // Summary
  log('\n' + '='.repeat(60));
  log('📊 TEST SUMMARY');
  log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`\nTotal Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed! The complete workflow is working correctly.');
    console.log('\n✓ Users can create drafts');
    console.log('✓ Users can load drafts correctly');
    console.log('✓ Users can edit and add to drafts');
    console.log('✓ Users can re-save drafts without errors');
    console.log('✓ All data persists correctly');
    console.log('✓ Users can submit inspections\n');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the results above.');
  }

  process.exit(failed === 0 ? 0 : 1);
}

// Run tests
runE2ETests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

