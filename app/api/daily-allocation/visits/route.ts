import { NextRequest, NextResponse } from 'next/server';
import {
  readJsonBody,
  runDailyAllocationRoute,
  upsertDailyAllocationVisit,
} from '@/lib/server/daily-allocation';
import type { DailyAllocationVisitUpsertInput } from '@/types/daily-allocation';

export async function POST(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/visits',
    'POST /api/daily-allocation/visits',
    async () => {
      const body = await readJsonBody(request) as DailyAllocationVisitUpsertInput;
      const result = await upsertDailyAllocationVisit(body);
      return NextResponse.json(result, { status: 201 });
    }
  );
}
