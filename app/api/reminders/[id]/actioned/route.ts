import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canViewReminders = await canEffectiveRoleAccessModule('reminders');
    if (!canViewReminders) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { action_note?: string };
    const actionNote = typeof body.action_note === 'string' ? body.action_note.trim() : '';
    const nowIso = new Date().toISOString();
    const admin = createAdminClient();

    const { data: reminder, error: reminderError } = await admin
      .from('reminders')
      .select('id, assigned_to, status')
      .eq('id', id)
      .maybeSingle();

    if (reminderError) {
      throw reminderError;
    }

    if (!reminder) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
    }

    if (reminder.assigned_to !== current.profile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (reminder.status !== 'pending') {
      return NextResponse.json({ error: 'Reminder is no longer pending' }, { status: 400 });
    }

    const { data: updatedReminder, error: updateError } = await admin
      .from('reminders')
      .update({
        status: 'actioned',
        action_note: actionNote || null,
        actioned_at: nowIso,
        actioned_by: current.profile.id,
        cancelled_at: null,
      })
      .eq('id', id)
      .eq('assigned_to', current.profile.id)
      .select('id, status, actioned_at, action_note')
      .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      reminder: updatedReminder,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reminders/[id]/actioned',
      additionalData: {
        endpoint: 'POST /api/reminders/[id]/actioned',
      },
    });

    return NextResponse.json(
      { error: 'Failed to action reminder' },
      { status: 500 },
    );
  }
}
