import { NextRequest, NextResponse } from 'next/server';
import {
  assignDailyAllocationLabour,
  readJsonBody,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';
import type { DailyAllocationLabourAssignInput } from '@/types/daily-allocation';

export async function POST(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/assignments/labour',
    'POST /api/daily-allocation/assignments/labour',
    async () => {
      const body = await readJsonBody(request) as DailyAllocationLabourAssignInput;
      const result = await assignDailyAllocationLabour(body);
      return NextResponse.json(result, { status: 201 });
    }
  );
}
