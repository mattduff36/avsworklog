import { NextRequest, NextResponse } from 'next/server';
import { copyDailyAllocationPlan, readJsonBody, runDailyAllocationRoute } from '@/lib/server/daily-allocation';

export async function POST(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/copy',
    'POST /api/daily-allocation/copy',
    async () => {
      const body = await readJsonBody(request);
      const result = await copyDailyAllocationPlan(body);
      return NextResponse.json(result);
    },
  );
}
