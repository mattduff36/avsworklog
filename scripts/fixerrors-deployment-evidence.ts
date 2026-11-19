import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { FIXERRORS_PRODUCTION_ORIGIN } from '../lib/fixerrors/protocol';
import { needsDeployedImprovement } from '../lib/fixerrors/triage';
import type { AutoRetrieval, AutoRunResult } from './fixerrors-auto';
import type { LifecycleReview } from './fixerrors-lifecycle';
import type { LifecycleBinding } from './fixerrors-lifecycle-run';

const identitySchema = z.object({
  commit_sha: z.string().regex(/^[a-f0-9]{40}$/u),
  deployment_id: z.string().regex(/^dpl_[A-Za-z0-9]{1,120}$/u),
}).strict();
type Identity = z.infer<typeof identitySchema>;
type Deployment = NonNullable<LifecycleReview['deploymentEvidence']>;

async function productionIdentity(): Promise<Identity> {
  const response = await fetch(`${FIXERRORS_PRODUCTION_ORIGIN}/api/daily-allocation/deployment-identity`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok || !response.body) throw new Error('Deployment identity unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw new Error('Invalid deployment identity');
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return identitySchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

// Read-only proof from the fixed production origin and local Git objects. Analyst
// text can name a change, but cannot assert that it has been deployed.
export async function verifyReviewedDeployments(input: {
  result: AutoRunResult; retrieval: AutoRetrieval; bindings: LifecycleBinding[];
}, dependencies: {
  identity?: () => Promise<Identity>;
  git?: (args: string[]) => string;
  now?: () => Date;
} = {}): Promise<Record<string, Deployment>> {
  const requests = input.result.clusters.flatMap(outcome => {
    const decision = input.result.decisions.find(entry => entry.id === outcome.id);
    const binding = input.bindings.find(entry => entry.clusterId === outcome.id);
    const retained = binding?.records.map(row => row.triage_local_commit) ?? [];
    if (retained.some(value => value !== null && value !== undefined && value !== '' &&
        (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)))) return [];
    const commits = [...new Set(retained
      .filter((value): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value)))];
    const change = decision?.resolution?.changeCommit ?? (commits.length === 1 ? commits[0] : undefined);
    return change && outcome.status !== 'verified-local' ? [{ outcome, decision, change, retainedCommits: commits }] : [];
  });
  if (!requests.length) return {};
  const git = dependencies.git ?? (args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  let identity: Identity;
  try { identity = identitySchema.parse(await (dependencies.identity ?? productionIdentity)()); }
  catch { return {}; }
  const deployments: Record<string, Deployment> = {};
  for (const { outcome, decision, change, retainedCommits } of requests) {
    try {
      git(['merge-base', '--is-ancestor', change, identity.commit_sha]);
      for (const retained of retainedCommits.filter(commit => commit !== change)) {
        git(['merge-base', '--is-ancestor', retained, identity.commit_sha]);
      }
      if (decision?.resolution?.changeCommit) {
        const sources = decision!.files.filter(file => !file.startsWith('tests/'));
        const captured = input.retrieval.clusters.find(cluster => cluster.id === outcome.id);
        if (!captured || !sources.some(file => [...captured.sourceFiles, ...captured.relatedSourceFiles ?? []].includes(file))) continue;
        if (!sources.length || !decision!.requiredTestIds.length || decision!.requiredTestIds.some(test =>
          !outcome.tests.some(passed => passed === test || passed === `${test}: passed`))) continue;
        // The tested files must be the deployed files, and the named commit must
        // actually change one of the reviewed sources, not merely be an ancestor.
        git(['diff', '--quiet', identity.commit_sha, '--', ...decision!.files, ...decision!.requiredTestIds]);
        const changed = git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', change, '--', ...sources]);
        if (!changed.split(/\r?\n/u).some(file => sources.includes(file))) continue;
      }
      deployments[outcome.id] = {
        deployedCommit: identity.commit_sha, deploymentId: identity.deployment_id,
        check: `Production identity includes reviewed change ${change}` +
          (needsDeployedImprovement(decision?.resolution) ? '; relevant tested source matches the deployed revision' : ''),
        result: 'passed', verifiedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      };
    } catch { /* Missing Git objects, changed source or non-ancestry retains the incident. */ }
  }
  return deployments;
}
