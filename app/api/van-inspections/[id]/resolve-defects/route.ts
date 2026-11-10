import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import { getVanInspectionsMaintenanceResponse } from '@/lib/server/van-inspections-maintenance';
import { dailyCheckEffectSource } from '@/lib/inspections/deletion';
import { logServerError } from '@/lib/utils/server-error-logger';

const schema = z.object({
  resolutions: z.array(z.object({
    itemNumber: z.number().int().positive(),
    itemDescription: z.string().min(1).max(1000),
    comment: z.string().trim().min(1).max(5000),
  }).strict()).max(200),
}).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { access, errorResponse } = await getInspectionRouteActorAccess('inspections');
    if (errorResponse || !access) return errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const maintenance = getVanInspectionsMaintenanceResponse();
    if (maintenance) return maintenance;
    const id = z.string().uuid().safeParse((await params).id);
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!id.success || !input.success) return NextResponse.json({ error: 'Invalid defect resolutions' }, { status: 400 });
    const admin = createAdminClient();
    const { data: check, error } = await admin.from('van_inspections').select('van_id, user_id').eq('id', id.data).maybeSingle();
    if (error) throw error;
    if (!check) return NextResponse.json({ error: 'Daily Check not found' }, { status: 404 });
    if (check.user_id !== access.userId && !access.canManageOthers) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!check.van_id) return NextResponse.json({ error: 'Daily Check has no linked van' }, { status: 409 });
    const { data: answers, error: answerError } = await admin.from('inspection_items')
      .select('item_number, item_description, status').eq('inspection_id', id.data);
    if (answerError) throw answerError;
    if (input.data.resolutions.some(resolution => !answers?.some(answer =>
      answer.item_number === resolution.itemNumber && answer.item_description === resolution.itemDescription && answer.status === 'ok'))) {
      return NextResponse.json({ error: 'Daily Check answers changed; refresh before resolving defects' }, { status: 409 });
    }
    const { data: tasks, error: taskError } = await admin.from('actions')
      .select('id, inspection_item_id, description').eq('van_id', check.van_id)
      .eq('action_type', 'inspection_defect').in('status', ['pending', 'logged']);
    if (taskError) throw taskError;
    const ids = (tasks ?? []).flatMap(task => task.inspection_item_id ? [task.inspection_item_id] : []);
    if (!ids.length) return NextResponse.json({ success: true });
    const { data: items, error: itemError } = await admin.from('inspection_items')
      .select('id, item_number, item_description').in('id', ids);
    if (itemError) throw itemError;
    for (const resolution of input.data.resolutions) {
      const item = items?.find(value => value.item_number === resolution.itemNumber && value.item_description === resolution.itemDescription);
      const task = tasks?.find(value => value.inspection_item_id === item?.id);
      if (!task) continue;
      const { error: updateError } = await admin.from('actions').update({
        ...dailyCheckEffectSource('van', id.data),
        status: 'completed', actioned: true, actioned_at: new Date().toISOString(), actioned_by: access.userId,
        description: `${task.description || ''}\n\nResolution: ${resolution.comment}`,
      }).eq('id', task.id).in('status', ['pending', 'logged']);
      if (updateError) throw updateError;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23503') {
      return NextResponse.json({ error: 'Daily Check changed or was deleted; refresh before retrying' }, { status: 409 });
    }
    await logServerError({ error: new Error('Daily Check defect resolution failed'), request, componentName: '/api/van-inspections/[id]/resolve-defects' });
    return NextResponse.json({ error: 'Failed to complete resolved defect tasks' }, { status: 500 });
  }
}
