import { NextRequest, NextResponse } from 'next/server';
import {
  loadDailyAllocationBoard,
  loadDailyAllocationBoardRange,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';

export async function GET(request: NextRequest) {
  return runDailyAllocationRoute(request, '/api/daily-allocation/board', 'GET /api/daily-allocation/board', async () => {
    const start = request.nextUrl.searchParams.get('start');
    const end = request.nextUrl.searchParams.get('end');
    if (start || end) {
      const board = await loadDailyAllocationBoardRange(start || '', end || '');
      return NextResponse.json(board);
    }
    const workDate = request.nextUrl.searchParams.get('date') || '';
    const board = await loadDailyAllocationBoard(workDate);
    return NextResponse.json(board);
  });
}
