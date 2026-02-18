import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

type ActionInsert = Database['public']['Tables']['actions']['Insert'];

/**
 * POST /api/plant-inspections/inform-workshop
 * 
 * Creates a workshop task from inspector comments on plant inspection.
 * 
 * Input: {
 *   plantId: string;
 *   inspectionId: string;
 *   createdBy: string;
 *   comments: string;
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { plantId, inspectionId, createdBy, comments } = body;

    if (!plantId || !inspectionId || !createdBy || !comments) {
      return NextResponse.json(
        { error: 'Missing required fields: plantId, inspectionId, createdBy, comments' },
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

    // Get category/subcategory for plant tasks
    const { data: category } = await supabaseAdmin
      .from('workshop_task_categories')
      .select('id')
      .or('name.eq.Repair,name.eq.Other')
      .eq('applies_to', 'plant')
      .eq('is_active', true)
      .limit(1)
      .single();

    const taskData: ActionInsert = {
      action_type: 'workshop_vehicle_task',
      plant_id: plantId,
      vehicle_id: null,
      title: `Plant ${plantNumber}: Inspector Comments`,
      description: comments,
      status: 'pending',
      created_by: createdBy,
      inspection_id: inspectionId,
      workshop_category_id: category?.id || null,
    };

    const { data: newTask, error: insertError } = await supabaseAdmin
      .from('actions')
      .insert([taskData])
      .select('id')
      .single();

    if (insertError) {
      console.error('Error creating plant workshop task:', insertError);
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
    }

    return NextResponse.json({ success: true, taskId: newTask.id });
  } catch (error) {
    console.error('Error in plant inform-workshop:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
