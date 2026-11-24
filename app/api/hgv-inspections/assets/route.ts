import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { classifyCheckAsset } from '@/lib/inspections/hgv-trailer-form';

export async function GET() {
  const { access, errorResponse } = await getInspectionRouteActorAccess('hgv-inspections');
  if (!access || errorResponse) return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = await createClient();
  const { data: vehicles, error } = await supabase.from('hgvs')
    .select('id, reg_number, nickname, current_mileage, hgv_categories(name)')
    .eq('status', 'active').is('retired_at', null).order('reg_number');
  if (error) return NextResponse.json({ error: 'Could not load HGV assets' }, { status: 500 });
  if (!vehicles.length) return NextResponse.json({ assets: [] });
  // Drivers do not need access to maintenance records. Expose the classification only for HGVs they can see.
  const { data: maintenance, error: maintenanceError } = await createAdminClient().from('vehicle_maintenance')
    .select('hgv_id, ves_wheelplan').in('hgv_id', vehicles.map(v => v.id));
  if (maintenanceError) return NextResponse.json({ error: 'Could not load HGV classifications' }, { status: 500 });
  const wheelplans = new Map(maintenance.map(row => [row.hgv_id, row.ves_wheelplan]));
  return NextResponse.json({ assets: vehicles.map(({hgv_categories, ...vehicle}) => {
    const category = Array.isArray(hgv_categories) ? hgv_categories[0] : hgv_categories;
    return { ...vehicle, classification: classifyCheckAsset(category?.name, wheelplans.get(vehicle.id)) };
  }) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
