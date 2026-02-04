import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

type ActionInsert = Database['public']['Tables']['actions']['Insert'];

/**
 * POST /api/plant-inspections/sync-defect-tasks
 * 
 * Idempotently creates/updates plant inspection defect tasks.
 * 
 * TODO: This is a simplified implementation. For full idempotency logic,
 * adapt the complete implementation from /api/inspections/sync-defect-tasks/route.ts
 * Key changes:
 * - Use plant_id instead of vehicle_id
 * - Use plant.plant_id (not reg_number) in task titles
 * - Filter categories by applies_to='plant'
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { inspectionId, plantId, createdBy, defects } = body;

    if (!inspectionId || !plantId || !createdBy || !Array.isArray(defects)) {
      return NextResponse.json(
        { error: 'Missing required fields: inspectionId, plantId, createdBy, defects' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Get plant info
    const { data: plant } = await supabaseAdmin
      .from('plant')
      .select('plant_id')
      .eq('id', plantId)
      .single();

    const plantNumber = plant?.plant_id || 'Unknown Plant';

    // Get category/subcategory for plant defects
    const { data: repairCategory } = await supabaseAdmin
      .from('workshop_task_categories')
      .select('id')
      .eq('name', 'Repair')
      .eq('applies_to', 'plant')
      .eq('is_active', true)
      .single();

    let defaultSubcategoryId: string | null = null;
    if (repairCategory) {
      const { data: subcategory } = await supabaseAdmin
        .from('workshop_task_subcategories')
        .select('id')
        .eq('category_id', repairCategory.id)
        .ilike('name', '%inspection%defect%')
        .eq('is_active', true)
        .single();
      defaultSubcategoryId = subcategory?.id || null;
    }

    // Fetch existing tasks for this plant
    const { data: existingTasks } = await supabaseAdmin
      .from('actions')
      .select('id, inspection_item_id, status')
      .eq('plant_id', plantId)
      .eq('action_type', 'inspection_defect')
      .in('status', ['pending', 'logged', 'on_hold', 'in_progress']);

    let created = 0;
    let skipped = 0;

    for (const defect of defects) {
      // Check if task already exists
      const existing = existingTasks?.find(t => 
        t.inspection_item_id === defect.primaryInspectionItemId
      );

      if (existing) {
        skipped++;
        continue;
      }

      // Create new task
      const daysText = defect.days.map((d: number) => 
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]
      ).join(', ');

      const taskData: ActionInsert = {
        action_type: 'inspection_defect',
        plant_id: plantId,
        vehicle_id: null,
        title: `Plant ${plantNumber}: ${defect.item_description}`,
        description: `Item ${defect.item_number} - ${defect.item_description} (Days: ${daysText})\n\nComment: ${defect.comment}`,
        status: 'pending',
        created_by: createdBy,
        inspection_id: inspectionId,
        inspection_item_id: defect.primaryInspectionItemId,
        category_id: repairCategory?.id || null,
        subcategory_id: defaultSubcategoryId,
      };

      const { error: insertError } = await supabaseAdmin
        .from('actions')
        .insert([taskData]);

      if (insertError) {
        console.error('Error creating plant defect task:', insertError);
      } else {
        created++;
      }
    }

    // Generate summary message
    const message = `Created ${created} task${created !== 1 ? 's' : ''}, skipped ${skipped} existing task${skipped !== 1 ? 's' : ''}`;

    return NextResponse.json({ created, updated: 0, skipped, message });
  } catch (error) {
    console.error('Error in plant sync-defect-tasks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
