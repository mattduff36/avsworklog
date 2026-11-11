import 'server-only';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { issueStartedReleaseTicket, parseReleasePrivateKey } from '@/lib/fixerrors/release';
import { issueClaimedFixerrorsAdmission } from '@/lib/fixerrors/admission';
import { signBatchLease, type BatchCheckpoint } from '@/lib/fixerrors/batch';
import type { FixerrorsJob } from '@/lib/fixerrors/protocol';
import { isFixerrorsProductionEnabled } from './config';

function readPem(value: string | undefined): string {
  if (!value || value.length > 1536 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid Fixerrors issuer key');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('Invalid Fixerrors issuer key');
  return bytes.toString('utf8');
}

export function issueProductionRelease(job: Readonly<FixerrorsJob>, now: number): string {
  if (!isFixerrorsProductionEnabled() || job.deviceId !== process.env.SQUIRES_FIXERRORS_PRODUCTION_DEVICE_ID) {
    throw new Error('Production Fixerrors release is unavailable for this device');
  }

  return issueStartedReleaseTicket(job, now, {
    keyId: 'squires-release-v1',
    privateKey: parseReleasePrivateKey(readPem(process.env.SQUIRES_FIXERRORS_RELEASE_PRIVATE_KEY)),
    repairKeyId: 'squires-repair-v1',
    repairPublicKey: createPublicKey(readPem(process.env.SQUIRES_FIXERRORS_REPAIR_PUBLIC_KEY)),
  });
}

export function issueProductionAdmission(job: Readonly<FixerrorsJob>, now: number): string {
  if (!isFixerrorsProductionEnabled() || job.deviceId !== process.env.SQUIRES_FIXERRORS_PRODUCTION_DEVICE_ID) {
    throw new Error('Production Fixerrors admission is unavailable for this device');
  }

  return issueClaimedFixerrorsAdmission(job, now, {
    keyId: 'squires-repair-v1',
    privateKey: createPrivateKey(readPem(process.env.SQUIRES_FIXERRORS_REPAIR_PRIVATE_KEY)),
    releaseKeyId: 'squires-release-v1',
    releasePublicKey: createPublicKey(readPem(process.env.SQUIRES_FIXERRORS_RELEASE_PUBLIC_KEY)),
  });
}

export function issueProductionBatchLease(job: Readonly<FixerrorsJob>, checkpoint: BatchCheckpoint, now: number): string {
  if (!isFixerrorsProductionEnabled() || job.deviceId !== process.env.SQUIRES_FIXERRORS_PRODUCTION_DEVICE_ID ||
      !job.privateBatch || job.state !== 'leased' || !job.lease || job.lease.until <= now) {
    throw new Error('Production batch authority unavailable');
  }
  return signBatchLease({
    runId: job.id, deviceId: job.deviceId, manifestSha256: job.privateBatch.delivery.manifestSha256,
    checkpointSha256: checkpoint.checkpointSha256, sequence: job.privateBatch.sequence + 1, resume: checkpoint.resume,
  }, now, 'squires-repair-v1', createPrivateKey(readPem(process.env.SQUIRES_FIXERRORS_REPAIR_PRIVATE_KEY)));
}
