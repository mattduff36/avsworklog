import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getWebAuthnRequestConfig } from '@/lib/server/webauthn/config';
import { saveWebAuthnChallenge } from '@/lib/server/webauthn/credentials';

export const runtime = 'nodejs';

export async function POST() {
  const config = await getWebAuthnRequestConfig();
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: [],
    userVerification: 'required',
  });

  await saveWebAuthnChallenge({
    challenge: options.challenge,
    challengeType: 'authentication',
  });

  return NextResponse.json(options);
}
