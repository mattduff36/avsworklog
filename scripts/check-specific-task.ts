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

async function checkTask() {
  console.log('🔍 Checking completed tasks for vehicle YS23 KUN...\n');

  try {
    // Find the vehicle first
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, reg_number, nickname')
      .eq('reg_number', 'YS23 KUN')
      .single();

    if (!vehicle) {
      console.log('❌ Vehicle YS23 KUN not found');
      return;
    }

    console.log(`Found vehicle: ${vehicle.reg_number} (${vehicle.nickname || 'no nickname'})`);
    console.log(`Vehicle ID: ${vehicle.id}\n`);

    // Get all completed tasks for this vehicle
    const { data: tasks } = await supabase
      .from('actions')
      .select(`
        id,
        status,
        action_type,
        created_at,
        logged_at,
        logged_by,
        logged_comment,
        actioned_at,
        actioned_by,
        actioned_comment,
        workshop_comments,
        workshop_task_categories (
          name
        )
      `)
      .eq('vehicle_id', vehicle.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (!tasks || tasks.length === 0) {
      console.log('⚠️  No completed tasks found for this vehicle');
      return;
    }

    console.log(`Found ${tasks.length} completed task(s):\n`);

    for (const task of tasks) {
      console.log('━'.repeat(60));
      console.log(`Task ID: ${task.id}`);
      console.log(`Category: ${task.workshop_task_categories?.name || 'None'}`);
      console.log(`Type: ${task.action_type}`);
      console.log(`Status: ${task.status}`);
      console.log(`\nComments: ${task.workshop_comments || 'None'}`);
      console.log(`\nTimestamps:`);
      console.log(`  Created: ${task.created_at ? new Date(task.created_at).toLocaleString() : 'NOT SET'}`);
      console.log(`  Logged (In Progress): ${task.logged_at ? new Date(task.logged_at).toLocaleString() : 'NOT SET'}`);
      console.log(`  Actioned (Completed): ${task.actioned_at ? new Date(task.actioned_at).toLocaleString() : '❌ NOT SET'}`);
      
      if (!task.actioned_at) {
        console.log('  ⚠️  WARNING: Task is marked completed but has no actioned_at timestamp!');
      }

      // Check for attachments
      const { data: attachments, count } = await supabase
        .from('workshop_task_attachments')
        .select('id, created_at, workshop_attachment_templates(name)', { count: 'exact' })
        .eq('task_id', task.id);

      console.log(`\nAttachments: ${count || 0}`);
      if (attachments && attachments.length > 0) {
        attachments.forEach((att, idx) => {
          console.log(`  ${idx + 1}. ${att.workshop_attachment_templates?.name || 'Unknown'} (${new Date(att.created_at).toLocaleString()})`);
        });
      }
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkTask();
