import { NextRequest, NextResponse } from 'next/server';
import { loadDailyAllocationResourceJobs } from '@/lib/server/daily-allocation/board';
import { runDailyAllocationRoute } from '@/lib/server/daily-allocation/auth';

export async function GET(request: NextRequest) {
  return runDailyAllocationRoute(request, '/api/daily-allocation/resources/jobs', 'GET /api/daily-allocation/resources/jobs', async () => {
    const params = request.nextUrl.searchParams;
    return NextResponse.json(await loadDailyAllocationResourceJobs(
      params.get('start') || '',
      params.get('end') || '',
      params.get('q') || ''
    ));
  });
}
