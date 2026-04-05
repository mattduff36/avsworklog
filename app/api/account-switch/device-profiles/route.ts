import { NextRequest, NextResponse } from 'next/server';
import { listAccountSwitchDeviceProfiles, parseAccountSwitchDeviceId } from '@/lib/server/account-switch-device';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';

export async function GET(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile({ allowLocked: true });
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const deviceId = parseAccountSwitchDeviceId(
    request.nextUrl.searchParams.get('deviceId')
  );

  if (!deviceId) {
    return NextResponse.json(
      { error: 'A valid deviceId is required' },
      { status: 400 }
    );
  }

  try {
    const profiles = await listAccountSwitchDeviceProfiles(deviceId);
    const response = NextResponse.json({
      success: true,
      current_profile_id: current.profile.id,
      profiles,
    });
    applyValidationCookieIfNeeded(response, current.validation);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load device profiles' },
      { status: 500 }
    );
  }
}
