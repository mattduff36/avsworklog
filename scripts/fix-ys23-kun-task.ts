/**
 * Fix YS23 KUN Task
 * 
 * Moves task back to completed and changes subcategory to 'Service'
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const TASK_ID = '3f6f0866-64ad-465f-92dc-f24a1ec12452';

async function fixTask() {
  console.log('🔧 Fixing YS23 KUN Task...\n');

  try {
    // First, find the "Service" subcategory ID
    const { data: serviceSubcat, error: subcatError } = await supabase
      .from('workshop_task_subcategories')
      .select('id, name, category_id')
      .ilike('name', 'Service')
      .single();

    if (subcatError || !serviceSubcat) {
      console.error('❌ Could not find "Service" subcategory:', subcatError);
      
      // List all available subcategories
      const { data: allSubcats } = await supabase
        .from('workshop_task_subcategories')
        .select('id, name, category_id')
        .order('name');
      
      console.log('\n📋 Available subcategories:');
      allSubcats?.forEach(sub => {
        console.log(`  - ${sub.name} (ID: ${sub.id})`);
      });
      return;
    }

    console.log(`Found "Service" subcategory:`);
    console.log(`  ID: ${serviceSubcat.id}`);
    console.log(`  Name: ${serviceSubcat.name}`);
    console.log(`  Category ID: ${serviceSubcat.category_id}\n`);

    // Get current task details
    const { data: currentTask } = await supabase
      .from('actions')
      .select('id, title, status, workshop_subcategory_id, vehicle_id, vehicles(reg_number, nickname)')
      .eq('id', TASK_ID)
      .single();

    if (!currentTask) {
      console.error('❌ Task not found!');
      return;
    }

    console.log('Current task state:');
    console.log(`  Title: ${currentTask.title}`);
    console.log(`  Status: ${currentTask.status}`);
    console.log(`  Current subcategory ID: ${currentTask.workshop_subcategory_id}`);
    console.log('');

    // Update the task
    const { data: updatedTask, error: updateError } = await supabase
      .from('actions')
      .update({
        status: 'completed',
        workshop_subcategory_id: serviceSubcat.id,
        workshop_category_id: serviceSubcat.category_id, // Also update category for consistency
      })
      .eq('id', TASK_ID)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Error updating task:', updateError);
      return;
    }

    console.log('✅ Task updated successfully!\n');
    console.log('New task state:');
    console.log(`  Status: ${updatedTask.status}`);
    console.log(`  Subcategory ID: ${updatedTask.workshop_subcategory_id}`);
    console.log(`  Category ID: ${updatedTask.workshop_category_id}`);
    console.log('');

    console.log('🎉 Task is now completed and assigned to "Service" subcategory');
    console.log('You can now delete the "Basic Service" subcategory!');

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

fixTask()
  .then(() => {
    console.log('\nComplete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
