import { NextRequest, NextResponse } from 'next/server';
import {
  DailyAllocationError,
  jsonDailyAllocationError,
  loadDailyAllocationBoard,
} from '@/lib/server/daily-allocation';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const workDate = request.nextUrl.searchParams.get('date') || '';
    const board = await loadDailyAllocationBoard(workDate);
    return NextResponse.json(board);
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/daily-allocation/board',
      additionalData: { endpoint: 'GET /api/daily-allocation/board' },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
