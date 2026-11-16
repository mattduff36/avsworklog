import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hgvDailyCheckUpdatesEnabled } from '@/lib/server/hgv-update-capabilities';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { access, errorResponse } = await getInspectionRouteActorAccess('hgv-inspections');
  if (!access || errorResponse) return errorResponse;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid check' }, { status: 400 });
  // The normal user client enforces existing scoped visibility before privileged history access.
  const client = await createClient();
  const { data: check } = await client.from('hgv_inspections').select('id').eq('id', id).maybeSingle();
  if (!check) return NextResponse.json({ error: 'Check not found' }, { status: 404 });
  const admin = createAdminClient();
  const [versions, observations, reports] = await Promise.all([
    admin.from('hgv_inspection_versions').select('*').eq('inspection_id', id).order('revision', { ascending: false }),
    admin.from('hgv_defect_observations').select('*').eq('inspection_id', id).order('recorded_at', { ascending: false }),
    client.from('hgv_inspections').select('id,submitted_at,status,record_kind').eq('parent_check_id', id).order('submitted_at', { ascending: false }),
  ]);
  if (versions.error || observations.error || reports.error) return NextResponse.json({ error: 'Could not load check history' }, { status: 500 });
  return NextResponse.json({ versions: versions.data, observations: observations.data, reports: reports.data, updatesEnabled: hgvDailyCheckUpdatesEnabled() });
}
