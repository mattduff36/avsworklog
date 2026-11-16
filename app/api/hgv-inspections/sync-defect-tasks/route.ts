import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';

export async function POST(request: NextRequest) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('hgv-inspections');
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { inspectionId, hgvId, createdBy, defects } = body as {
      inspectionId?: string;
      hgvId?: string;
      createdBy?: string;
      defects?: unknown[];
    };
    if (!inspectionId || !hgvId || !createdBy || !Array.isArray(defects)) {
      return NextResponse.json(
        { error: 'Missing required fields: inspectionId, hgvId, createdBy, defects' },
        { status: 400 }
      );
    }

    if (createdBy !== access.userId) {
      return NextResponse.json(
        { error: 'Forbidden: createdBy must match authenticated user' },
        { status: 403 }
      );
    }

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: inspectionOwner, error: inspectionLookupError } = await supabaseAdmin
      .from('hgv_inspections')
      .select('user_id, hgv_id')
      .eq('id', inspectionId)
      .maybeSingle();

    if (inspectionLookupError || !inspectionOwner) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    if (inspectionOwner.hgv_id !== hgvId) {
      return NextResponse.json(
        { error: 'hgvId does not match inspection vehicle' },
        { status: 400 }
      );
    }

    if (inspectionOwner.user_id !== access.userId && !access.canManageOthers) {
      return NextResponse.json(
        { error: 'Forbidden: cannot modify another user inspection tasks' },
        { status: 403 }
      );
    }

    // Ownership, version check and persisted-answer reconciliation share the
    // same database transaction/asset lock as corrections and new reports.
    const { data, error } = await supabaseAdmin.rpc('sync_hgv_defects_compat', {
      p_actor_id: access.userId, p_can_manage: access.canManageOthers,
      p_inspection_id: inspectionId, p_hgv_id: hgvId,
    });
    if (error) return NextResponse.json({ error: 'Could not reconcile defects. Refresh before retrying.' }, { status: 409 });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in hgv sync-defect-tasks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
