import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess, verifyUserPassword } from '@/lib/server/account-switch-auth';
import {
  clearAccountSwitchDeviceCredentialLock,
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
} from '@/lib/server/account-switch-device';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import {
  buildAccountSwitchErrorResponse,
  getAccountSwitcherDisabledResponse,
} from '@/lib/server/account-switch-route-helpers';

interface PasswordFallbackBody {
  currentPassword?: string;
  deviceId?: string;
}

export async function POST(request: NextRequest) {
  const disabledResponse = getAccountSwitcherDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const { access, errorResponse } = await getAccountSwitchActorAccess();
  if (!access || errorResponse) {
    return errorResponse ?? buildAccountSwitchErrorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }

  try {
    const body = (await request.json()) as PasswordFallbackBody;
    const currentPassword = body.currentPassword?.trim() || '';
    const deviceId = parseAccountSwitchDeviceId(body.deviceId);

    if (!currentPassword) {
      return buildAccountSwitchErrorResponse('PASSWORD_REQUIRED', 'Current password is required', 400);
    }

    if (!deviceId) {
      return buildAccountSwitchErrorResponse(
        'DEVICE_ID_REQUIRED',
        'A valid deviceId is required',
        400
      );
    }

    const isPasswordValid = await verifyUserPassword(access.email, access.userId, currentPassword);
    if (!isPasswordValid) {
      await createAccountSwitchAuditEvent({
        profileId: access.userId,
        actorProfileId: access.userId,
        eventType: 'password_fallback_failed',
      });
      return buildAccountSwitchErrorResponse(
        'PASSWORD_INVALID',
        'Current password is incorrect',
        401
      );
    }

    const deviceCredential = await getAccountSwitchDeviceCredential({
      profileId: access.userId,
      rawDeviceId: deviceId,
    });

    if (deviceCredential?.credential) {
      await clearAccountSwitchDeviceCredentialLock({
        profileId: access.userId,
        rawDeviceId: deviceId,
      });
    }

    await createAccountSwitchAuditEvent({
      profileId: access.userId,
      actorProfileId: access.userId,
      eventType: 'password_fallback_success',
      metadata: {
        lock_reset: Boolean(deviceCredential?.credential),
      },
    });

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
      lock_reset: Boolean(deviceCredential?.credential),
    });
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'PASSWORD_FALLBACK_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
