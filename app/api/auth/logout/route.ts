import { NextRequest, NextResponse } from 'next/server';
import { isAccountSwitcherEnabledServer } from '@/lib/account-switch/feature-flag';
import { clearAccountSwitchDevicePin, parseAccountSwitchDeviceId } from '@/lib/server/account-switch-device';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import { clearAllAuthCookies } from '@/lib/server/app-auth/response';
import { revokeAppSession, validateAppSession } from '@/lib/server/app-auth/session';
import { createClient } from '@/lib/supabase/server';

interface LogoutRequestBody {
  deviceId?: string;
}

export async function POST(request: NextRequest) {
  let response: NextResponse = NextResponse.json({ success: true });
  const accountSwitcherEnabled = isAccountSwitcherEnabledServer();

  try {
    const validation = await validateAppSession({ allowLocked: true });
    if (validation.session) {
      const body = (await request.json().catch(() => ({}))) as LogoutRequestBody;
      const deviceId = accountSwitcherEnabled ? parseAccountSwitchDeviceId(body.deviceId) : null;

      if (deviceId) {
        const pinCleared = await clearAccountSwitchDevicePin({
          profileId: validation.session.profile_id,
          rawDeviceId: deviceId,
        });

        if (pinCleared) {
          await createAccountSwitchAuditEvent({
            profileId: validation.session.profile_id,
            actorProfileId: validation.session.profile_id,
            eventType: 'device_pin_cleared',
            metadata: {
              app_session_id: validation.session.id,
            },
          });
        }
      }

      await revokeAppSession(validation.session.id, 'logout');
    } else {
      const supabase = await createClient();
      await supabase.auth.signOut();
    }
  } catch (error) {
    response = NextResponse.json(
      { error: error instanceof Error ? error.message : 'Logout failed' },
      { status: 500 }
    );
  } finally {
    clearAllAuthCookies(request, response);
  }

  return response;
}
