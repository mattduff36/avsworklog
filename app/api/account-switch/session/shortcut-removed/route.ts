import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import {
  buildAccountSwitchErrorResponse,
  getAccountSwitcherDisabledResponse,
} from '@/lib/server/account-switch-route-helpers';

interface ShortcutRemovedBody {
  targetProfileId?: string;
}

export async function POST(request: NextRequest) {
  const disabledResponse = getAccountSwitcherDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const { access, errorResponse } = await getAccountSwitchActorAccess();
  if (!access || errorResponse) {
    return errorResponse ?? buildAccountSwitchErrorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }

  try {
    const body = (await request.json()) as ShortcutRemovedBody;
    const targetProfileId = body.targetProfileId?.trim() || '';
    if (!targetProfileId) {
      return buildAccountSwitchErrorResponse(
        'TARGET_PROFILE_REQUIRED',
        'targetProfileId is required',
        400
      );
    }

    await createAccountSwitchAuditEvent({
      profileId: targetProfileId,
      actorProfileId: access.userId,
      eventType: 'shortcut_removed',
    });

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
    });
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'SHORTCUT_REMOVE_AUDIT_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
