import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import { buildInspectionDefectSignature, extractInspectionDefectSignature } from '@/lib/utils/inspectionDefectSignature';

type ActionInsert = Database['public']['Tables']['actions']['Insert'];
type ActionUpdate = Database['public']['Tables']['actions']['Update'];

interface HgvInspectionDefectPayload {
  item_number: number;
  item_description: string;
  days?: number[];
  dayOfWeek?: number | null;
  comment?: string;
  primaryInspectionItemId: string;
}

interface ExistingInspectionDefectTask {
  id: string;
  status: string;
  title: string | null;
  description: string | null;
  inspection_id: string | null;
  inspection_item_id: string | null;
  hgv_id: string | null;
}

const ACTIVE_TASK_STATUSES = ['pending', 'logged', 'on_hold', 'in_progress'] as const;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function buildDayRange(days?: number[], dayOfWeek?: number | null): string {
  const normalizedDays = Array.isArray(days) && days.length > 0
    ? days
    : dayOfWeek
      ? [dayOfWeek]
      : [];

  if (normalizedDays.length === 0) {
    return '';
  }

  if (normalizedDays.length === 1) {
    return DAY_NAMES[normalizedDays[0] - 1] || `Day ${normalizedDays[0]}`;
  }

  const firstDay = DAY_NAMES[normalizedDays[0] - 1] || `Day ${normalizedDays[0]}`;
  const lastDay = DAY_NAMES[normalizedDays[normalizedDays.length - 1] - 1] || `Day ${normalizedDays[normalizedDays.length - 1]}`;
  return `${firstDay.substring(0, 3)}-${lastDay.substring(0, 3)}`;
}

function addTaskToSignatureMap(
  map: Map<string, ExistingInspectionDefectTask[]>,
  signature: string,
  task: ExistingInspectionDefectTask
) {
  if (!map.has(signature)) {
    map.set(signature, []);
  }

  map.get(signature)!.push(task);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { inspectionId, hgvId, createdBy, defects } = body as {
      inspectionId?: string;
      hgvId?: string;
      createdBy?: string;
      defects?: HgvInspectionDefectPayload[];
    };

    if (!inspectionId || !hgvId || !createdBy || !Array.isArray(defects)) {
      return NextResponse.json(
        { error: 'Missing required fields: inspectionId, hgvId, createdBy, defects' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: hgv } = await supabaseAdmin
      .from('hgvs')
      .select('reg_number')
      .eq('id', hgvId)
      .single();

    const hgvReg = hgv?.reg_number || 'Unknown HGV';

    const { data: repairCategory } = await supabaseAdmin
      .from('workshop_task_categories')
      .select('id')
      .eq('name', 'Repair')
      .eq('applies_to', 'hgv')
      .eq('is_active', true)
      .single();

    const { data: activeVehicleTasks } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        title,
        description,
        inspection_id,
        inspection_item_id,
        hgv_id
      `)
      .eq('hgv_id', hgvId)
      .eq('action_type', 'inspection_defect')
      .in('status', ACTIVE_TASK_STATUSES as unknown as string[]);

    const { data: existingInspectionTasks } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        title,
        description,
        inspection_id,
        inspection_item_id,
        hgv_id
      `)
      .eq('inspection_id', inspectionId)
      .eq('action_type', 'inspection_defect');

    const activeTasksMap = new Map<string, ExistingInspectionDefectTask[]>();
    const existingInspectionMap = new Map<string, ExistingInspectionDefectTask[]>();

    for (const task of (activeVehicleTasks || []) as ExistingInspectionDefectTask[]) {
      const signature = extractInspectionDefectSignature(task.description);
      if (signature) {
        addTaskToSignatureMap(activeTasksMap, signature, task);
      }
    }

    for (const task of (existingInspectionTasks || []) as ExistingInspectionDefectTask[]) {
      const signature = extractInspectionDefectSignature(task.description);
      if (signature) {
        addTaskToSignatureMap(existingInspectionMap, signature, task);
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const duplicates: Array<{ signature: string; taskIds: string[] }> = [];

    for (const defect of defects) {
      const signature = buildInspectionDefectSignature({
        item_number: defect.item_number,
        item_description: defect.item_description,
      });
      const dayRange = buildDayRange(defect.days, defect.dayOfWeek);
      const daySuffix = dayRange ? ` (${dayRange})` : '';
      const commentText = defect.comment ? `\nComment: ${defect.comment}` : '';
      const title = `${hgvReg} - ${defect.item_description}${daySuffix}`;
      const description = `HGV inspection defect found:\nItem ${defect.item_number} - ${defect.item_description}${daySuffix}${commentText}`;

      const activeTasksForDefect = activeTasksMap.get(signature) || [];
      const existingTasksForInspection = existingInspectionMap.get(signature) || [];

      if (existingTasksForInspection.length > 1) {
        duplicates.push({
          signature,
          taskIds: existingTasksForInspection.map((task) => task.id),
        });
      }

      const currentInspectionTask = existingTasksForInspection.find((task) => task.status !== 'completed');

      if (currentInspectionTask) {
        const updates: ActionUpdate = {
          title,
          description,
          inspection_item_id: defect.primaryInspectionItemId,
          hgv_id: hgvId,
          updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabaseAdmin
          .from('actions')
          .update(updates)
          .eq('id', currentInspectionTask.id);

        if (updateError) {
          console.error(`Error updating HGV defect task ${currentInspectionTask.id}:`, updateError);
        } else {
          updated++;
        }
        continue;
      }

      if (activeTasksForDefect.length > 0) {
        skipped++;
        continue;
      }

      const taskData: ActionInsert = {
        action_type: 'inspection_defect',
        hgv_id: hgvId,
        title,
        description,
        status: 'pending',
        created_by: createdBy,
        inspection_id: inspectionId,
        inspection_item_id: defect.primaryInspectionItemId,
        workshop_category_id: repairCategory?.id || null,
      };

      const { error: insertError } = await supabaseAdmin
        .from('actions')
        .insert([taskData]);

      if (!insertError) {
        created++;
        const insertedTask: ExistingInspectionDefectTask = {
          id: `${inspectionId}:${defect.primaryInspectionItemId}`,
          status: 'pending',
          title,
          description,
          inspection_id: inspectionId,
          inspection_item_id: defect.primaryInspectionItemId,
          hgv_id: hgvId,
        };
        addTaskToSignatureMap(activeTasksMap, signature, insertedTask);
        addTaskToSignatureMap(existingInspectionMap, signature, insertedTask);
      } else {
        console.error(`Error creating HGV defect task for ${signature}:`, insertError);
      }
    }

    return NextResponse.json({
      created,
      updated,
      skipped,
      duplicates,
      message: `Sync complete: ${created} created, ${updated} updated, ${skipped} skipped${duplicates.length > 0 ? `, ${duplicates.length} duplicate groups found` : ''}`,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
