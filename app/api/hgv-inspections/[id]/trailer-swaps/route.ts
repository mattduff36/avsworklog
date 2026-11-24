import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { HgvTrailerSwapSchema } from '@/lib/checklists/hgv-trailer-swap';
import { mapHgvSaveRpcError } from '@/lib/server/hgv-inspection-save';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { errorResponse, access } = await getInspectionRouteActorAccess('hgv-inspections');
  if (errorResponse || !access) return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid check ID' }, { status: 400 });

  // Use the driver's session so the parent inspection's existing RLS governs visibility.
  const db = await createClient();
  const { data, error } = await db.from('hgv_trailer_swaps')
    .select('id,trailer_label,created_at,items,driver:profiles!hgv_trailer_swaps_user_id_fkey(full_name)')
    .eq('parent_check_id', id).order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Unable to load trailer checks' }, { status: 500 });
  return NextResponse.json({ swaps: (data || []).map(row => ({
    id: row.id, trailer_label: row.trailer_label, signed_at: row.created_at,
    driver_name: row.driver?.full_name ?? null, items: row.items,
  })) });
}

export async function POST(request: NextRequest, { params }: Context) {
  const { errorResponse, access } = await getInspectionRouteActorAccess('hgv-inspections');
  if (errorResponse || !access) return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = HgvTrailerSwapSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Check the trailer details, signature and walkaround answers.' }, { status: 400 });
  }

  // The RPC verifies the actor owns the submitted parent and locks it before appending the signed check.
  const { data, error } = await createAdminClient().rpc('append_hgv_trailer_swap', {
    p_actor_id: access.userId, p_parent_id: id, p_request_id: parsed.data.requestId,
    p_selection: parsed.data.trailerSelection, p_signature: parsed.data.signatureData, p_items: parsed.data.items,
  });
  if (error) {
    const mapped = mapHgvSaveRpcError(error.message);
    return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
  }
  return NextResponse.json({ id: data });
}
