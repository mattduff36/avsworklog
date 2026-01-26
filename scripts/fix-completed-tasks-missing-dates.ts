import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { resolve } from 'path';

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixCompletedTasks() {
  console.log('🔍 Finding completed tasks without actioned_at timestamp...\n');

  try {
    // Find all affected tasks
    const { data: affectedTasks, error: findError } = await supabase
      .from('actions')
      .select(`
        id,
        status,
        created_at,
        created_by,
        actioned_at,
        workshop_comments,
        vehicles (
          reg_number,
          nickname
        )
      `)
      .eq('status', 'completed')
      .is('actioned_at', null);

    if (findError) {
      console.error('❌ Error finding tasks:', findError);
      return;
    }

    if (!affectedTasks || affectedTasks.length === 0) {
      console.log('✅ No tasks found with missing actioned_at dates!');
      console.log('All completed tasks have proper timestamps.');
      return;
    }

    console.log(`⚠️  Found ${affectedTasks.length} completed task(s) with missing actioned_at:\n`);

    affectedTasks.forEach((task, idx) => {
      console.log(`${idx + 1}. Task ID: ${task.id}`);
      console.log(`   Vehicle: ${task.vehicles?.reg_number || 'Unknown'}`);
      console.log(`   Created: ${new Date(task.created_at).toLocaleString()}`);
      console.log(`   Comments: ${task.workshop_comments || 'None'}`);
      console.log('');
    });

    console.log('━'.repeat(60));
    console.log('Preparing to fix these tasks...\n');

    // Fix each task
    let fixed = 0;
    let failed = 0;

    for (const task of affectedTasks) {
      console.log(`Fixing task ${task.id}...`);

      const { error: updateError } = await supabase
        .from('actions')
        .update({
          actioned_at: task.created_at, // Use creation date as fallback
          actioned_by: task.created_by,
          actioned_comment: task.workshop_comments || 'Task completed (timestamp backfilled)',
        })
        .eq('id', task.id);

      if (updateError) {
        console.error(`  ❌ Failed: ${updateError.message}`);
        failed++;
      } else {
        console.log(`  ✅ Fixed`);
        fixed++;
      }
    }

    console.log('\n' + '━'.repeat(60));
    console.log('📊 Summary:');
    console.log(`   Total found:    ${affectedTasks.length}`);
    console.log(`   Fixed:          ${fixed} ✅`);
    console.log(`   Failed:         ${failed} ❌`);
    console.log('');

    if (fixed > 0) {
      console.log('✅ Tasks have been fixed! Completion dates should now appear.');
      console.log('\nℹ️  Note: The actioned_at timestamp has been set to the task creation date');
      console.log('   as a reasonable fallback. The actual completion date may have been later.');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

fixCompletedTasks();
