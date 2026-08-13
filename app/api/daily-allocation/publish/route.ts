import { NextRequest, NextResponse } from 'next/server';
import {
  publishDailyAllocationFromBody,
  readJsonBody,
  runDailyAllocationRoute,
} from '@/lib/server/daily-allocation';

export async function POST(request: NextRequest) {
  return runDailyAllocationRoute(
    request,
    '/api/daily-allocation/publish',
    'POST /api/daily-allocation/publish',
    async () => {
      const body = await readJsonBody(request) as {
        work_date?: string;
        idempotency_key?: string;
        snapshot_version?: 1 | 2;
        plan_day_id?: string;
        expected_plan_version?: number;
        confirm_unallocated?: boolean;
      };
      const result = await publishDailyAllocationFromBody(body);
      if ('publication' in result) {
        return NextResponse.json({ publication: result.publication, snapshot_version: result.snapshot_version });
      }
      return NextResponse.json(result);
    }
  );
}
