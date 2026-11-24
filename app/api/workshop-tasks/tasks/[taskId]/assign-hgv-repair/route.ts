import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireWorkshopTasksAccess } from '@/lib/server/workshop-tasks/auth';

const assignment = z.object({
  side: z.enum(['tractor', 'trailer']),
  expectedSide: z.enum(['pair', 'tractor', 'trailer']),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const access = await requireWorkshopTasksAccess();
  if (!access.ok) return NextResponse.json({ error: 'Workshop access required' }, { status: access.status });
  const { taskId } = await params;
  const body = assignment.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(taskId).success || !body.success) {
    return NextResponse.json({ error: 'Invalid repair assignment' }, { status: 400 });
  }
  const { error } = await createAdminClient().rpc('assign_hgv_trailer_repair', {
    p_task_id: taskId,
    p_actor_id: access.userId,
    p_side: body.data.side,
    p_expected_side: body.data.expectedSide,
  });
  if (error) return NextResponse.json({ error: 'Refresh the task and check its current assignment.' }, { status: 409 });
  return NextResponse.json({ success: true });
}
