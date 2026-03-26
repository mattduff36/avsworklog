import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule, isEffectiveRoleManagerOrHigher } from '@/lib/utils/rbac';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessInspections = await canEffectiveRoleAccessModule('plant-inspections');
    if (!canAccessInspections) {
      return NextResponse.json(
        { error: 'Forbidden: Plant inspections access required' },
        { status: 403 }
      );
    }

    const inspectionId = (await params).id;
    const admin = createAdminClient();

    const { data: inspection, error: lookupError } = await admin
      .from('plant_inspections')
      .select('id, user_id, status')
      .eq('id', inspectionId)
      .maybeSingle();

    if (lookupError || !inspection) {
      return NextResponse.json({ error: 'Plant draft not found' }, { status: 404 });
    }

    if (inspection.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft inspections can be discarded' },
        { status: 409 }
      );
    }

    const isManagerOrHigher = await isEffectiveRoleManagerOrHigher();
    if (inspection.user_id !== user.id && !isManagerOrHigher) {
      return NextResponse.json(
        { error: 'Forbidden: cannot discard another user draft' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await admin
      .from('plant_inspections')
      .delete()
      .eq('id', inspectionId)
      .eq('status', 'draft');

    if (deleteError) {
      return NextResponse.json({ error: 'Failed to discard draft' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to discard Plant inspection draft', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
