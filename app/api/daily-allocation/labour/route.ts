import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  deleteLabourDraft,
  jsonDailyAllocationError,
  saveLabourDraft,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { DailyLabourDraftInput } from '@/types/daily-allocation';

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as DailyLabourDraftInput;
    const draft = await saveLabourDraft(body);
    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/labour',
      additionalData: { endpoint: 'PUT /api/daily-allocation/labour' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const workDate = request.nextUrl.searchParams.get('date') || '';
    const profileId = request.nextUrl.searchParams.get('profileId') || '';
    await deleteLabourDraft(workDate, profileId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/labour',
      additionalData: { endpoint: 'DELETE /api/daily-allocation/labour' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
