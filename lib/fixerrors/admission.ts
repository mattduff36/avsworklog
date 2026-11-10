import { createPublicKey, sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { FixerrorsJob } from './protocol';

export const FIXERRORS_COMPANION_PACKET_MAX_BYTES = 96 * 1024;

export const fixerrorsDeviceJobSchema = z.object({
  version: z.literal(1),
  audience: z.literal('squires-windows-fixerrors'),
  job: z.literal('fixerrors'),
  jobId: z.string().uuid(),
  deviceId: z.string().uuid(),
  environment: z.literal('squires-production'),
  authority: z.enum(['read-only', 'bounded-repair']),
  issuedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  head: z.string().regex(/^[a-f0-9]{40}$/u),
  tree: z.string().regex(/^[a-f0-9]{40}$/u),
  packetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type FixerrorsDeviceJob = z.infer<typeof fixerrorsDeviceJobSchema>;

export function encodeFixerrorsDeviceJob(input: FixerrorsDeviceJob): string {
  return Buffer.from(JSON.stringify(fixerrorsDeviceJobSchema.parse(input)), 'utf8').toString('base64url');
}

export function fixerrorsDeviceSigningBytes(keyId: string, payload: string): Buffer {
  z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u).parse(keyId);
  return Buffer.from(`squires-windows-fixerrors-v1\n${keyId}\n${payload}`, 'utf8');
}

export function issueClaimedFixerrorsAdmission(
  job: Readonly<FixerrorsJob>, nowMs: number, issuer: {
    keyId: string; privateKey: KeyObject; releaseKeyId: string; releasePublicKey: KeyObject;
  },
): string {
  const { privateKey, releasePublicKey } = issuer;
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519' ||
      releasePublicKey.type !== 'public' || releasePublicKey.asymmetricKeyType !== 'ed25519' ||
      issuer.keyId === issuer.releaseKeyId ||
      createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).equals(
        releasePublicKey.export({ type: 'spki', format: 'der' }))) {
    throw new Error('Separate Fixerrors repair and release issuers required');
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || job.action === 'deploy' ||
      job.state !== 'leased' || !job.lease || job.lease.until <= nowMs || job.expiresAt <= nowMs ||
      job.createdAt > nowMs || job.approval || job.parentRepairId || job.candidate || job.checks ||
      job.lease.deployStartedAt !== undefined || job.workspace.clean !== true) {
    throw new Error('Fixerrors admission requires a fresh claimed review or repair');
  }
  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = Math.min(issuedAt + 300, Math.floor(job.expiresAt / 1000));
  if (expiresAt <= issuedAt) throw new Error('Fixerrors admission already expired');
  const payload = encodeFixerrorsDeviceJob({
    version: 1, audience: 'squires-windows-fixerrors', job: 'fixerrors',
    jobId: job.id, deviceId: job.deviceId, environment: 'squires-production',
    authority: job.action === 'review' ? 'read-only' : 'bounded-repair',
    issuedAt, expiresAt, head: job.workspace.head, tree: job.workspace.tree,
    packetSha256: job.workspace.packetSha256,
  });
  return JSON.stringify({
    version: 1, keyId: issuer.keyId, payload,
    signature: sign(null, fixerrorsDeviceSigningBytes(issuer.keyId, payload), privateKey).toString('base64url'),
  });
}
