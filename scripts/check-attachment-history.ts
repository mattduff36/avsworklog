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

async function checkAttachmentHistory() {
  console.log('🔍 Checking attachment history for the last 18 days...\n');
  console.log('Feature added: 2026-01-22 (4 days ago)\n');

  try {
    // 1. Check all completed tasks
    const { data: completedTasks, error: tasksError } = await supabase
      .from('actions')
      .select(`
        id,
        status,
        created_at,
        actioned_at,
        vehicles (
          reg_number,
          nickname
        )
      `)
      .eq('status', 'completed')
      .order('actioned_at', { ascending: false });

    if (tasksError) {
      console.error('❌ Error fetching completed tasks:', tasksError);
      return;
    }

    console.log(`Found ${completedTasks?.length || 0} completed tasks\n`);

    // 2. Check for any attachments in the database
    const { data: allAttachments, count: totalCount, error: attError } = await supabase
      .from('workshop_task_attachments')
      .select('*', { count: 'exact' });

    if (attError) {
      console.error('❌ Error fetching attachments:', attError);
      return;
    }

    console.log(`Total attachments in database: ${totalCount || 0}\n`);

    // 3. Check for attachment responses (these would indicate attachments were created)
    const { data: responses, count: responseCount, error: respError } = await supabase
      .from('workshop_attachment_responses')
      .select('*', { count: 'exact' });

    if (respError) {
      console.error('❌ Error fetching responses:', respError);
      return;
    }

    console.log(`Total attachment responses in database: ${responseCount || 0}\n`);

    // 4. Check if there are any orphaned responses (responses without parent attachments)
    if (responseCount && responseCount > 0) {
      const attachmentIds = (allAttachments || []).map(a => a.id);
      const orphanedResponses = (responses || []).filter(r => !attachmentIds.includes(r.attachment_id));
      
      if (orphanedResponses.length > 0) {
        console.log(`⚠️  WARNING: Found ${orphanedResponses.length} orphaned attachment responses!`);
        console.log('These responses exist but their parent attachments are missing:\n');
        orphanedResponses.forEach((resp, idx) => {
          console.log(`${idx + 1}. Response ID: ${resp.id}`);
          console.log(`   Missing Attachment ID: ${resp.attachment_id}`);
          console.log(`   Question ID: ${resp.question_id}`);
          console.log(`   Created: ${new Date(resp.created_at).toLocaleString()}`);
          console.log('');
        });
      }
    }

    // 5. Check maintenance_history for any attachment-related changes
    const { data: maintenanceHistory, error: histError } = await supabase
      .from('maintenance_history')
      .select('*')
      .or('comment.ilike.%attachment%,field_name.ilike.%attachment%')
      .order('created_at', { ascending: false })
      .limit(50);

    if (histError && histError.code !== 'PGRST116') {
      console.error('⚠️  Note: Could not check maintenance_history:', histError.message);
    } else if (maintenanceHistory && maintenanceHistory.length > 0) {
      console.log(`Found ${maintenanceHistory.length} maintenance history entries mentioning attachments\n`);
    }

    // 6. Final assessment
    console.log('━'.repeat(60));
    console.log('📊 Assessment:\n');
    
    if (totalCount === 0 && responseCount === 0) {
      console.log('✅ Everything is fine!');
      console.log('   - No attachments have been created since the feature was added');
      console.log('   - No orphaned data detected');
      console.log('   - Database is in a consistent state');
    } else if (totalCount === 0 && responseCount && responseCount > 0) {
      console.log('⚠️  DATA LOSS DETECTED!');
      console.log(`   - ${responseCount} attachment responses exist`);
      console.log('   - But 0 parent attachments found');
      console.log('   - This indicates attachments were deleted or lost');
    } else if (totalCount && totalCount > 0) {
      console.log('✅ Attachments exist in the database');
      console.log(`   - ${totalCount} attachments found`);
      console.log(`   - ${responseCount || 0} responses found`);
      console.log('   - Checking which tasks have attachments...\n');
      
      const { data: taskAttachments } = await supabase
        .from('workshop_task_attachments')
        .select(`
          task_id,
          created_at,
          workshop_attachment_templates (
            name
          )
        `)
        .order('created_at', { ascending: false });

      if (taskAttachments && taskAttachments.length > 0) {
        // Get task details
        const taskIds = [...new Set(taskAttachments.map(a => a.task_id))];
        const { data: tasks } = await supabase
          .from('actions')
          .select('id, status, vehicles(reg_number, nickname)')
          .in('id', taskIds);

        console.log('   Tasks with attachments:');
        taskIds.forEach(taskId => {
          const task = tasks?.find(t => t.id === taskId);
          const attCount = taskAttachments.filter(a => a.task_id === taskId).length;
          console.log(`   - ${task?.vehicles?.reg_number || 'Unknown'} (${task?.status || 'unknown'}) - ${attCount} attachment(s)`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkAttachmentHistory();
