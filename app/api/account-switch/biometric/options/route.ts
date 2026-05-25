import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { parseAccountSwitchDeviceId } from '@/lib/server/account-switch-device';
import { getWebAuthnRequestConfig } from '@/lib/server/webauthn/config';
import {
  getActiveWebAuthnCredentialsForProfile,
  saveWebAuthnChallenge,
} from '@/lib/server/webauthn/credentials';

export const runtime = 'nodejs';

interface BiometricOptionsBody {
  targetProfileId?: string;
  deviceId?: string;
}

export async function POST(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile({ allowLocked: true });
  if (!current?.validation.session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as BiometricOptionsBody;
  const targetProfileId = body.targetProfileId?.trim() || '';
  const deviceId = parseAccountSwitchDeviceId(body.deviceId);

  if (!targetProfileId || !deviceId) {
    return NextResponse.json(
      { error: 'targetProfileId and a valid deviceId are required' },
      { status: 400 }
    );
  }

  const credentials = await getActiveWebAuthnCredentialsForProfile({
    profileId: targetProfileId,
    rawDeviceId: deviceId,
  });
  if (credentials.length === 0) {
    return NextResponse.json(
      { error: 'Biometric unlock is not configured for this account on this device' },
      { status: 400 }
    );
  }

  const config = await getWebAuthnRequestConfig();
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: credentials.map((credential) => ({
      id: credential.credential_id,
      transports: credential.transports || undefined,
    })),
    userVerification: 'required',
  });

  await saveWebAuthnChallenge({
    profileId: targetProfileId,
    rawDeviceId: deviceId,
    challenge: options.challenge,
    challengeType: 'account_switch_authentication',
  });

  return NextResponse.json(options);
}
