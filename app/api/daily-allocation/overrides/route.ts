import { NextRequest, NextResponse } from 'next/server';
import {
  createDailyAllocationConflictOverride,
  readJsonBody,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';
import type { DailyAllocationOverrideInput } from '@/types/daily-allocation';

export async function POST(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/overrides',
    'POST /api/daily-allocation/overrides',
    async () => {
      const body = await readJsonBody(request) as DailyAllocationOverrideInput;
      const result = await createDailyAllocationConflictOverride(body);
      return NextResponse.json(result, { status: 201 });
    }
  );
}
