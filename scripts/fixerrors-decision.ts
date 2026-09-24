import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rejectSensitiveText } from './fixerrors-knowledge';
import { verifyErrorSnapshot } from './fixerrors-safety';

export const FIXERRORS_DECISION_VERSION = 1;

export const DECISION_ACTIONS = ['fix', 'report-only', 'manual-investigation'] as const;
export const DECISION_LANES = ['fast', 'standard', 'guarded', 'critical', 'report-only'] as const;
const REQUIRED_FORBIDDEN = ['suppress-logging', 'empty-success', 'weaken-authorization'] as const;
const CLUSTER_KEYS = [
  'id',
  'lane',
  'action',
  'evidencePaths',
  'files',
  'requiredTestIds',
  'forbiddenChanges',
  'rationale',
  'priorIncidentIds',
  'evidenceEnrichmentAttempted',
] as const;

export type DecisionAction = (typeof DECISION_ACTIONS)[number];
export type DecisionLane = (typeof DECISION_LANES)[number];

export interface DecisionCluster {
  id: string;
  lane: DecisionLane;
  action: DecisionAction;
  evidencePaths: string[];
  files: string[];
  requiredTestIds: string[];
  forbiddenChanges: string[];
  rationale: string;
  priorIncidentIds: string[];
  evidenceEnrichmentAttempted: boolean;
}

export interface FixerrorsDecision {
  schemaVersion: typeof FIXERRORS_DECISION_VERSION;
  snapshotId: string;
  analyst: string;
  baseHead: string;
  treeFingerprint: string;
  clusters: DecisionCluster[];
}

export interface CandidateFingerprint {
  baseHead: string;
  treeFingerprint: string;
}

export interface RetrievalBinding {
  snapshotId: string;
  baseHead: string;
  treeFingerprint: string;
  clusters: readonly { id: string }[];
}

export interface DecisionValidationInput {
  decision: unknown;
  snapshotId: string;
  snapshotChecksum: string;
  retrieval: RetrievalBinding;
  candidate: CandidateFingerprint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertSafePath(value: string, field: string): void {
  if (
    !value ||
    value.includes('..') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith('docs_private/')
  ) {
    throw new Error(`${field} contains an unsafe path`);
  }
}

function assertStringList(value: unknown, field: string, paths: boolean): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) {
    throw new Error(`${field} must be a non-empty string list`);
  }
  for (const entry of value) {
    rejectSensitiveText(entry, field);
    if (paths) assertSafePath(entry, field);
  }
  return value;
}

function parseCluster(value: unknown): DecisionCluster {
  if (!isRecord(value)) throw new Error('Decision cluster must be an object');
  const keys = Object.keys(value);
  if (keys.length !== CLUSTER_KEYS.length || CLUSTER_KEYS.some((key) => !keys.includes(key))) {
    throw new Error('Decision cluster fields do not match the allowlist');
  }
  const cluster = value as unknown as DecisionCluster;
  if (!/^cluster-[1-9][0-9]*$/u.test(cluster.id)) throw new Error('Invalid cluster id');
  if (!DECISION_LANES.includes(cluster.lane)) throw new Error('Invalid decision lane');
  if (!DECISION_ACTIONS.includes(cluster.action)) throw new Error('Invalid decision action');
  cluster.evidencePaths = assertStringList(cluster.evidencePaths, 'evidencePaths', true);
  cluster.files = assertStringList(cluster.files, 'files', true);
  cluster.requiredTestIds = assertStringList(cluster.requiredTestIds, 'requiredTestIds', true);
  cluster.forbiddenChanges = assertStringList(cluster.forbiddenChanges, 'forbiddenChanges', false);
  if (typeof cluster.rationale !== 'string' || !cluster.rationale) throw new Error('Missing rationale');
  rejectSensitiveText(cluster.rationale, 'rationale');
  if (!Array.isArray(value.priorIncidentIds) || value.priorIncidentIds.some((entry) => typeof entry !== 'string')) {
    throw new Error('priorIncidentIds must be a string array');
  }
  cluster.priorIncidentIds = value.priorIncidentIds;
  for (const entry of cluster.priorIncidentIds) rejectSensitiveText(entry, 'priorIncidentIds');
  if (typeof cluster.evidenceEnrichmentAttempted !== 'boolean') {
    throw new Error('evidenceEnrichmentAttempted must be boolean');
  }
  if (cluster.action === 'fix') {
    if (cluster.files.length === 0 || cluster.requiredTestIds.length === 0) {
      throw new Error(`Fix cluster ${cluster.id} requires files and tests`);
    }
    for (const required of REQUIRED_FORBIDDEN) {
      if (!cluster.forbiddenChanges.includes(required)) {
        throw new Error(`Fix cluster ${cluster.id} lacks forbidden change ${required}`);
      }
    }
  }
  if (cluster.action === 'manual-investigation' && !cluster.evidenceEnrichmentAttempted) {
    throw new Error(`Cluster ${cluster.id} lacks evidence enrichment`);
  }
  return cluster;
}

export function parseDecision(value: unknown): FixerrorsDecision {
  if (!isRecord(value)) throw new Error('Decision must be an object');
  const allowed = ['schemaVersion', 'snapshotId', 'analyst', 'baseHead', 'treeFingerprint', 'clusters'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('Decision contains a non-allowlisted field');
  }
  if (value.schemaVersion !== FIXERRORS_DECISION_VERSION) throw new Error('Unsupported decision version');
  for (const field of ['snapshotId', 'analyst', 'baseHead', 'treeFingerprint'] as const) {
    if (typeof value[field] !== 'string' || !value[field]) throw new Error(`Invalid ${field}`);
    rejectSensitiveText(value[field], field);
  }
  if (!Array.isArray(value.clusters) || value.clusters.length === 0) {
    throw new Error('Decision requires every cluster');
  }
  return {
    schemaVersion: FIXERRORS_DECISION_VERSION,
    snapshotId: value.snapshotId as string,
    analyst: value.analyst as string,
    baseHead: value.baseHead as string,
    treeFingerprint: value.treeFingerprint as string,
    clusters: value.clusters.map(parseCluster),
  };
}

export function partitionFixClusters(decision: FixerrorsDecision): {
  automatic: DecisionCluster[];
  approvalRequired: DecisionCluster[];
} {
  const fixes = decision.clusters.filter((cluster) => cluster.action === 'fix');
  return {
    automatic: fixes.filter((cluster) => cluster.lane !== 'critical'),
    approvalRequired: fixes.filter((cluster) => cluster.lane === 'critical'),
  };
}

export function validateDecision(input: DecisionValidationInput): FixerrorsDecision {
  const decision = parseDecision(input.decision);
  rejectSensitiveText(JSON.stringify(decision), 'decision');
  if (!/^[a-f0-9]{64}$/u.test(input.snapshotChecksum)) throw new Error('Snapshot checksum mismatch');
  if (decision.snapshotId !== input.snapshotId || input.retrieval.snapshotId !== input.snapshotId) {
    throw new Error('Decision snapshot mismatch');
  }
  if (
    input.retrieval.baseHead !== input.candidate.baseHead ||
    input.retrieval.treeFingerprint !== input.candidate.treeFingerprint
  ) {
    throw new Error('Retrieval candidate mismatch');
  }
  if (decision.baseHead !== input.candidate.baseHead) throw new Error('Decision HEAD mismatch');
  if (decision.treeFingerprint !== input.candidate.treeFingerprint) {
    throw new Error('Decision tree fingerprint mismatch');
  }
  const clusterIds = input.retrieval.clusters.map((cluster) => cluster.id);
  const actual = decision.clusters.map((cluster) => cluster.id);
  if (actual.length !== clusterIds.length || actual.some((id, index) => id !== clusterIds[index])) {
    throw new Error('Decision cluster coverage mismatch');
  }
  return decision;
}

export function captureCandidateFingerprint(cwd = process.cwd()): CandidateFingerprint {
  const baseHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd, encoding: 'utf8' }).trim();
  const tracked = execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd,
    encoding: 'utf8',
  }).split('\0').filter(Boolean);
  const lines = [...new Set([...tracked, ...untracked])]
    .filter((filePath) => !filePath.startsWith('docs_private/'))
    .sort()
    .map((filePath) => {
    const absolute = path.join(cwd, filePath);
    if (!existsSync(absolute)) return `${filePath}:deleted`;
    return `${filePath}:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`;
  });
  return {
    baseHead,
    treeFingerprint: createHash('sha256').update(`${tree}\n${lines.join('\n')}`).digest('hex'),
  };
}

export function readDecisionFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const decisionPath = argument('decision') ?? 'docs_private/error-analysis-decision.json';
    const retrievalPath = argument('retrieval') ?? 'docs_private/error-analysis-retrieval.json';
    const snapshotPath = argument('snapshot') ?? 'docs_private/error-snapshot.json';
    const snapshot = verifyErrorSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')));
    const retrieval = JSON.parse(readFileSync(retrievalPath, 'utf8')) as RetrievalBinding;
    const decision = validateDecision({
      decision: readDecisionFile(decisionPath),
      snapshotId: snapshot.snapshotId,
      snapshotChecksum: snapshot.checksum,
      retrieval,
      candidate: captureCandidateFingerprint(),
    });
    const partitions = partitionFixClusters(decision);
    console.log(`Validated decision for snapshot ${decision.snapshotId}`);
    console.log(`Automatic fix clusters: ${partitions.automatic.map((cluster) => cluster.id).join(', ') || 'none'}`);
    console.log(
      `Approval required: ${partitions.approvalRequired.map((cluster) => cluster.id).join(', ') || 'none'}`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
