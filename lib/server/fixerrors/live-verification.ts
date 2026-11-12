import 'server-only';
import { z } from 'zod';
import { FIXERRORS_PRODUCTION_ORIGIN } from '@/lib/fixerrors/protocol';
import { syntheticDisplayLabel } from '@/lib/utils/fixerrors-controlled-acceptance';
import { isFixerrorsProductionEnabled } from './config';

export const SYNTHETIC_REPAIR_SOURCE = 'lib/utils/fixerrors-controlled-acceptance.ts';
export const SYNTHETIC_REPAIR_TEST = 'tests/unit/fixerrors-controlled-acceptance.test.ts';
export const SYNTHETIC_LIVE_CHECK =
  'Synthetic label runtime: leading, trailing, whitespace-only, plain and empty inputs match exact expected labels';
export class LiveVerificationError extends Error {
  constructor(public readonly reason: 'deployment-identity-mismatch' | 'server-revision-mismatch' |
    'runtime-verification-failed' | 'unavailable') {
    super(reason);
  }
}

// The imported implementation must belong to the approved revision, not an old
// server instance that merely observed the new deployment at the public endpoint.
export async function verifySyntheticRepairLive(head: string) {
  if (!isFixerrorsProductionEnabled() || !/^[a-f0-9]{40}$/u.test(head) ||
      process.env.VERCEL_GIT_COMMIT_SHA !== head) {
    throw new LiveVerificationError('server-revision-mismatch');
  }
  const response = await fetch(`${FIXERRORS_PRODUCTION_ORIGIN}/api/daily-allocation/deployment-identity`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok || !response.body) throw new LiveVerificationError('unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw new LiveVerificationError('deployment-identity-mismatch');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new LiveVerificationError('deployment-identity-mismatch'); }
  const identity = z.object({
    commit_sha: z.literal(head), deployment_id: z.string().regex(/^dpl_[A-Za-z0-9]{1,120}$/u),
  }).strict().safeParse(body);
  if (!identity.success || identity.data.deployment_id !== process.env.VERCEL_DEPLOYMENT_ID) {
    throw new LiveVerificationError('deployment-identity-mismatch');
  }
  const cases = [
    [' \tfixture', 'fixture'], ['fixture\t ', 'fixture'], [' fixture ', 'fixture'],
    [' \t\n ', ''], ['fixture label', 'fixture label'], ['', ''],
  ];
  try {
    if (cases.some(([input, expected]) => syntheticDisplayLabel(input) !== expected)) {
      throw new LiveVerificationError('runtime-verification-failed');
    }
  } catch { throw new LiveVerificationError('runtime-verification-failed'); }
  return {
    deployedCommit: head, deploymentId: identity.data.deployment_id, check: SYNTHETIC_LIVE_CHECK,
    result: 'passed' as const, verifiedAt: new Date().toISOString(),
  };
}
