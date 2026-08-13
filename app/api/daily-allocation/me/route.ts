import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  isWorkDate,
  jsonDailyAllocationError,
  loadMyAllocation,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';

function parseRevision(value: string | null): number | undefined {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new DailyAllocationError('A valid revision number is required.', 400, 'VALIDATION');
  }
  return Number(value);
}

export async function GET(request: NextRequest) {
  try {
    const workDate = request.nextUrl.searchParams.get('date') || undefined;
    if (workDate && !isWorkDate(workDate)) {
      throw new DailyAllocationError('A valid work date is required.', 400, 'VALIDATION');
    }
    const payload = await loadMyAllocation({
      workDate,
      itemId: request.nextUrl.searchParams.get('item') || undefined,
      publicationId: request.nextUrl.searchParams.get('publication') || undefined,
      revisionNo: parseRevision(request.nextUrl.searchParams.get('revision')),
    });
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
