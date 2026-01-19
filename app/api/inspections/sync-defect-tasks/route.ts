import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

type ActionInsert = Database['public']['Tables']['actions']['Insert'];
type ActionUpdate = Database['public']['Tables']['actions']['Update'];

/**
 * POST /api/inspections/sync-defect-tasks
 * 
 * Idempotently creates/updates inspection defect tasks.
 * Uses stable signature (inspection_id + item_number + item_description) for deduplication.
 * 
 * Input: {
 *   inspectionId: string;
 *   vehicleId: string;
 *   createdBy: string;
 *   defects: Array<{
 *     item_number: number;
 *     item_description: string;
 *     days: number[];
 *     comment: string;
 *     primaryInspectionItemId: string;
 *   }>;
 * }
 * 
 * Output: {
 *   created: number;
 *   updated: number;
 *   skipped: number;
 *   duplicates: Array<{ signature, taskIds }>;  // For admin cleanup
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { inspectionId, vehicleId, createdBy, defects } = body;

    if (!inspectionId || !vehicleId || !createdBy || !Array.isArray(defects)) {
      return NextResponse.json(
        { error: 'Missing required fields: inspectionId, vehicleId, createdBy, defects' },
        { status: 400 }
      );
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Get vehicle registration for task titles
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('reg_number')
      .eq('id', vehicleId)
      .single();

    const vehicleReg = vehicle?.reg_number || 'Unknown Vehicle';

    // Get preferred taxonomy: Repair → Inspection defects
    const { data: repairCategory } = await supabaseAdmin
      .from('workshop_task_categories')
      .select('id')
      .eq('name', 'Repair')
      .eq('applies_to', 'vehicle')
      .eq('is_active', true)
      .single();

    let defaultSubcategoryId: string | null = null;

    if (repairCategory) {
      const { data: inspectionDefectsSubcat } = await supabaseAdmin
        .from('workshop_task_subcategories')
        .select('id')
        .eq('category_id', repairCategory.id)
        .ilike('name', '%inspection%defect%')
        .eq('is_active', true)
        .single();

      defaultSubcategoryId = inspectionDefectsSubcat?.id || null;
    }

    // Fallback: Other → Other (or just null)
    if (!defaultSubcategoryId) {
      const { data: otherCategory } = await supabaseAdmin
        .from('workshop_task_categories')
        .select('id')
        .eq('name', 'Other')
        .eq('applies_to', 'vehicle')
        .eq('is_active', true)
        .single();

      if (otherCategory) {
        const { data: otherSubcat } = await supabaseAdmin
          .from('workshop_task_subcategories')
          .select('id')
          .eq('category_id', otherCategory.id)
          .eq('name', 'Other')
          .eq('is_active', true)
          .single();

        defaultSubcategoryId = otherSubcat?.id || null;
      }
    }

    // Fetch existing actions for this inspection
    const { data: existingActions } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        title,
        description,
        inspection_id,
        inspection_item_id,
        vehicle_id
      `)
      .eq('inspection_id', inspectionId)
      .eq('action_type', 'inspection_defect');

    // Build a map of existing tasks by stable signature
    // Signature: item_number-item_description (normalized)
    const existingMap = new Map<string, typeof existingActions>();

    if (existingActions) {
      for (const action of existingActions) {
        // Parse signature from description: "Item X - Description"
        const match = action.description?.match(/Item (\d+) - ([^(]+)/);
        if (match) {
          const itemNum = match[1];
          const itemDesc = match[2].trim();
          const signature = `${itemNum}-${itemDesc}`;
          
          if (!existingMap.has(signature)) {
            existingMap.set(signature, []);
          }
          existingMap.get(signature)!.push(action);
        }
      }
    }

    const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const duplicates: Array<{ signature: string; taskIds: string[] }> = [];

    // Process each defect
    for (const defect of defects) {
      const { item_number, item_description, days, comment, primaryInspectionItemId } = defect;

      // Build stable signature
      const signature = `${item_number}-${item_description.trim()}`;

      // Build day range string
      let dayRange: string;
      if (days.length === 1) {
        dayRange = DAY_NAMES[days[0] - 1] || `Day ${days[0]}`;
      } else if (days.length > 1) {
        const firstDay = DAY_NAMES[days[0] - 1] || `Day ${days[0]}`;
        const lastDay = DAY_NAMES[days[days.length - 1] - 1] || `Day ${days[days.length - 1]}`;
        dayRange = `${firstDay.substring(0, 3)}-${lastDay.substring(0, 3)}`;
      } else {
        dayRange = 'Unknown';
      }

      const commentText = comment ? `\nComment: ${comment}` : '';
      const title = `${vehicleReg} - ${item_description} (${dayRange})`;
      const description = `Vehicle inspection defect found:\nItem ${item_number} - ${item_description} (${dayRange})${commentText}`;

      // Check for existing tasks with this signature
      const existing = existingMap.get(signature);

      if (existing && existing.length > 0) {
        // Check for duplicates
        if (existing.length > 1) {
          duplicates.push({
            signature,
            taskIds: existing.map(e => e.id)
          });
        }

        // Update first non-completed task
        const activeTask = existing.find(e => e.status !== 'completed');
        
        if (activeTask) {
          const updates: ActionUpdate = {
            title,
            description,
            inspection_item_id: primaryInspectionItemId,
            vehicle_id: vehicleId,
            updated_at: new Date().toISOString(),
          };

          const { error: updateError } = await supabaseAdmin
            .from('actions')
            .update(updates)
            .eq('id', activeTask.id);

          if (updateError) {
            console.error(`Error updating task ${activeTask.id}:`, updateError);
          } else {
            updated++;
          }
        } else {
          // All tasks are completed, skip
          skipped++;
        }
      } else {
        // Create new task
        const newTask: ActionInsert = {
          action_type: 'inspection_defect',
          inspection_id: inspectionId,
          inspection_item_id: primaryInspectionItemId,
          vehicle_id: vehicleId,
          workshop_subcategory_id: defaultSubcategoryId,
          title,
          description,
          priority: 'high',
          status: 'pending',
          created_by: createdBy,
        };

        const { error: insertError } = await supabaseAdmin
          .from('actions')
          .insert(newTask);

        if (insertError) {
          console.error(`Error creating task for ${signature}:`, insertError);
        } else {
          created++;
        }
      }
    }

    return NextResponse.json({
      created,
      updated,
      skipped,
      duplicates,
      message: `Sync complete: ${created} created, ${updated} updated, ${skipped} skipped${duplicates.length > 0 ? `, ${duplicates.length} duplicate groups found` : ''}`
    });
  } catch (error) {
    console.error('Error in sync-defect-tasks endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
