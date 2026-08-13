import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  jsonDailyAllocationError,
  listAllocationJobCodes,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q') || '';
    const job_codes = await listAllocationJobCodes(query);
    return NextResponse.json({ job_codes });
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/job-codes',
      additionalData: { endpoint: 'GET /api/daily-allocation/job-codes' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
