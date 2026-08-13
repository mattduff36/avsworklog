import { NextRequest, NextResponse } from 'next/server';
import {
  convertDailyAllocationPlanDay,
  readJsonBody,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';
import type { DailyAllocationConvertInput } from '@/types/daily-allocation';

export async function POST(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/convert',
    'POST /api/daily-allocation/convert',
    async () => {
      const body = await readJsonBody(request) as DailyAllocationConvertInput;
      const result = await convertDailyAllocationPlanDay(body);
      return NextResponse.json(result);
    }
  );
}
