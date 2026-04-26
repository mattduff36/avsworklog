import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import type { FleetAssetOption } from '@/app/(dashboard)/inventory/types';

export async function GET() {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const [vansResult, hgvsResult, plantResult] = await Promise.all([
      admin
        .from('vans')
        .select('id, reg_number, nickname, status')
        .eq('status', 'active')
        .order('reg_number', { ascending: true }),
      admin
        .from('hgvs')
        .select('id, reg_number, nickname, status')
        .eq('status', 'active')
        .order('reg_number', { ascending: true }),
      admin
        .from('plant')
        .select('id, plant_id, reg_number, nickname, make, model, status')
        .eq('status', 'active')
        .order('plant_id', { ascending: true }),
    ]);

    if (vansResult.error) throw vansResult.error;
    if (hgvsResult.error) throw hgvsResult.error;
    if (plantResult.error) throw plantResult.error;

    const assets: FleetAssetOption[] = [
      ...(vansResult.data || []).map((van) => ({
        id: van.id,
        type: 'van' as const,
        label: `Van - ${van.reg_number}`,
        description: van.nickname || null,
      })),
      ...(hgvsResult.data || []).map((hgv) => ({
        id: hgv.id,
        type: 'hgv' as const,
        label: `HGV - ${hgv.reg_number}`,
        description: hgv.nickname || null,
      })),
      ...(plantResult.data || []).map((plant) => ({
        id: plant.id,
        type: 'plant' as const,
        label: `Plant - ${plant.plant_id}`,
        description: [plant.nickname, plant.make, plant.model, plant.reg_number].filter(Boolean).join(' ') || null,
      })),
    ];

    return NextResponse.json({ assets });
  } catch (error) {
    console.error('Error fetching fleet assets for inventory:', error);
    return NextResponse.json({ error: 'Failed to fetch fleet assets' }, { status: 500 });
  }
}
