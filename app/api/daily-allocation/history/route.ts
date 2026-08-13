import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  isWorkDate,
  jsonDailyAllocationError,
  listMyPublicationHistory,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const workDate = request.nextUrl.searchParams.get('date') || undefined;
    if (workDate && !isWorkDate(workDate)) {
      throw new DailyAllocationError('A valid work date is required.', 400, 'VALIDATION');
    }
    const payload = await listMyPublicationHistory(workDate);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/history',
      additionalData: { endpoint: 'GET /api/daily-allocation/history' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
