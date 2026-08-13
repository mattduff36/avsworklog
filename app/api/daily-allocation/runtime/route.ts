import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  getDailyAllocationV2Runtime,
  jsonDailyAllocationError,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const runtime = await getDailyAllocationV2Runtime();
    return NextResponse.json(runtime);
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/runtime',
      additionalData: { endpoint: 'GET /api/daily-allocation/runtime' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
