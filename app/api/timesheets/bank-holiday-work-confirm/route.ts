import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import {
  validateAppSession,
  type AppSessionValidationResult,
} from '@/lib/server/app-auth/session';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import {
  TimesheetBankHolidayWorkError,
  confirmBankHolidayWork,
} from '@/lib/server/timesheet-bank-holiday-work';
import { authorizeTimesheetSubmit } from '@/lib/server/timesheet-submit';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';

const ConfirmBodySchema = z
  .object({
    timesheetId: z.string().uuid().nullable().optional(),
    userId: z.string().uuid(),
    weekEnding: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    timesheetType: z.enum(['civils', 'plant']).optional(),
    templateVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)).min(1).max(7),
    phrase: z.string().min(1).max(64),
  })
  .strict();

function jsonWithSession(
  session: AppSessionValidationResult,
  body: unknown,
  status = 200
): NextResponse {
  const response = NextResponse.json(body, { status });
  applyValidationCookieIfNeeded(response, session);
  return response;
}

export async function POST(request: NextRequest) {
  const session = await validateAppSession();
  try {
    if (session.status !== 'active' || !session.profileId) {
      return jsonWithSession(session, { error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }
    const profile = await getAppAuthProfile(session.profileId, session.email);
    const actorId = profile.id;

    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return jsonWithSession(session, { error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    const canAccessTimesheets = await canEffectiveRoleAccessModule('timesheets');
    if (!canAccessTimesheets) {
      return jsonWithSession(session, { error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonWithSession(
        session,
        { error: 'Invalid bank holiday confirm payload', code: 'INVALID_INPUT' },
        400
      );
    }

    const parsed = ConfirmBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonWithSession(
        session,
        { error: 'Invalid bank holiday confirm payload', code: 'INVALID_INPUT' },
        400
      );
    }

    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, team_id')
      .eq('id', parsed.data.userId)
      .maybeSingle();
    if (targetError || !target) {
      return jsonWithSession(
        session,
        { error: 'Invalid bank holiday confirm payload', code: 'INVALID_INPUT' },
        400
      );
    }

    const canAuthoriseTarget =
      actorId === parsed.data.userId
        ? false
        : await canCurrentActorAuthoriseTimesheetTarget(
            {
              profileId: parsed.data.userId,
              teamId: target.team_id || null,
            },
            { effectiveRole }
          );

    if (!authorizeTimesheetSubmit({
      actorId,
      targetUserId: parsed.data.userId,
      canAuthoriseTarget,
    })) {
      return jsonWithSession(session, { error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    }

    const result = await confirmBankHolidayWork({
      input: {
        actorId,
        targetUserId: parsed.data.userId,
        weekEnding: parsed.data.weekEnding,
        timesheetId: parsed.data.timesheetId,
        timesheetType: parsed.data.timesheetType,
        templateVersion: parsed.data.templateVersion,
        dates: parsed.data.dates,
        phrase: parsed.data.phrase,
      },
    });
    return jsonWithSession(session, { success: true, ...result });
  } catch (error) {
    if (error instanceof TimesheetBankHolidayWorkError) {
      return jsonWithSession(session, { error: error.message, code: error.code }, error.status);
    }

    void logServerError({
      error: error instanceof Error ? error : new Error('Failed to confirm bank holiday hours'),
      componentName: 'timesheet-bank-holiday-work-confirm',
      additionalData: { route: '/api/timesheets/bank-holiday-work-confirm' },
    });
    return jsonWithSession(
      session,
      { error: 'Failed to confirm bank holiday hours', code: 'SAVE_FAILED' },
      500
    );
  }
}
