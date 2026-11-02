import { NextRequest, NextResponse } from 'next/server';
import { InspectionMeterCorrectionSchema, InspectionMeterIdentitySchema } from '@/lib/inspections/meter-correction';
import { requireInspectionMeterCorrectionAccess } from '@/lib/server/inspection-meter-correction-access';
import { correctInspectionMeter, getInspectionMeterSnapshot, InspectionMeterCorrectionError, withInspectionMeterDatabase } from '@/lib/server/inspection-meter-correction';
import { getVanInspectionsMaintenanceResponse } from '@/lib/server/van-inspections-maintenance';

function handleError(error: unknown) {
  if (error instanceof InspectionMeterCorrectionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === '40P01' || code === '55P03' || code === '57014') {
    return NextResponse.json({ error: 'This check or asset is being updated. Please reopen Edit reading and try again.' }, { status: 409 });
  }
  return NextResponse.json({ error: 'Unable to load or save the reading correction. Please try again.' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const parsed = InspectionMeterIdentitySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid Daily Check reference.' }, { status: 400 });
  try {
    const access = await requireInspectionMeterCorrectionAccess(parsed.data.assetType);
    if (access.response) return access.response;
    const snapshot = await withInspectionMeterDatabase(client => getInspectionMeterSnapshot(client, parsed.data.assetType, parsed.data.inspectionId));
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return handleError(error); }
}

export async function PATCH(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = InspectionMeterCorrectionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Enter a whole-number reading of zero or above and an optional comment of up to 2,000 characters.' }, { status: 400 });
  try {
    const access = await requireInspectionMeterCorrectionAccess(parsed.data.assetType);
    if (access.response) return access.response;
    if (parsed.data.assetType === 'van') {
      const paused = getVanInspectionsMaintenanceResponse();
      if (paused) return paused;
    }
    const result = await withInspectionMeterDatabase(client => correctInspectionMeter(client, access.actorId!, parsed.data));
    return NextResponse.json(result);
  } catch (error) { return handleError(error); }
}
