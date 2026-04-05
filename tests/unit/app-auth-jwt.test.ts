import { describe, expect, it } from 'vitest';
import { sha256Hex, signJwtHS256, toBase64Url, verifyJwtHS256 } from '@/lib/server/app-auth/jwt';

async function signMalformedToken(payload: string, secret: string): Promise<string> {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const encodedPayload = toBase64Url(payload);
  const signingInput = `${header}.${encodedPayload}`;
  const signatureKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', signatureKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

describe('app auth jwt helpers', () => {
  it('signs and verifies HS256 tokens', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signJwtHS256(
      {
        sub: 'user-1',
        exp,
      },
      'test-secret'
    );

    const payload = await verifyJwtHS256<{ sub: string; exp: number }>(token, 'test-secret');
    expect(payload).toEqual({
      sub: 'user-1',
      exp,
    });
  });

  it('rejects expired tokens', async () => {
    const token = await signJwtHS256(
      {
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) - 1,
      },
      'test-secret'
    );

    const payload = await verifyJwtHS256(token, 'test-secret');
    expect(payload).toBeNull();
  });

  it('returns null for malformed JSON payloads', async () => {
    const token = await signMalformedToken('not-json', 'test-secret');

    const payload = await verifyJwtHS256(token, 'test-secret');

    expect(payload).toBeNull();
  });

  it('hashes session secrets deterministically', async () => {
    const hash = await sha256Hex('session-secret');
    expect(hash).toHaveLength(64);
    expect(await sha256Hex('session-secret')).toBe(hash);
  });
});
