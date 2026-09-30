import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeDailyAllocationSessions,
  readJsonBody,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';

export async function POST(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/normalize',
    'POST /api/daily-allocation/normalize',
    async () => {
      const body = await readJsonBody(request);
      const result = await normalizeDailyAllocationSessions(body);
      return NextResponse.json(result);
    },
  );
}
