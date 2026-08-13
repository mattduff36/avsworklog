import { NextRequest, NextResponse } from 'next/server';
import {
  readOptionalJsonBody,
  runDailyAllocationRoute,
  unassignDailyAllocationPlant,
} from '@/lib/server/daily-allocation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/assignments/plant/[id]',
    'DELETE /api/daily-allocation/assignments/plant/[id]',
    async () => {
      const { id } = await params;
      const body = await readOptionalJsonBody(request) as { expected_plan_version?: number };
      const expectedPlanVersion = body.expected_plan_version
        ?? Number(request.nextUrl.searchParams.get('expected_plan_version'));
      const result = await unassignDailyAllocationPlant({
        assignment_id: id,
        expected_plan_version: expectedPlanVersion,
      });
      return NextResponse.json(result);
    }
  );
}
