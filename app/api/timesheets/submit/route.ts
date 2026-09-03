import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import {
  validateAppSession,
  type AppSessionValidationResult,
} from '@/lib/server/app-auth/session';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import {
  TIMESHEET_SUBMIT_FORBIDDEN,
  TimesheetSubmitBodySchema,
  TimesheetSubmitError,
  applyTimesheetSubmit,
  authorizeTimesheetSubmit,
} from '@/lib/server/timesheet-submit';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';

const FORBIDDEN_BODY = { error: TIMESHEET_SUBMIT_FORBIDDEN, code: 'FORBIDDEN' as const };

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
      return jsonWithSession(session, FORBIDDEN_BODY, 403);
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonWithSession(
        session,
        { error: 'Invalid timesheet submit payload', code: 'INVALID_INPUT' },
        400
      );
    }
    const parsed = TimesheetSubmitBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonWithSession(
        session,
        { error: 'Invalid timesheet submit payload', code: 'INVALID_INPUT' },
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
        { error: 'Invalid timesheet submit payload', code: 'INVALID_INPUT' },
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
      return jsonWithSession(session, FORBIDDEN_BODY, 403);
    }

    const result = await applyTimesheetSubmit({ body: parsed.data });
    return jsonWithSession(session, result);
  } catch (error) {
    if (error instanceof TimesheetSubmitError) {
      if (error.status === 403) {
        return jsonWithSession(session, FORBIDDEN_BODY, 403);
      }
      return jsonWithSession(session, { error: error.message, code: error.code }, error.status);
    }

    void logServerError({
      error: error instanceof Error ? error : new Error('Failed to submit timesheet'),
      componentName: 'timesheet-submit',
      additionalData: { route: '/api/timesheets/submit' },
    });
    return jsonWithSession(
      session,
      { error: 'Failed to submit timesheet', code: 'SAVE_FAILED' },
      500
    );
  }
}
