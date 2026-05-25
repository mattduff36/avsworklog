import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';
import { parseAccountSwitchDeviceId } from '@/lib/server/account-switch-device';
import { clearLegacyLockCookie, clearLegacySupabaseCookies } from '@/lib/server/app-auth/response';
import { setAppSessionCookieInResponse } from '@/lib/server/app-auth/cookies';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import {
  getCurrentAuthenticatedProfile,
  issueAppSession,
  revokeAppSession,
} from '@/lib/server/app-auth/session';
import { getWebAuthnRequestConfig } from '@/lib/server/webauthn/config';
import {
  consumeWebAuthnChallenge,
  getCredentialPublicKey,
  getWebAuthnCredentialByCredentialId,
  updateWebAuthnCredentialCounter,
} from '@/lib/server/webauthn/credentials';

export const runtime = 'nodejs';

interface BiometricVerifyBody {
  targetProfileId?: string;
  deviceId?: string;
  challenge?: string;
  response?: AuthenticationResponseJSON;
}

export async function POST(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile({ allowLocked: true });
  if (!current?.validation.session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BiometricVerifyBody;
    const targetProfileId = body.targetProfileId?.trim() || '';
    const deviceId = parseAccountSwitchDeviceId(body.deviceId);
    if (!targetProfileId || !deviceId || !body.challenge || !body.response) {
      return NextResponse.json(
        { error: 'targetProfileId, deviceId, challenge and response are required' },
        { status: 400 }
      );
    }

    const credential = await getWebAuthnCredentialByCredentialId(body.response.id);
    if (!credential || credential.profile_id !== targetProfileId) {
      return NextResponse.json({ error: 'Biometric credential was not recognised' }, { status: 401 });
    }

    const challenge = await consumeWebAuthnChallenge({
      challenge: body.challenge,
      challengeType: 'account_switch_authentication',
      profileId: targetProfileId,
    });
    if (challenge.device_id && credential.device_id !== challenge.device_id) {
      return NextResponse.json({ error: 'Biometric credential is not registered to this device' }, { status: 401 });
    }

    const config = await getWebAuthnRequestConfig();
    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.expectedOrigins,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: {
        id: credential.credential_id,
        publicKey: getCredentialPublicKey(credential),
        counter: credential.counter,
        transports: credential.transports || undefined,
      },
    });

    if (!verification.verified) {
      await createAccountSwitchAuditEvent({
        profileId: targetProfileId,
        actorProfileId: current.profile.id,
        eventType: 'biometric_unlock_failed',
      });
      return NextResponse.json({ error: 'Biometric unlock failed' }, { status: 401 });
    }

    await updateWebAuthnCredentialCounter({
      credentialId: credential.credential_id,
      counter: verification.authenticationInfo.newCounter,
    });

    const nextSession = await issueAppSession({
      profileId: targetProfileId,
      source: 'biometric_unlock',
      rememberMe: current.validation.session.remember_me,
      rawDeviceId: deviceId,
      actorProfileId: current.profile.id,
    });

    await revokeAppSession(current.validation.session.id, 'replaced_by_biometric_unlock', nextSession.row.id);

    const targetProfile = await getAppAuthProfile(targetProfileId, null);
    await createAccountSwitchAuditEvent({
      profileId: targetProfileId,
      actorProfileId: current.profile.id,
      eventType: 'biometric_unlock_success',
      metadata: {
        app_session_id: nextSession.row.id,
        credential_id: credential.credential_id,
      },
    });

    const response = NextResponse.json({
      success: true,
      profile: {
        profileId: targetProfile.id,
        fullName: targetProfile.full_name || null,
        avatarUrl: targetProfile.avatar_url || null,
        roleName: targetProfile.role?.name || null,
      },
    });

    clearLegacySupabaseCookies(request, response);
    clearLegacyLockCookie(response);
    setAppSessionCookieInResponse(response, nextSession.cookieValue, nextSession.cookieExpiresAt);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Biometric unlock failed' },
      { status: 500 }
    );
  }
}
