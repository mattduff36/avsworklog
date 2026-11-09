import { existsSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { validateDecision } from './fixerrors-decision';
import { rejectSensitiveDocument } from './fixerrors-knowledge';
import type { AutoAdapters, AutoRetrieval, AutoRunResult } from './fixerrors-auto';

const review = z.object({
  decision: z.unknown(),
  clusters: z.array(z.object({
    id: z.string(),
    status: z.enum(['verified-local', 'held', 'report-only', 'failed']),
    reason: z.string().min(1),
    attempt: z.string().min(1),
    tests: z.array(z.string()),
    evidence: z.array(z.string().min(1)).min(1),
  }).strict()),
}).strict();

export async function awaitChatFixerrorsReview(
  retrieval: AutoRetrieval, snapshotChecksum: string, adapters: AutoAdapters,
): Promise<AutoRunResult> {
  const runId = 'chat-' + retrieval.snapshotId;
  if (!retrieval.clusters.length) return { runId, candidate: adapters.candidate(), clusters: [], decisions: [] };
  const filename = 'docs_private/' + runId + '.review.json';
  console.log('Chat investigation ready. Write reviewed decisions and outcomes atomically to ' + filename);
  const deadline = Date.now() + 20 * 60_000;
  while (!existsSync(filename)) {
    if (Date.now() >= deadline) throw new Error('Chat review timed out. Use a Codex chat with local project access.');
    await setTimeout(1000);
  }
  const input = review.parse(JSON.parse(readFileSync(filename, 'utf8')));
  rejectSensitiveDocument(input.clusters, 'chat outcomes');
  const candidate = adapters.candidate();
  if (candidate.baseHead !== retrieval.baseHead) throw new Error('Chat review cannot change HEAD');
  const decision = validateDecision({
    decision: input.decision, snapshotId: retrieval.snapshotId, snapshotChecksum,
    retrieval: { ...retrieval, ...candidate }, candidate,
  });
  if (input.clusters.length !== decision.clusters.length ||
      new Set(input.clusters.map(item => item.id)).size !== decision.clusters.length) {
    throw new Error('Chat outcomes must cover each cluster exactly once');
  }
  const reviews = decision.clusters.map(entry => {
    const outcome = input.clusters.find(item => item.id === entry.id);
    if (!outcome || entry.disposition === 'fixed_live' ||
        (outcome.status === 'report-only') !== (entry.action === 'report-only') ||
        (outcome.status === 'verified-local' && (entry.action !== 'fix' || !outcome.tests.length))) {
      throw new Error('Chat outcome does not match the validated decision');
    }
    return { entry, outcome };
  });
  adapters.assertUnchanged(candidate);
  for (const { entry, outcome } of reviews) {
    adapters.learn(retrieval, entry, outcome.status === 'verified-local' ? 'fix_verified_local' :
      outcome.status === 'report-only' ? 'report_only' : outcome.status === 'failed' ? 'fix_failed' :
      'manual_evidence_gap', outcome.status === 'verified-local' ? entry.files : [], outcome.tests, outcome.reason);
  }
  adapters.assertUnchanged(candidate);
  const result = { runId, candidate, clusters: input.clusters, decisions: decision.clusters };
  adapters.write('fixerrors-auto-outcome.json', result);
  return result;
}
