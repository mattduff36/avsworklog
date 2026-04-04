import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess, verifyUserPassword } from '@/lib/server/account-switch-auth';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import {
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
  upsertAccountSwitchDevice,
  upsertAccountSwitchDeviceCredential,
} from '@/lib/server/account-switch-device';
import { ensureAccountSwitchSettings } from '@/lib/server/account-switch-settings';
import { hashQuickSwitchPin, validateQuickSwitchPin } from '@/lib/server/account-switch-pin';
import {
  buildAccountSwitchErrorResponse,
  getAccountSwitcherDisabledResponse,
} from '@/lib/server/account-switch-route-helpers';

interface SetupPinBody {
  currentPassword?: string;
  pin?: string;
  enableQuickSwitch?: boolean;
  deviceId?: string;
  deviceLabel?: string;
}

export async function POST(request: NextRequest) {
  const disabledResponse = getAccountSwitcherDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const { access, errorResponse } = await getAccountSwitchActorAccess();
  if (!access || errorResponse) {
    return errorResponse ?? buildAccountSwitchErrorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }

  try {
    const body = (await request.json()) as SetupPinBody;
    const currentPassword = body.currentPassword?.trim() || '';
    const pin = body.pin?.trim() || '';
    const enableQuickSwitch = body.enableQuickSwitch !== false;
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

    const pinValidation = validateQuickSwitchPin(pin);
    if (!pinValidation.isValid) {
      return buildAccountSwitchErrorResponse(
        'PIN_INVALID',
        pinValidation.errorMessage || 'Invalid PIN',
        400
      );
    }

    await ensureAccountSwitchSettings(access.userId);
    const existingCredential = await getAccountSwitchDeviceCredential({
      profileId: access.userId,
      rawDeviceId: deviceId,
    });
    const hasExistingPin = Boolean(existingCredential?.credential?.pin_hash);

    if (hasExistingPin && !currentPassword) {
      return buildAccountSwitchErrorResponse(
        'PASSWORD_REQUIRED_FOR_PIN_CHANGE',
        'Current password is required to change an existing PIN',
        400
      );
    }

    if (hasExistingPin || Boolean(currentPassword)) {
      const isPasswordValid = await verifyUserPassword(access.email, access.userId, currentPassword);
      if (!isPasswordValid) {
        return buildAccountSwitchErrorResponse(
          'PASSWORD_INVALID',
          'Current password is incorrect',
          401
        );
      }
    }

    const device = await upsertAccountSwitchDevice({
      profileId: access.userId,
      rawDeviceId: deviceId,
      deviceLabel: body.deviceLabel || null,
    });

    const pinHash = hashQuickSwitchPin(pin);
    await upsertAccountSwitchDeviceCredential({
      profileId: access.userId,
      rawDeviceId: deviceId,
      pinHash,
    });

    const supabaseAdmin = createAdminClient();
    const { data, error } = await supabaseAdmin
      .from('account_switch_settings')
      .update({
        quick_switch_enabled: enableQuickSwitch,
        pin_hash: pinHash,
        pin_failed_attempts: 0,
        pin_locked_until: null,
        pin_last_changed_at: new Date().toISOString(),
      })
      .eq('profile_id', access.userId)
      .select('*')
      .single();

    if (error || !data) {
      return buildAccountSwitchErrorResponse(
        'PIN_SAVE_FAILED',
        error?.message || 'Failed to save PIN',
        500
      );
    }

    await createAccountSwitchAuditEvent({
      profileId: access.userId,
      actorProfileId: access.userId,
      eventType: 'pin_setup',
      metadata: {
        quick_switch_enabled: enableQuickSwitch,
        device_id: device.id,
      },
    });

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
      settings: {
        quick_switch_enabled: data.quick_switch_enabled,
        pin_configured: true,
        pin_last_changed_at: data.pin_last_changed_at,
        device_registered: true,
      },
    });
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'PIN_SETUP_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
