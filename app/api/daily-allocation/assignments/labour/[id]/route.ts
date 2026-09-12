import { NextRequest, NextResponse } from 'next/server';
import {
  readOptionalJsonBody,
  runDailyAllocationRoute,
  unassignDailyAllocationLabour,
} from '@/lib/server/daily-allocation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/assignments/labour/[id]',
    'DELETE /api/daily-allocation/assignments/labour/[id]',
    async () => {
      const { id } = await params;
      const body = await readOptionalJsonBody(request) as {
        request_id?: string;
        expected_plan_version?: number;
        expected_row_version?: number;
      };
      const expectedPlanVersion = body.expected_plan_version
        ?? Number(request.nextUrl.searchParams.get('expected_plan_version'));
      const result = await unassignDailyAllocationLabour({
        request_id: body.request_id || request.nextUrl.searchParams.get('request_id') || '',
        assignment_id: id,
        expected_plan_version: expectedPlanVersion,
        expected_row_version: body.expected_row_version
          ?? Number(request.nextUrl.searchParams.get('expected_row_version')),
      });
      return NextResponse.json(result);
    }
  );
}
