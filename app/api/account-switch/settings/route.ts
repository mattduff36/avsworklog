import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
import {
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
} from '@/lib/server/account-switch-device';
import { ensureAccountSwitchSettings } from '@/lib/server/account-switch-settings';
import { isPinLockActive } from '@/lib/server/account-switch-pin';
import {
  buildAccountSwitchErrorResponse,
  getAccountSwitcherDisabledResponse,
} from '@/lib/server/account-switch-route-helpers';

export async function GET(request: NextRequest) {
  const disabledResponse = getAccountSwitcherDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const { access, errorResponse } = await getAccountSwitchActorAccess(
    '/api/account-switch/settings'
  );
  if (!access || errorResponse) {
    return errorResponse ?? buildAccountSwitchErrorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }

  try {
    const deviceId = parseAccountSwitchDeviceId(
      new URL(request.url).searchParams.get('deviceId')
    );
    const settings = await ensureAccountSwitchSettings(access.userId);
    let pinFailedAttempts = 0;
    let pinLockedUntil: string | null = null;
    let pinConfigured = false;
    let pinLastChangedAt: string | null = null;
    let deviceRegistered = false;

    if (deviceId) {
      const deviceCredential = await getAccountSwitchDeviceCredential({
        profileId: access.userId,
        rawDeviceId: deviceId,
      });
      if (deviceCredential?.device) {
        deviceRegistered = true;
      }
      if (deviceCredential?.credential) {
        pinConfigured = Boolean(deviceCredential.credential.pin_hash);
        pinFailedAttempts = deviceCredential.credential.pin_failed_attempts;
        pinLockedUntil = deviceCredential.credential.pin_locked_until;
        pinLastChangedAt = deviceCredential.credential.pin_last_changed_at;
      } else {
        pinConfigured = false;
        pinFailedAttempts = 0;
        pinLockedUntil = null;
        pinLastChangedAt = null;
      }
    }

    const isLocked = isPinLockActive(pinLockedUntil);

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
      feature_enabled: true,
      settings: {
        quick_switch_enabled: settings.quick_switch_enabled,
        pin_configured: pinConfigured,
        pin_failed_attempts: pinFailedAttempts,
        pin_locked_until: pinLockedUntil,
        pin_is_locked: isLocked,
        pin_last_changed_at: pinLastChangedAt,
        device_registered: deviceRegistered,
      },
    });
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'SETTINGS_LOAD_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
