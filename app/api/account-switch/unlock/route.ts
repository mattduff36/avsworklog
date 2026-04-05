import { NextRequest, NextResponse } from 'next/server';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import {
  clearAccountSwitchDeviceCredentialLock,
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
  updateAccountSwitchDeviceCredentialState,
} from '@/lib/server/account-switch-device';
import {
  ACCOUNT_SWITCH_MAX_PIN_ATTEMPTS,
  getAccountSwitchLockUntil,
  isPinLockActive,
  verifyQuickSwitchPin,
} from '@/lib/server/account-switch-pin';
import {
  buildAccountSwitchErrorResponse,
  getAccountSwitcherDisabledResponse,
} from '@/lib/server/account-switch-route-helpers';
import { clearLegacyLockCookie, clearLegacySupabaseCookies } from '@/lib/server/app-auth/response';
import { setAppSessionCookieInResponse } from '@/lib/server/app-auth/cookies';
import {
  getCurrentAuthenticatedProfile,
  issueAppSession,
  revokeAppSession,
} from '@/lib/server/app-auth/session';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';

interface UnlockBody {
  targetProfileId?: string;
  pin?: string;
  deviceId?: string;
}

export async function POST(request: NextRequest) {
  const disabledResponse = getAccountSwitcherDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const current = await getCurrentAuthenticatedProfile({ allowLocked: true });
  if (!current) {
    return buildAccountSwitchErrorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }
  const currentSession = current.validation.session;
  if (!currentSession) {
    return buildAccountSwitchErrorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }

  try {
    const body = (await request.json()) as UnlockBody;
    const targetProfileId = body.targetProfileId?.trim() || '';
    const pin = body.pin?.trim() || '';
    const deviceId = parseAccountSwitchDeviceId(body.deviceId);

    if (!targetProfileId) {
      return buildAccountSwitchErrorResponse(
        'TARGET_PROFILE_REQUIRED',
        'targetProfileId is required',
        400
      );
    }

    if (!pin) {
      return buildAccountSwitchErrorResponse('PIN_REQUIRED', 'PIN is required', 400);
    }

    if (!deviceId) {
      return buildAccountSwitchErrorResponse(
        'DEVICE_ID_REQUIRED',
        'A valid deviceId is required',
        400
      );
    }

    const targetDeviceCredential = await getAccountSwitchDeviceCredential({
      profileId: targetProfileId,
      rawDeviceId: deviceId,
    });
    if (!targetDeviceCredential?.credential) {
      return buildAccountSwitchErrorResponse(
        'PIN_NOT_CONFIGURED',
        'PIN is not configured for this account on this device',
        400
      );
    }

    if (isPinLockActive(targetDeviceCredential.credential.pin_locked_until)) {
      return buildAccountSwitchErrorResponse(
        'PIN_LOCKED',
        'PIN is temporarily locked. Please wait before trying again.',
        423,
        {
          pin_locked_until: targetDeviceCredential.credential.pin_locked_until,
        }
      );
    }

    const isValidPin = verifyQuickSwitchPin(pin, targetDeviceCredential.credential.pin_hash);
    if (!isValidPin) {
      const failedAttempts = targetDeviceCredential.credential.pin_failed_attempts + 1;
      const hasLockedPin = failedAttempts >= ACCOUNT_SWITCH_MAX_PIN_ATTEMPTS;
      const pinLockedUntil = hasLockedPin ? getAccountSwitchLockUntil() : null;

      await updateAccountSwitchDeviceCredentialState({
        profileId: targetProfileId,
        rawDeviceId: deviceId,
        pinFailedAttempts: failedAttempts,
        pinLockedUntil,
      });

      await createAccountSwitchAuditEvent({
        profileId: targetProfileId,
        actorProfileId: current.profile.id,
        eventType: hasLockedPin ? 'pin_locked' : 'session_switch_failed',
        metadata: {
          failed_attempts: failedAttempts,
          lock_until: pinLockedUntil,
          device_id: targetDeviceCredential.device.id,
          actor_profile_id: current.profile.id,
        },
      });

      return buildAccountSwitchErrorResponse(
        hasLockedPin ? 'PIN_LOCKED' : 'PIN_INCORRECT',
        hasLockedPin ? 'PIN locked due to too many failed attempts' : 'Incorrect PIN',
        hasLockedPin ? 423 : 401,
        {
          remaining_attempts: Math.max(0, ACCOUNT_SWITCH_MAX_PIN_ATTEMPTS - failedAttempts),
          pin_locked_until: pinLockedUntil,
        }
      );
    }

    await clearAccountSwitchDeviceCredentialLock({
      profileId: targetProfileId,
      rawDeviceId: deviceId,
    });

    const nextSession = await issueAppSession({
      profileId: targetProfileId,
      source: 'pin_unlock',
      rememberMe: currentSession.remember_me,
      rawDeviceId: deviceId,
      actorProfileId: current.profile.id,
    });

    await revokeAppSession(currentSession.id, 'replaced_by_pin_unlock', nextSession.row.id);

    const targetProfile = await getAppAuthProfile(targetProfileId, null);
    const response = NextResponse.json({
      success: true,
      profile: {
        profileId: targetProfile.id,
        fullName: targetProfile.full_name || null,
        avatarUrl: targetProfile.avatar_url || null,
        roleName: targetProfile.role?.name || null,
      },
    });

    clearLegacySupabaseCookies(request, response);
    clearLegacyLockCookie(response);
    setAppSessionCookieInResponse(response, nextSession.cookieValue, nextSession.cookieExpiresAt);
    return response;
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'SESSION_SWITCH_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
