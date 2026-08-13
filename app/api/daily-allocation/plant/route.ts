import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  deletePlantDraft,
  jsonDailyAllocationError,
  savePlantDraft,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { DailyPlantDraftInput } from '@/types/daily-allocation';

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as DailyPlantDraftInput;
    const draft = await savePlantDraft(body);
    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/plant',
      additionalData: { endpoint: 'PUT /api/daily-allocation/plant' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id') || '';
    await deletePlantDraft(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/plant',
      additionalData: { endpoint: 'DELETE /api/daily-allocation/plant' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
