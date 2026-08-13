import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  jsonDailyAllocationError,
  loadJobSheet,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const sheet = await loadJobSheet(decodeURIComponent(code));
    return NextResponse.json(sheet);
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/jobs/[code]',
      additionalData: { endpoint: 'GET /api/daily-allocation/jobs/[code]' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
