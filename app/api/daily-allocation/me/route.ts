import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  jsonDailyAllocationError,
  loadMyAllocation,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const workDate = request.nextUrl.searchParams.get('date') || undefined;
    const itemId = request.nextUrl.searchParams.get('item') || undefined;
    const payload = await loadMyAllocation(workDate, itemId);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/me',
      additionalData: { endpoint: 'GET /api/daily-allocation/me' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
