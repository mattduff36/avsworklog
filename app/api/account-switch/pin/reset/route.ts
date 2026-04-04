import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess, verifyUserPassword } from '@/lib/server/account-switch-auth';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import {
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

interface ResetPinBody {
  currentPassword?: string;
  newPin?: string;
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
    const body = (await request.json()) as ResetPinBody;
    const currentPassword = body.currentPassword?.trim() || '';
    const newPin = body.newPin?.trim() || '';
    const deviceId = parseAccountSwitchDeviceId(body.deviceId);

    if (!currentPassword) {
      return buildAccountSwitchErrorResponse(
        'PASSWORD_REQUIRED',
        'Current password is required',
        400
      );
    }

    if (!newPin) {
      return buildAccountSwitchErrorResponse('PIN_REQUIRED', 'New PIN is required', 400);
    }

    if (!deviceId) {
      return buildAccountSwitchErrorResponse(
        'DEVICE_ID_REQUIRED',
        'A valid deviceId is required',
        400
      );
    }

    const pinValidation = validateQuickSwitchPin(newPin);
    if (!pinValidation.isValid) {
      return buildAccountSwitchErrorResponse(
        'PIN_INVALID',
        pinValidation.errorMessage || 'Invalid PIN',
        400
      );
    }

    const isPasswordValid = await verifyUserPassword(access.email, access.userId, currentPassword);
    if (!isPasswordValid) {
      return buildAccountSwitchErrorResponse(
        'PASSWORD_INVALID',
        'Current password is incorrect',
        401
      );
    }

    await ensureAccountSwitchSettings(access.userId);
    const device = await upsertAccountSwitchDevice({
      profileId: access.userId,
      rawDeviceId: deviceId,
      deviceLabel: body.deviceLabel || null,
    });

    const pinHash = hashQuickSwitchPin(newPin);
    await upsertAccountSwitchDeviceCredential({
      profileId: access.userId,
      rawDeviceId: deviceId,
      pinHash,
    });

    const supabaseAdmin = createAdminClient();
    const { error } = await supabaseAdmin
      .from('account_switch_settings')
      .update({
        pin_hash: pinHash,
        quick_switch_enabled: true,
        pin_failed_attempts: 0,
        pin_locked_until: null,
        pin_last_changed_at: new Date().toISOString(),
      })
      .eq('profile_id', access.userId);

    if (error) {
      return buildAccountSwitchErrorResponse(
        'PIN_RESET_SAVE_FAILED',
        error.message,
        500
      );
    }

    await createAccountSwitchAuditEvent({
      profileId: access.userId,
      actorProfileId: access.userId,
      eventType: 'pin_reset',
      metadata: {
        device_id: device.id,
      },
    });

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
    });
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'PIN_RESET_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
