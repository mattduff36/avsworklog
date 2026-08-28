import { NextRequest, NextResponse } from 'next/server';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import {
  HgvInspectionSaveBodySchema,
  saveHgvInspectionForActor,
} from '@/lib/server/hgv-inspection-save';

export async function POST(request: NextRequest) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('hgv-inspections');
    if (errorResponse || !access) {
      return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = HgvInspectionSaveBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid inspection save payload', code: 'INVALID_INPUT' }, { status: 400 });
    }

    if (parsed.data.status === 'submitted' && parsed.data.currentMileage == null) {
      return NextResponse.json({ error: 'Please enter a valid current KM', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const result = await saveHgvInspectionForActor({
      actorId: access.userId,
      canManageOthers: access.canManageOthers,
      body: parsed.data,
    });

    return NextResponse.json(result);
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 500;
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'SAVE_FAILED')
      : 'SAVE_FAILED';
    const message = error instanceof Error ? error.message : 'Failed to save HGV inspection';

    if (status === 403 || status === 409 || status === 400) {
      return NextResponse.json({ error: message, code }, { status });
    }

    console.error('Failed to save HGV inspection', error);
    return NextResponse.json({ error: 'Failed to save HGV inspection', code: 'SAVE_FAILED' }, { status: 500 });
  }
}
