import { NextRequest, NextResponse } from 'next/server';
import {
  createDailyAllocationAssignedVisit,
  readJsonBody,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';
import type { DailyAllocationAssignedVisitInput } from '@/types/daily-allocation';

export async function POST(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/assigned-visits',
    'POST /api/daily-allocation/assigned-visits',
    async () => {
      const body = await readJsonBody(request) as DailyAllocationAssignedVisitInput;
      const result = await createDailyAllocationAssignedVisit(body);
      return NextResponse.json(result, { status: 201 });
    }
  );
}
