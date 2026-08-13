import { NextRequest, NextResponse } from 'next/server';
import {
  assignDailyAllocationPlant,
  readJsonBody,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';
import type { DailyAllocationPlantAssignInput } from '@/types/daily-allocation';

export async function POST(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/assignments/plant',
    'POST /api/daily-allocation/assignments/plant',
    async () => {
      const body = await readJsonBody(request) as DailyAllocationPlantAssignInput;
      const result = await assignDailyAllocationPlant(body);
      return NextResponse.json(result, { status: 201 });
    }
  );
}
