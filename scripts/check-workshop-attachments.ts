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

async function checkAttachments() {
  console.log('🔍 Checking workshop task attachments...\n');

  try {
    // Check all attachments
    const { data: attachments, error, count } = await supabase
      .from('workshop_task_attachments')
      .select(`
        id,
        task_id,
        created_at,
        workshop_attachment_templates (
          id,
          name
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('❌ Error fetching attachments:', error);
      return;
    }

    console.log(`Found ${count || 0} total attachments\n`);

    if (attachments && attachments.length > 0) {
      console.log('Recent attachments:');
      attachments.forEach((att, idx) => {
        console.log(`${idx + 1}. Task ID: ${att.task_id}`);
        console.log(`   Template: ${att.workshop_attachment_templates?.name || 'Unknown'}`);
        console.log(`   Created: ${new Date(att.created_at).toLocaleString()}`);
        console.log('');
      });

      // Get task details for these attachments
      const taskIds = [...new Set(attachments.map(a => a.task_id))];
      console.log(`\nChecking details for ${taskIds.length} unique tasks with attachments...`);

      const { data: tasks } = await supabase
        .from('actions')
        .select(`
          id,
          status,
          action_type,
          created_at,
          vehicle_id,
          vehicles (
            reg_number,
            nickname
          )
        `)
        .in('id', taskIds);

      if (tasks) {
        console.log('\nTasks with attachments:');
        tasks.forEach(task => {
          const attCount = attachments.filter(a => a.task_id === task.id).length;
          console.log(`- ${task.vehicles?.reg_number || 'Unknown'} (${task.status}) - ${attCount} attachment(s)`);
        });
      }
    } else {
      console.log('⚠️  No attachments found in the database.');
      console.log('This could explain why attachments aren\'t visible.');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkAttachments();
