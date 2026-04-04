import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import {
  clearAccountSwitchDeviceCredentialLock,
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
  touchAccountSwitchDeviceSession,
  updateAccountSwitchDeviceCredentialState,
} from '@/lib/server/account-switch-device';
import {
  ACCOUNT_SWITCH_MAX_PIN_ATTEMPTS,
  getAccountSwitchLockUntil,
  isPinLockActive,
  verifyQuickSwitchPin,
} from '@/lib/server/account-switch-pin';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildAccountSwitchErrorResponse,
  getAccountSwitcherDisabledResponse,
} from '@/lib/server/account-switch-route-helpers';

interface SwitchSessionBody {
  targetProfileId?: string;
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
    const body = (await request.json()) as SwitchSessionBody;
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
        'Switch PIN is not configured for this account on this device',
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
        actorProfileId: access.userId,
        eventType: hasLockedPin ? 'pin_locked' : 'session_switch_failed',
        metadata: {
          failed_attempts: failedAttempts,
          lock_until: pinLockedUntil,
          device_id: targetDeviceCredential.device.id,
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

    await touchAccountSwitchDeviceSession({
      profileId: targetProfileId,
      rawDeviceId: deviceId,
      markSwitch: true,
    });

    const supabaseAdmin = createAdminClient();
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        full_name,
        avatar_url,
        role:roles(
          name
        )
      `)
      .eq('id', targetProfileId)
      .single();

    if (profileError || !profileData) {
      return buildAccountSwitchErrorResponse(
        'TARGET_PROFILE_NOT_FOUND',
        profileError?.message || 'Target profile not found',
        404
      );
    }

    const roleValue = Array.isArray(profileData.role) ? profileData.role[0] || null : profileData.role || null;

    await createAccountSwitchAuditEvent({
      profileId: targetProfileId,
      actorProfileId: access.userId,
      eventType: 'session_switch_success',
      metadata: {
        from_profile_id: access.userId,
        device_id: targetDeviceCredential.device.id,
      },
    });

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
      switch_authorized_at: new Date().toISOString(),
      profile: {
        profileId: profileData.id,
        fullName: profileData.full_name || null,
        avatarUrl: profileData.avatar_url || null,
        roleName: roleValue?.name || null,
      },
    });
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'SESSION_SWITCH_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
