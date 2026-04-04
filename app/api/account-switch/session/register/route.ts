import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ACCOUNT_SWITCHER_PRD_EPIC_ID } from '@/lib/account-switch/epic';
import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import {
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
  touchAccountSwitchDeviceSession,
} from '@/lib/server/account-switch-device';
import { verifyQuickSwitchPin } from '@/lib/server/account-switch-pin';
import {
  buildAccountSwitchErrorResponse,
  getAccountSwitcherDisabledResponse,
} from '@/lib/server/account-switch-route-helpers';

interface RegisterSessionBody {
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
    const body = (await request.json()) as RegisterSessionBody;
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
        'Quick switch PIN must be set before registering this account',
        400
      );
    }

    const isValidPin = verifyQuickSwitchPin(pin, deviceCredential.credential.pin_hash);
    if (!isValidPin) {
      return buildAccountSwitchErrorResponse(
        'PIN_INCORRECT',
        'Entered PIN does not match your configured quick switch PIN',
        401
      );
    }

    await touchAccountSwitchDeviceSession({
      profileId: access.userId,
      rawDeviceId: deviceId,
      sessionHint: request.headers.get('user-agent') || null,
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
      .eq('id', access.userId)
      .single();

    if (profileError || !profileData) {
      return buildAccountSwitchErrorResponse(
        'PROFILE_NOT_FOUND',
        profileError?.message || 'Profile not found',
        404
      );
    }

    const roleValue = Array.isArray(profileData.role) ? profileData.role[0] || null : profileData.role || null;

    await createAccountSwitchAuditEvent({
      profileId: access.userId,
      actorProfileId: access.userId,
      eventType: 'session_registered',
      metadata: {
        device_id: deviceCredential.device.id,
      },
    });

    return NextResponse.json({
      success: true,
      prd_epic_id: ACCOUNT_SWITCHER_PRD_EPIC_ID,
      profile: {
        profileId: profileData.id,
        email: access.email,
        fullName: profileData.full_name || null,
        avatarUrl: profileData.avatar_url || null,
        roleName: roleValue?.name || null,
      },
    });
  } catch (error) {
    return buildAccountSwitchErrorResponse(
      'SESSION_REGISTER_FAILED',
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
