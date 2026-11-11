import { lstatSync, readFileSync, readSync, realpathSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { assertAutomaticPath, assertAutomaticFixerrorsRepair, parseAutomaticFixerrorsRetrieval, runAutomaticFixerrors,
  type AutoAdapters, type AutoRunResult, type WorkerRequest, type WorkerResult } from '../fixerrors-auto';
import { captureCandidateFingerprint, parseDecision, validateDecision, type CandidateFingerprint } from '../fixerrors-decision';
import { FIXERRORS_WORKSPACE } from './fixerrors-device-admission';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const batchManifestSchema = z.object({
  schemaVersion: z.literal(1), snapshotChecksum: digest, retrieval: z.unknown(),
}).strict();

export function parseBatchManifest(input: unknown) {
  const manifest = batchManifestSchema.parse(input);
  return { ...manifest, retrieval: parseAutomaticFixerrorsRetrieval(manifest.retrieval) };
}

export function verifyBatchContributions(input: unknown): void {
  const value = z.object({
    manifest: z.unknown(),
    contributions: z.array(z.object({ decision: z.unknown(), candidate: z.object({
      baseHead: z.string().regex(/^[a-f0-9]{40}$/u), treeFingerprint: digest,
    }).strict() }).strict()).nonempty(),
    outcome: z.object({
      runId: z.string(), candidate: z.unknown(), decisions: z.array(z.unknown()),
      clusters: z.array(z.object({
        id: z.string(), status: z.enum(['verified-local', 'held', 'report-only', 'failed']),
        reusedFrom: z.string().optional(),
      }).passthrough()),
    }).strict(),
  }).strict().parse(input);
  const manifest = parseBatchManifest(value.manifest);
  const expected = value.outcome.clusters.filter(cluster => cluster.status === 'verified-local' && !cluster.reusedFrom);
  if (value.outcome.clusters.length !== manifest.retrieval.clusters.length ||
      value.outcome.clusters.some((cluster, index) => cluster.id !== manifest.retrieval.clusters[index].id) ||
      expected.length !== value.contributions.length) throw new Error('Incomplete batch contributions');
  const decisions = parseDecision({
    schemaVersion: 1, snapshotId: manifest.retrieval.snapshotId, analyst: 'MPDEE Worker',
    baseHead: manifest.retrieval.baseHead, treeFingerprint: manifest.retrieval.treeFingerprint,
    clusters: value.outcome.decisions,
  }).clusters;
  if (new Set(decisions.map(decision => decision.id)).size !== decisions.length ||
      decisions.some(decision => !value.outcome.clusters.some(cluster => cluster.id === decision.id))) {
    throw new Error('Batch outcome decision coverage changed');
  }
  const used = new Set<string>();
  value.contributions.forEach((contribution, index) => {
    const evidence = manifest.retrieval.clusters.find(cluster => cluster.id === expected[index].id)!;
    const decision = validateDecision({
      decision: contribution.decision, snapshotId: manifest.retrieval.snapshotId,
      snapshotChecksum: manifest.snapshotChecksum, candidate: contribution.candidate,
      retrieval: { ...manifest.retrieval, ...contribution.candidate, clusters: [evidence] },
    }).clusters[0];
    if (!isDeepStrictEqual(decision, decisions.find(entry => entry.id === decision.id))) {
      throw new Error('Batch outcome decision changed');
    }
    assertAutomaticFixerrorsRepair(decision, evidence, used);
    decision.files.forEach(name => used.add(name));
  });
}

export function assertNativeBatchScope(cwd: string, names: string[]): void {
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length) throw new Error('Case-alias scope');
  for (const name of names) {
    assertAutomaticPath(name);
    if (!/^(?:app|components|lib|hooks|tests\/unit)\//u.test(name)) throw new Error('Native repair path unsupported');
    const file = path.resolve(cwd, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file) !== file || stat.size > 1024 * 1024) {
      throw new Error('Repair requires bounded ordinary existing files');
    }
    execFileSync('git', ['ls-files', '--error-unmatch', '--', name], { cwd, stdio: 'ignore', timeout: 10_000 });
    if (execFileSync('git', ['status', '--porcelain=v1', '--', name], { cwd, encoding: 'utf8', timeout: 10_000 })) {
      throw new Error('Independent repair target is not clean');
    }
    if (/\b(?:service_role|createAdminClient|require[A-Za-z]*Access|SUPABASE|POSTGRES|SECURITY DEFINER|BEGIN|COMMIT|FOR UPDATE)\b/u
      .test(readFileSync(file, 'utf8'))) throw new Error('Sensitive source requires owner approval');
  }
}

export interface NativeBatchTransport {
  call(method: string, value: unknown): unknown;
}

// This adapter cannot launch a CLI worker. Its only dispatch is the authenticated
// native host, which owns budget guards, leases, snapshots and genuine receipts.
export function nativeBatchAdapters(cwd: string, native: NativeBatchTransport): AutoAdapters {
  const call = <T>(method: string, value: unknown): T => native.call(method, value) as T;
  return {
    candidate: () => captureCandidateFingerprint(cwd),
    assertUnchanged(before: CandidateFingerprint) {
      call('unchanged', before);
      const actual = captureCandidateFingerprint(cwd);
      if (actual.baseHead !== before.baseHead || actual.treeFingerprint !== before.treeFingerprint) throw new Error('Batch candidate drift');
    },
    assertRepairScope(names) { assertNativeBatchScope(cwd, names); call('scope', names); },
    repairChecks: (tests, paths) => call<WorkerRequest['checks']>('checks', { tests, paths }),
    dispatch: async request => call<WorkerResult>('dispatch', request),
    verifyRepair: (request, result, before) => { call('verify', { request, result, before }); },
    write: (file, value) => { call('write', { file, value }); },
    learn: () => {}, // Lifecycle/knowledge application belongs to the server's exact-row binding.
    checkpoint: result => { call('checkpoint', result); },
  };
}

export async function executeNativeBatch(input: {
  manifest: unknown; mode: 'review' | 'repair'; runId: string; resume?: AutoRunResult;
}, native: NativeBatchTransport, cwd = FIXERRORS_WORKSPACE) {
  const manifest = parseBatchManifest(input.manifest);
  if (input.resume?.decisions.length) parseDecision({
    schemaVersion: 1, snapshotId: manifest.retrieval.snapshotId, analyst: 'MPDEE Worker',
    ...input.resume.candidate, clusters: input.resume.decisions,
  });
  return runAutomaticFixerrors({
    retrieval: manifest.retrieval, snapshotChecksum: manifest.snapshotChecksum, mode: input.mode,
    runId: input.runId, resume: input.resume, cwd, adapters: nativeBatchAdapters(cwd, native),
  });
}

export function nativeBatchLineReader(fd = 0): () => unknown {
  let buffered = Buffer.alloc(0);
  const chunk = Buffer.alloc(64 * 1024);
  return () => {
    for (;;) {
      const end = buffered.indexOf(10);
      if (end >= 0) {
        if (end > 16 * 1024 * 1024) throw new Error('Batch RPC frame exceeds limit');
        const value: unknown = JSON.parse(buffered.subarray(0, end).toString('utf8'));
        buffered = buffered.subarray(end + 1);
        return value;
      }
      if (buffered.length > 16 * 1024 * 1024) throw new Error('Batch RPC frame exceeds limit');
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) throw new Error('Native batch host disconnected');
      buffered = Buffer.concat([buffered, chunk.subarray(0, count)]);
    }
  };
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--verify-contributions') {
    verifyBatchContributions(JSON.parse(readFileSync(0, 'utf8')));
    return;
  }
  if (process.argv.length !== 2 || realpathSync(process.cwd()) !== FIXERRORS_WORKSPACE) throw new Error('Fixed native batch host required');
  const line = nativeBatchLineReader();
  const input = z.object({
    manifest: z.unknown(), mode: z.enum(['review', 'repair']), runId: z.string().regex(/^fixerrors-[a-f0-9-]+$/u),
    resume: z.object({
      runId: z.string(), candidate: z.object({ baseHead: z.string(), treeFingerprint: digest }).strict(),
      clusters: z.array(z.object({
        id: z.string(), status: z.enum(['verified-local', 'held', 'report-only', 'failed']),
        reason: z.string(), attempt: z.string(), tests: z.array(z.string()), evidence: z.array(z.string()),
        reusedFrom: z.string().optional(),
      }).strict()),
      decisions: z.array(z.custom<AutoRunResult['decisions'][number]>(value => typeof value === 'object' && value !== null)),
    }).strict().nullable().optional().transform(value => value ?? undefined),
  }).strict().parse(line());
  let sequence = 0;
  const result = await executeNativeBatch(input, {
    call(method, value) {
      const id = ++sequence;
      writeSync(1, `${JSON.stringify({ id, method, value })}\n`);
      const response = z.object({ id: z.literal(id), ok: z.boolean(), value: z.unknown().optional() }).strict().parse(line());
      if (!response.ok) throw new Error('Native batch operation held; inspect private evidence');
      return response.value;
    },
  });
  writeSync(1, `${JSON.stringify({ result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Native batch stopped; retained checkpoint requires reconciliation'); process.exitCode = 2; });
}
