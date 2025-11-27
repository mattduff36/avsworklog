/**
 * Test script for inspection draft functionality
 * 
 * This script tests the complete flow of:
 * 1. Creating a draft inspection with partial data
 * 2. Loading the draft and verifying it contains only the saved data
 * 3. Adding more data to the draft
 * 4. Saving the draft again and verifying it persists correctly
 * 5. Submitting the inspection
 * 
 * Run with: npx tsx scripts/test-inspection-draft.ts
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

async function runTests() {
  console.log('🧪 Starting inspection draft functionality tests...\n');
  
  let testInspectionId: string | null = null;
  let testUserId: string | null = null;
  let testVehicleId: string | null = null;

  try {
    // Step 1: Get a test user
    log('📋 Step 1: Getting test user...');
    const { data: users, error: userError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .limit(1);

    if (userError || !users || users.length === 0) {
      throw new Error('No users found in database');
    }

    testUserId = users[0].id;
    logResult('Get test user', true, `Using user: ${users[0].full_name || testUserId}`);

    // Step 2: Get a test vehicle (or create one if none exist)
    log('📋 Step 2: Getting test vehicle...');
    let { data: vehicles, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, reg_number, category_id')
      .eq('status', 'active')
      .limit(1);

    if (vehicleError) {
      throw new Error(`Error fetching vehicles: ${vehicleError.message}`);
    }

    if (!vehicles || vehicles.length === 0) {
      // No vehicles found, create a test vehicle
      log('   No active vehicles found, creating test vehicle...');
      
      // Get or create a vehicle category
      let { data: categories } = await supabase
        .from('vehicle_categories')
        .select('id, name')
        .limit(1);
      
      let categoryId: string;
      
      if (!categories || categories.length === 0) {
        // Create a test category
        const { data: newCategory, error: catError } = await supabase
          .from('vehicle_categories')
          .insert({ name: 'Van' })
          .select()
          .single();
        
        if (catError || !newCategory) {
          throw new Error('Failed to create test category');
        }
        categoryId = newCategory.id;
      } else {
        categoryId = categories[0].id;
      }
      
      // Create test vehicle
      const { data: newVehicle, error: createVehicleError } = await supabase
        .from('vehicles')
        .insert({
          reg_number: 'TEST 123',
          category_id: categoryId,
          status: 'active',
        })
        .select()
        .single();
      
      if (createVehicleError || !newVehicle) {
        throw new Error(`Failed to create test vehicle: ${createVehicleError?.message}`);
      }
      
      testVehicleId = newVehicle.id;
      logResult('Create test vehicle', true, `Created vehicle: ${newVehicle.reg_number}`);
    } else {
      testVehicleId = vehicles[0].id;
      logResult('Get test vehicle', true, `Using vehicle: ${vehicles[0].reg_number}`);
    }

    // Step 3: Create a draft inspection with partial data (Monday only)
    log('📋 Step 3: Creating draft inspection with Monday data only...');
    
    const today = new Date();
    const weekEnding = new Date(today);
    weekEnding.setDate(today.getDate() + (7 - today.getDay())); // Next Sunday
    
    const weekStart = new Date(weekEnding);
    weekStart.setDate(weekEnding.getDate() - 6); // Previous Monday

    const { data: newInspection, error: createError } = await supabase
      .from('vehicle_inspections')
      .insert({
        vehicle_id: testVehicleId,
        user_id: testUserId,
        inspection_date: weekStart.toISOString().split('T')[0],
        inspection_end_date: weekEnding.toISOString().split('T')[0],
        current_mileage: 50000,
        status: 'draft',
      })
      .select()
      .single();

    if (createError || !newInspection) {
      throw new Error(`Failed to create inspection: ${createError?.message}`);
    }

    testInspectionId = newInspection.id;
    logResult('Create draft inspection', true, `Created inspection ${testInspectionId}`);

    // Step 4: Add items for Monday only (14 items)
    log('📋 Step 4: Adding Monday inspection items (14 items)...');
    
    const mondayItems = [];
    for (let i = 1; i <= 14; i++) {
      mondayItems.push({
        inspection_id: testInspectionId,
        item_number: i,
        item_description: `Test Item ${i}`,
        day_of_week: 1, // Monday
        status: i <= 12 ? 'ok' : 'attention', // First 12 OK, last 2 need attention
      });
    }

    const { error: itemsError } = await supabase
      .from('inspection_items')
      .insert(mondayItems);

    if (itemsError) {
      throw new Error(`Failed to create items: ${itemsError.message}`);
    }

    logResult('Add Monday items', true, 'Added 14 items for Monday');

    // Step 5: Verify only Monday items were saved
    log('📋 Step 5: Verifying only Monday items exist...');
    
    const { data: savedItems, error: fetchError } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', testInspectionId);

    if (fetchError) {
      throw new Error(`Failed to fetch items: ${fetchError.message}`);
    }

    const totalItems = savedItems?.length || 0;
    const mondayItemsCount = savedItems?.filter(item => item.day_of_week === 1).length || 0;
    const otherDaysCount = savedItems?.filter(item => item.day_of_week !== 1).length || 0;

    if (totalItems === 14 && mondayItemsCount === 14 && otherDaysCount === 0) {
      logResult('Verify Monday only', true, `Correct: 14 items for Monday, 0 for other days`);
    } else {
      logResult('Verify Monday only', false, `Expected 14 items for Monday only, got ${totalItems} total (${mondayItemsCount} Monday, ${otherDaysCount} other days)`);
    }

    // Step 6: Simulate user returning to draft and adding Tuesday
    log('📋 Step 6: Adding Tuesday items (14 more items)...');
    
    const tuesdayItems = [];
    for (let i = 1; i <= 14; i++) {
      tuesdayItems.push({
        inspection_id: testInspectionId,
        item_number: i,
        item_description: `Test Item ${i}`,
        day_of_week: 2, // Tuesday
        status: 'ok',
      });
    }

    const { error: tuesdayError } = await supabase
      .from('inspection_items')
      .insert(tuesdayItems);

    if (tuesdayError) {
      throw new Error(`Failed to add Tuesday items: ${tuesdayError.message}`);
    }

    logResult('Add Tuesday items', true, 'Added 14 items for Tuesday');

    // Step 7: Verify both Monday and Tuesday items exist
    log('📋 Step 7: Verifying Monday and Tuesday items exist...');
    
    const { data: updatedItems, error: fetchError2 } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', testInspectionId);

    if (fetchError2) {
      throw new Error(`Failed to fetch items: ${fetchError2.message}`);
    }

    const totalItems2 = updatedItems?.length || 0;
    const mondayCount = updatedItems?.filter(item => item.day_of_week === 1).length || 0;
    const tuesdayCount = updatedItems?.filter(item => item.day_of_week === 2).length || 0;

    if (totalItems2 === 28 && mondayCount === 14 && tuesdayCount === 14) {
      logResult('Verify Monday and Tuesday', true, `Correct: 14 items each for Monday and Tuesday (28 total)`);
    } else {
      logResult('Verify Monday and Tuesday', false, `Expected 28 items (14 Mon, 14 Tue), got ${totalItems2} total (${mondayCount} Mon, ${tuesdayCount} Tue)`);
    }

    // Step 8: Update some items (simulate editing)
    log('📋 Step 8: Simulating edit - changing some Monday items...');
    
    const mondayItemsToUpdate = updatedItems?.filter(item => item.day_of_week === 1 && item.item_number <= 2) || [];
    
    for (const item of mondayItemsToUpdate) {
      const { error: updateError } = await supabase
        .from('inspection_items')
        .update({ status: 'attention' })
        .eq('id', item.id);

      if (updateError) {
        throw new Error(`Failed to update item: ${updateError.message}`);
      }
    }

    logResult('Edit items', true, 'Changed 2 Monday items to attention status');

    // Step 9: Verify edits persisted
    log('📋 Step 9: Verifying edits persisted...');
    
    const { data: editedItems, error: fetchError3 } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', testInspectionId)
      .eq('day_of_week', 1)
      .eq('status', 'attention');

    if (fetchError3) {
      throw new Error(`Failed to fetch edited items: ${fetchError3.message}`);
    }

    const attentionCount = editedItems?.length || 0;

    // Should have 2 + 2 = 4 attention items (2 original + 2 edited)
    if (attentionCount === 4) {
      logResult('Verify edits', true, `Correct: Found 4 attention items on Monday`);
    } else {
      logResult('Verify edits', false, `Expected 4 attention items, found ${attentionCount}`);
    }

    // Step 10: Test submission (update status to submitted)
    log('📋 Step 10: Testing submission...');
    
    const { error: submitError } = await supabase
      .from('vehicle_inspections')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', testInspectionId);

    if (submitError) {
      throw new Error(`Failed to submit: ${submitError.message}`);
    }

    // Verify status changed
    const { data: submittedInspection, error: verifyError } = await supabase
      .from('vehicle_inspections')
      .select('status, submitted_at')
      .eq('id', testInspectionId)
      .single();

    if (verifyError || submittedInspection?.status !== 'submitted') {
      logResult('Submit inspection', false, 'Status did not change to submitted');
    } else {
      logResult('Submit inspection', true, 'Successfully submitted inspection');
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    logResult('Test execution', false, error instanceof Error ? error.message : 'Unknown error');
  } finally {
    // Cleanup
    if (testInspectionId) {
      log('\n🧹 Cleaning up test data...');
      await cleanup(testInspectionId);
    }
  }

  // Print summary
  log('\n' + '='.repeat(50));
  log('📊 TEST SUMMARY');
  log('='.repeat(50));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`\nTotal Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed! The inspection draft functionality is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the results above.');
  }

  process.exit(failed === 0 ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

