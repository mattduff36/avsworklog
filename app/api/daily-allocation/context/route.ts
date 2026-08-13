import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  getDailyAllocationContext,
  jsonDailyAllocationError,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const context = await getDailyAllocationContext();
    return NextResponse.json({ context });
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/context',
      additionalData: { endpoint: 'GET /api/daily-allocation/context' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
