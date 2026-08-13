import { NextRequest, NextResponse } from 'next/server';
import {
  deleteDailyAllocationVisit,
  readJsonBody,
  readOptionalJsonBody,
  runDailyAllocationRoute,
  upsertDailyAllocationVisit,
} from '@/lib/server/daily-allocation';
import type { DailyAllocationVisitUpsertInput } from '@/types/daily-allocation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/visits/[id]',
    'PATCH /api/daily-allocation/visits/[id]',
    async () => {
      const { id } = await params;
      const body = await readJsonBody(request) as DailyAllocationVisitUpsertInput;
      const result = await upsertDailyAllocationVisit({ ...body, visit_id: id });
      return NextResponse.json(result);
    }
  );
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/visits/[id]',
    'DELETE /api/daily-allocation/visits/[id]',
    async () => {
      const { id } = await params;
      const body = await readOptionalJsonBody(request) as {
        expected_plan_version?: number;
        expected_row_version?: number;
      };
      const expectedPlanVersion = body.expected_plan_version
        ?? Number(request.nextUrl.searchParams.get('expected_plan_version'));
      const expectedRowVersion = body.expected_row_version
        ?? Number(request.nextUrl.searchParams.get('expected_row_version'));
      const result = await deleteDailyAllocationVisit({
        visit_id: id,
        expected_plan_version: expectedPlanVersion,
        expected_row_version: expectedRowVersion,
      });
      return NextResponse.json(result);
    }
  );
}
