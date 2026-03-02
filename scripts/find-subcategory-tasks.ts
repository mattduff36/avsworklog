/**
 * Find Tasks Linked to Subcategory
 * 
 * Finds all tasks using a specific subcategory
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

async function findSubcategoryTasks() {
  const searchName = process.argv[2] || 'basic service';
  
  console.log(`🔍 Finding tasks linked to "${searchName}" subcategory...\n`);

  try {
    // First, find the subcategory ID
    const { data: subcategory, error: subError } = await supabase
      .from('workshop_task_subcategories')
      .select('id, name, category_id')
      .ilike('name', `%${searchName}%`)
      .single();

    if (subError || !subcategory) {
      console.log(`❌ Subcategory "${searchName}" not found`);
      console.log('Error:', subError);
      return;
    }

    console.log(`Found subcategory: ${subcategory.name} (ID: ${subcategory.id})`);

    // Find all tasks using this subcategory
    const { data: tasks, error: tasksError } = await supabase
      .from('actions')
      .select(`
        id,
        title,
        status,
        created_at,
        van_id,
        vans (
          reg_number,
          nickname
        )
      `)
      .eq('workshop_subcategory_id', subcategory.id)
      .order('created_at', { ascending: false });

    if (tasksError) {
      console.error('Error fetching tasks:', tasksError);
      return;
    }

    if (!tasks || tasks.length === 0) {
      console.log('\n✅ No tasks found using this subcategory (safe to delete)');
      return;
    }

    console.log(`\n⚠️  Found ${tasks.length} task(s) using this subcategory:\n`);
    console.log('═'.repeat(80));

    tasks.forEach((task, idx) => {
      const vehicle = task.vans as { reg_number?: string; nickname?: string } | null;
      console.log(`\n[${idx + 1}] Task ID: ${task.id}`);
      console.log(`    Title: ${task.title}`);
      console.log(`    Status: ${task.status}`);
      console.log(`    Vehicle: ${vehicle?.reg_number || 'Unknown'} (${vehicle?.nickname || 'No nickname'})`);
      console.log(`    Created: ${new Date(task.created_at).toLocaleDateString()}`);
    });

    console.log(`\n` + '═'.repeat(80));
    console.log(`\nTo delete this subcategory, you must first:`);
    console.log(`1. Reassign these ${tasks.length} task(s) to a different subcategory, OR`);
    console.log(`2. Delete/complete these tasks`);
    console.log(`\nTask IDs: ${tasks.map(t => t.id).join(', ')}`);
    console.log('');

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

findSubcategoryTasks()
  .then(() => {
    console.log('Complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
