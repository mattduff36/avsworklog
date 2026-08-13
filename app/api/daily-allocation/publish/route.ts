import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  jsonDailyAllocationError,
  publishDailyAllocation,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { work_date?: string; idempotency_key?: string };
    const publication = await publishDailyAllocation(body.work_date || '', body.idempotency_key || '');
    return NextResponse.json({ publication });
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/publish',
      additionalData: { endpoint: 'POST /api/daily-allocation/publish' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
