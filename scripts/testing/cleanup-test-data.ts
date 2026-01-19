/**
 * Cleanup Test Data
 * 
 * Removes all test inspections and tasks containing "TEST19"
 * Only affects: TE57 VAN and TE57 HGV
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function cleanup() {
  console.log('🧹 Cleaning up test data (TEST19)...\n');

  const testVehicles = ['TE57 VAN', 'TE57 HGV'];

  for (const regNumber of testVehicles) {
    console.log(`\n📋 Cleaning: ${regNumber}`);

    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('reg_number', regNumber)
      .single();

    if (!vehicle) {
      console.log(`   ❌ Vehicle not found`);
      continue;
    }

    // Delete tasks containing TEST19
    const { data: tasks } = await supabase
      .from('actions')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .or('description.ilike.%TEST19%,workshop_comments.ilike.%TEST19%,logged_comment.ilike.%TEST19%');

    if (tasks && tasks.length > 0) {
      await supabase
        .from('actions')
        .delete()
        .in('id', tasks.map(t => t.id));
      
      console.log(`   ✅ Deleted ${tasks.length} test task(s)`);
    } else {
      console.log(`   ℹ️  No test tasks to delete`);
    }

    // Delete inspections (items will cascade)
    const { data: inspections } = await supabase
      .from('vehicle_inspections')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .gte('inspection_date', '2026-01-19'); // Only recent test inspections

    if (inspections && inspections.length > 0) {
      await supabase
        .from('vehicle_inspections')
        .delete()
        .in('id', inspections.map(i => i.id));
      
      console.log(`   ✅ Deleted ${inspections.length} test inspection(s)`);
    } else {
      console.log(`   ℹ️  No test inspections to delete`);
    }
  }

  console.log('\n✅ Cleanup complete\n');
}

cleanup();
