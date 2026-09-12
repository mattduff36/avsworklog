import { NextRequest, NextResponse } from 'next/server';
import {
  convertDailyAllocationPlanDay,
  getDailyAllocationConversionSource,
  readJsonBody,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';
import type { DailyAllocationConvertInput } from '@/types/daily-allocation';

export async function GET(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/convert',
    'GET /api/daily-allocation/convert',
    async () => {
      const result = await getDailyAllocationConversionSource(
        request.nextUrl.searchParams.get('work_date') || '',
        request.nextUrl.searchParams.get('team_id') || ''
      );
      return NextResponse.json(result);
    }
  );
}

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
