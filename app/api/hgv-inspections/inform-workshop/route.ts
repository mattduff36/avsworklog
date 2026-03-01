import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

type ActionInsert = Database['public']['Tables']['actions']['Insert'];

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { hgvId, inspectionId, createdBy, comments } = body;

    if (!hgvId || !inspectionId || !createdBy || !comments) {
      return NextResponse.json(
        { error: 'Missing required fields: hgvId, inspectionId, createdBy, comments' },
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

    const { data: category } = await supabaseAdmin
      .from('workshop_task_categories')
      .select('id')
      .or('name.eq.Repair,name.eq.Other')
      .eq('applies_to', 'hgv')
      .eq('is_active', true)
      .limit(1)
      .single();

    const taskData: ActionInsert = {
      action_type: 'workshop_vehicle_task',
      hgv_id: hgvId,
      title: `HGV ${hgvReg}: Inspector Comments`,
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
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
    }

    return NextResponse.json({ success: true, taskId: newTask.id });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
