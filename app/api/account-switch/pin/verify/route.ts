import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
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

interface VerifyPinBody {
  pin?: string;
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
    const body = (await request.json()) as VerifyPinBody;
    const pin = body.pin?.trim() || '';
    const deviceId = parseAccountSwitchDeviceId(body.deviceId);
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

    const deviceCredential = await getAccountSwitchDeviceCredential({
      profileId: access.userId,
      rawDeviceId: deviceId,
    });

    if (!deviceCredential?.credential) {
      return buildAccountSwitchErrorResponse(
        'PIN_NOT_CONFIGURED',
        'PIN is not configured for this account on this device',
        400
      );
    }

    if (isPinLockActive(deviceCredential.credential.pin_locked_until)) {
      return buildAccountSwitchErrorResponse(
        'PIN_LOCKED',
        'PIN is temporarily locked. Please wait before trying again.',
        423,
        {
          pin_locked_until: deviceCredential.credential.pin_locked_until,
        }
      );
    }

    const isValid = verifyQuickSwitchPin(pin, deviceCredential.credential.pin_hash);

    if (!isValid) {
      const failedAttempts = deviceCredential.credential.pin_failed_attempts + 1;
      const hasLockedPin = failedAttempts >= ACCOUNT_SWITCH_MAX_PIN_ATTEMPTS;
      const pinLockedUntil = hasLockedPin ? getAccountSwitchLockUntil() : null;

      await updateAccountSwitchDeviceCredentialState({
        profileId: access.userId,
        rawDeviceId: deviceId,
        pinFailedAttempts: failedAttempts,
        pinLockedUntil,
      });

      await createAccountSwitchAuditEvent({
        profileId: access.userId,
        actorProfileId: access.userId,
        eventType: hasLockedPin ? 'pin_locked' : 'pin_verify_failed',
        metadata: {
          failed_attempts: failedAttempts,
          lock_until: pinLockedUntil,
          device_id: deviceCredential.device.id,
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
      profileId: access.userId,
      rawDeviceId: deviceId,
    });

    await createAccountSwitchAuditEvent({
      profileId: access.userId,
      actorProfileId: access.userId,
      eventType: 'pin_verify_success',
      metadata: {
        device_id: deviceCredential.device.id,
      },
    });

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
    });
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'PIN_VERIFY_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
