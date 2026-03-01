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
    const { inspectionId, hgvId, createdBy, defects } = body;

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

    const { data: existingTasks } = await supabaseAdmin
      .from('actions')
      .select('id, inspection_item_id, status')
      .eq('hgv_id', hgvId)
      .eq('action_type', 'inspection_defect')
      .in('status', ['pending', 'logged', 'on_hold', 'in_progress']);

    let created = 0;
    let skipped = 0;

    for (const defect of defects) {
      const existing = existingTasks?.find(
        t => t.inspection_item_id === defect.primaryInspectionItemId
      );

      if (existing) {
        skipped++;
        continue;
      }

      const taskData: ActionInsert = {
        action_type: 'inspection_defect',
        hgv_id: hgvId,
        title: `HGV ${hgvReg}: ${defect.item_description}`,
        description: `Item ${defect.item_number} - ${defect.item_description}\n\nComment: ${defect.comment || ''}`,
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
      }
    }

    return NextResponse.json({
      created,
      updated: 0,
      skipped,
      message: `Created ${created} task${created !== 1 ? 's' : ''}, skipped ${skipped} existing task${skipped !== 1 ? 's' : ''}`,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
