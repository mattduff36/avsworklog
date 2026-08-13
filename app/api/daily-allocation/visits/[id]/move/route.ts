import { NextRequest, NextResponse } from 'next/server';
import {
  moveDailyAllocationVisit,
  readJsonBody,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';
import type { DailyAllocationVisitMoveInput } from '@/types/daily-allocation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/visits/[id]/move',
    'POST /api/daily-allocation/visits/[id]/move',
    async () => {
      const { id } = await params;
      const body = await readJsonBody(request) as Omit<DailyAllocationVisitMoveInput, 'visit_id'>;
      const result = await moveDailyAllocationVisit({ ...body, visit_id: id });
      return NextResponse.json(result);
    }
  );
}
