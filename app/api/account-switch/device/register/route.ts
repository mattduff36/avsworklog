import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
import {
  parseAccountSwitchDeviceId,
  upsertAccountSwitchDevice,
} from '@/lib/server/account-switch-device';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import {
  buildAccountSwitchErrorResponse,
  getAccountSwitcherDisabledResponse,
} from '@/lib/server/account-switch-route-helpers';

interface RegisterDeviceBody {
  deviceId?: string;
  deviceLabel?: string;
}

export async function POST(request: NextRequest) {
  const disabledResponse = getAccountSwitcherDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const { access, errorResponse } = await getAccountSwitchActorAccess(
    '/api/account-switch/device/register'
  );
  if (!access || errorResponse) {
    return errorResponse ?? buildAccountSwitchErrorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }

  try {
    const rawBody = await request.text();
    const body = rawBody ? (JSON.parse(rawBody) as RegisterDeviceBody) : {};
    const deviceId = parseAccountSwitchDeviceId(body.deviceId);
    if (!deviceId) {
      return buildAccountSwitchErrorResponse(
        'DEVICE_ID_REQUIRED',
        'A valid deviceId is required',
        400
      );
    }

    const device = await upsertAccountSwitchDevice({
      profileId: access.userId,
      rawDeviceId: deviceId,
      deviceLabel: body.deviceLabel || null,
    });

    await createAccountSwitchAuditEvent({
      profileId: access.userId,
      actorProfileId: access.userId,
      eventType: 'device_registered',
      metadata: {
        device_id: device.id,
        device_label: device.device_label,
      },
    });

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
      device: {
        id: device.id,
        trusted_at: device.trusted_at,
        last_seen_at: device.last_seen_at,
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return buildAccountSwitchErrorResponse(
        'INVALID_JSON',
        'Request body must be valid JSON',
        400
      );
    }

    return buildAccountSwitchErrorResponse(
      'DEVICE_REGISTER_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
