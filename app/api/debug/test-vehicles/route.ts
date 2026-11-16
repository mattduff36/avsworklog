import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { withInspectionDeletionDatabase } from '@/lib/server/inspection-deletion';
import { listTestAssets, resetTestFleet, TestFleetResetError } from '@/lib/server/test-fleet-reset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bodySchema = z.object({
  mode: z.enum(['preview','execute']),
  assetIds: z.array(z.string().uuid()).length(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  confirmation: z.literal('RESET TEST RECORDS').optional(),
}).strict();
async function actor() {
  const role = await getEffectiveRole();
  return role.is_actual_super_admin && !role.is_viewing_as ? role.user_id : null;
}
function failure(error: unknown) {
  return NextResponse.json({error: error instanceof TestFleetResetError ? error.message : 'Test Fleet reset is unavailable. No reset was committed.'},
    {status:error instanceof TestFleetResetError ? error.status : 503});
}
export async function GET() {
  if (!await actor()) return NextResponse.json({error:'Super-admin access is required.'},{status:403});
  try { return NextResponse.json({assets:await withInspectionDeletionDatabase(listTestAssets)}); }
  catch(error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const actorId=await actor();
  if (!actorId) return NextResponse.json({error:'Super-admin access is required.'},{status:403});
  if (request.headers.get('origin')!==request.nextUrl.origin) return NextResponse.json({error:'Invalid request origin.'},{status:403});
  try {
    const body=bodySchema.safeParse(await request.json());
    if (!body.success || (body.data.mode==='execute' && (!body.data.fingerprint || !body.data.confirmation))) {
      return NextResponse.json({error:'Preview and confirm the selected test assets first.'},{status:400});
    }
    return NextResponse.json(await withInspectionDeletionDatabase(db=>resetTestFleet(db,{
      assetIds:body.data.assetIds,actorId,fingerprint:body.data.fingerprint,execute:body.data.mode==='execute',
    })));
  } catch(error) { return failure(error); }
}
export async function DELETE() {
  return NextResponse.json({error:'Test assets are retained. Use the preview and reset flow.'},{status:405});
}
