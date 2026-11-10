import 'server-only';
import { createPublicKey } from 'crypto';
import { lstatSync, readFileSync } from 'fs';
import path from 'path';
import { z } from 'zod';
import { issueStartedReleaseTicket, parseReleasePrivateKey } from '@/lib/fixerrors/release';
import type { FixerrorsJob } from '@/lib/fixerrors/protocol';
import { inspectReleaseFixture, releaseFixturePaths } from '@/scripts/automation/fixerrors-signed-release';
import { isFixerrorsLocalEnabled } from './config';

const fixtureIssuerSchema = z.object({
  version: z.literal(1), fixtureOnly: z.literal(true), gitExe: z.string(),
  keyId: z.string(), privateKeyPem: z.string().max(1024),
  repairKeyId: z.string(), repairPublicKeyPem: z.string().max(1024),
}).strict();

// No key is read unless the owner explicitly supplies a disposable fixture root.
// This is not enrollment and cannot enable the production companion.
export function issueLocalFixtureRelease(job: Readonly<FixerrorsJob>, now: number): string | undefined {
  const root = process.env.SQUIRES_FIXERRORS_SIGNED_RELEASE_FIXTURE_ROOT;
  if (!root) return undefined;
  if (!isFixerrorsLocalEnabled() || process.env.SQUIRES_FIXERRORS_SIGNED_RELEASE_FIXTURE_ENABLED !== '1') {
    throw new Error('Signed release fixture disabled');
  }
  // Validate location before reading any signing material.
  const scope = { root, gitExe: 'C:\\Program Files\\Git\\cmd\\git.exe' };
  releaseFixturePaths(scope);
  const file = path.join(root, 'issuer.json');
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Invalid fixture issuer file');
  const config = fixtureIssuerSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (config.gitExe !== scope.gitExe) throw new Error('Fixture Git must use the pinned executable');
  const actual = inspectReleaseFixture(scope);
  if (actual.head !== job.candidate?.head || actual.tree !== job.candidate.tree) {
    throw new Error('Fixture approval checkout changed');
  }
  return issueStartedReleaseTicket(job, now, {
    keyId: config.keyId, privateKey: parseReleasePrivateKey(config.privateKeyPem),
    repairKeyId: config.repairKeyId, repairPublicKey: createPublicKey(config.repairPublicKeyPem),
  });
}
