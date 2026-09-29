import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toBase64Url } from '@/lib/server/app-auth/jwt';
import {
  buildInventoryKioskAuthenticationCanonical,
  buildInventoryKioskRequestCanonical,
  inventoryKioskChallengeExpiryMatches,
  validateAndroidKeyAttestation,
  verifyInventoryKioskHardwareSignature,
} from '@/lib/server/inventory-kiosk-device-auth';

const deviceId = '11111111-1111-4111-8111-111111111111';
const challengeId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';

describe('Inventory kiosk hardware signatures', () => {
  const keyPair = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const publicKeySpki = keyPair.publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64');

  it('verifies the exact hardware-authentication challenge contract', () => {
    const canonical = buildInventoryKioskAuthenticationCanonical({
      deviceId,
      challengeId,
      challenge: 'x'.repeat(43),
      expiresAt: '2026-09-28T20:00:00.000Z',
    });
    expect(canonical).toBe([
      'AVS-YARD-KIOSK-AUTH-V1',
      deviceId,
      challengeId,
      'x'.repeat(43),
      '2026-09-28T20:00:00.000Z',
    ].join('\n'));
    const signature = toBase64Url(sign('sha256', Buffer.from(canonical), keyPair.privateKey));

    expect(verifyInventoryKioskHardwareSignature(
      publicKeySpki,
      canonical,
      signature,
    )).toBe(true);
    expect(verifyInventoryKioskHardwareSignature(
      publicKeySpki,
      `${canonical}\nmodified`,
      signature,
    )).toBe(false);
  });

  it('binds request proofs to method, path, body digest, timestamp and request id', () => {
    const body = JSON.stringify({ phase: 'mode' });
    const canonical = buildInventoryKioskRequestCanonical({
      deviceId,
      requestId,
      issuedAt: '1790619000000',
      method: 'POST',
      path: '/api/inventory/kiosk/heartbeat',
      bodySha256: createHash('sha256').update(body).digest('hex'),
    });
    const signature = toBase64Url(sign('sha256', Buffer.from(canonical), keyPair.privateKey));

    expect(verifyInventoryKioskHardwareSignature(
      publicKeySpki,
      canonical,
      signature,
    )).toBe(true);
    expect(verifyInventoryKioskHardwareSignature(
      publicKeySpki,
      canonical.replace('/heartbeat', '/submit'),
      signature,
    )).toBe(false);
    expect(verifyInventoryKioskHardwareSignature(
      publicKeySpki,
      canonical.replace('1790619000000', '1790619000001'),
      signature,
    )).toBe(false);
  });

  it('compares signed challenge expiry by instant across PostgreSQL timestamp formats', () => {
    expect(inventoryKioskChallengeExpiryMatches(
      '2026-09-29T01:20:00.000+00:00',
      '2026-09-29T01:20:00.000Z',
    )).toBe(true);
    expect(inventoryKioskChallengeExpiryMatches(
      '2026-09-29T01:20:00.001+00:00',
      '2026-09-29T01:20:00.000Z',
    )).toBe(false);
    expect(inventoryKioskChallengeExpiryMatches(
      'not-a-date',
      '2026-09-29T01:20:00.000Z',
    )).toBe(false);
  });

  it('does not rotate a kiosk session until after its hardware proof is verified', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'lib/server/inventory-kiosk-device-auth.ts'),
      'utf8',
    );
    const verifier = source.slice(
      source.indexOf('export async function verifyInventoryKioskRequestProof'),
    );
    const nonMutatingValidation = verifier.indexOf('refresh: false');
    const signatureVerification = verifier.indexOf(
      'verifyInventoryKioskHardwareSignature(',
    );
    const refreshedValidation = verifier.indexOf(
      'const refreshedValidation = await validateAppSession({ allowKioskDevice: true })',
      signatureVerification,
    );

    expect(nonMutatingValidation).toBeGreaterThan(-1);
    expect(signatureVerification).toBeGreaterThan(nonMutatingValidation);
    expect(refreshedValidation).toBeGreaterThan(signatureVerification);
  });

  it('normalizes malformed attestation certificates to a stable client error', async () => {
    await expect(validateAndroidKeyAttestation({
      publicKeySpki: Buffer.from('not-a-key').toString('base64'),
      certificateChain: [
        Buffer.from('not-a-certificate').toString('base64'),
        Buffer.from('also-not-a-certificate').toString('base64'),
      ],
      challenge: toBase64Url(Buffer.alloc(32, 7)),
    })).rejects.toMatchObject({
      status: 400,
      code: 'ANDROID_ATTESTATION_INVALID',
    });
  });
});
