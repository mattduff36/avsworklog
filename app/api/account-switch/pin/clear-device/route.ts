import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import {
  clearAccountSwitchDevicePin,
  parseAccountSwitchDeviceId,
} from '@/lib/server/account-switch-device';
import {
  buildAccountSwitchErrorResponse,
  getAccountSwitcherDisabledResponse,
} from '@/lib/server/account-switch-route-helpers';

interface ClearDevicePinBody {
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
    const body = (await request.json()) as ClearDevicePinBody;
    const deviceId = parseAccountSwitchDeviceId(body.deviceId);
    if (!deviceId) {
      return buildAccountSwitchErrorResponse(
        'DEVICE_ID_REQUIRED',
        'A valid deviceId is required',
        400
      );
    }

    const pinCleared = await clearAccountSwitchDevicePin({
      profileId: access.userId,
      rawDeviceId: deviceId,
    });

    if (pinCleared) {
      await createAccountSwitchAuditEvent({
        profileId: access.userId,
        actorProfileId: access.userId,
        eventType: 'device_pin_cleared',
        metadata: {},
      });
    }

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
      pin_cleared: pinCleared,
    });
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'CLEAR_DEVICE_PIN_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
