import { createHash } from 'crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type {
  WorkflowLegacyClosureDisposition,
  WorkflowLegacyClosureRecord,
  WorkflowLegacyReconciliationKind,
  WorkflowProtocolRecord,
} from './types';
import {
  CURRENT_HARDENING_WORKSTREAM_IDS,
  LIVE_LEGACY_RECONCILIATION_REGISTRY,
  TRUSTED_LEGACY_RELEASE_SHA,
  findLegacyRegistryEntry,
  type LegacyReconciliationRegistryEntry,
} from './legacy-reconciliation-registry';
import {
  WORKFLOW_PROTOCOL_VERSION,
  getProtocolRecordPath,
  isWorkflowProtocolRecord,
  readProtocolRecord,
} from './workflow-review-protocol';
import { extractPlanContractMarker } from './workflow-plan-contract';
import {
  getWorkflowPaths,
  loadWorkflowReviewStateStrict,
  withWorkflowLock,
} from './workflow-events';
import { assertProtocolGitBinding, readWorkflowGitBinding } from './workflow-git-binding';
import { inspectCommitAncestry, resolveExactCommitObject } from './workflow-v24-disposition';

const FORBIDDEN_RELEASE_REFS = new Set(['HEAD', '@', 'HEAD^{}', 'refs/heads/HEAD']);

export interface LegacyReconciliationRequest {
  repoRoot: string;
  workstreamId: string;
  kind: string;
  releasedRef?: string;
  childWorkstreamId?: string;
  reason?: string;
  dryRun?: boolean;
  registry?: readonly LegacyReconciliationRegistryEntry[];
  now?: () => Date;
}

export interface LegacyReconciliationResult {
  ok: boolean;
  exitCode: number;
  message: string;
  dryRun: boolean;
  wrote: boolean;
  record: WorkflowProtocolRecord | null;
  childRecord: WorkflowProtocolRecord | null;
  closure: WorkflowLegacyClosureRecord | null;
}

export function sha256Bytes(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function protocolFileSha256(repoRoot: string, workstreamId: string): string | null {
  const filePath = getProtocolRecordPath(repoRoot, workstreamId);
  if (!existsSync(filePath)) return null;
  return sha256Bytes(readFileSync(filePath));
}

export function getLegacyClosurePath(repoRoot: string, workstreamId: string): string {
  return path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    workstreamId,
    'legacy-closure.json'
  );
}

export function getLegacyReconciliationJournalPath(
  repoRoot: string,
  workstreamId: string
): string {
  return getLegacyClosurePath(repoRoot, workstreamId);
}

function nowIso(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString();
}

function fail(
  message: string,
  extras?: Partial<LegacyReconciliationResult>
): LegacyReconciliationResult {
  return {
    ok: false,
    exitCode: 1,
    message,
    dryRun: Boolean(extras?.dryRun),
    wrote: false,
    record: extras?.record ?? null,
    childRecord: extras?.childRecord ?? null,
    closure: extras?.closure ?? null,
  };
}

function succeed(
  message: string,
  extras: Partial<LegacyReconciliationResult> & { dryRun: boolean }
): LegacyReconciliationResult {
  return {
    ok: true,
    exitCode: 0,
    message,
    wrote: Boolean(extras.wrote),
    record: extras.record ?? null,
    childRecord: extras.childRecord ?? null,
    closure: extras.closure ?? null,
    dryRun: extras.dryRun,
  };
}

function runGit(repoRoot: string, args: string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim() || null;
}

function resolveCommit(repoRoot: string, value: string): string | null {
  const resolved = resolveExactCommitObject(repoRoot, value);
  return resolved.ok ? resolved.sha : null;
}

function requireAncestor(
  repoRoot: string,
  ancestor: string,
  descendant: string,
  failMessage: string
): string | null {
  if (!ancestor || !descendant) return failMessage;
  const inspection = inspectCommitAncestry(repoRoot, ancestor, descendant);
  if (inspection.status === 'error') return inspection.message;
  if (inspection.status === 'not_ancestor') return failMessage;
  return null;
}

function commitTouches(repoRoot: string, commit: string, relativePath: string): boolean {
  const output = runGit(repoRoot, ['show', '--name-only', '--format=', commit]);
  if (!output) return false;
  const normalized = relativePath.replace(/\\/gu, '/');
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\\/gu, '/'))
    .includes(normalized);
}

function sourceIds(record: Pick<WorkflowProtocolRecord, 'sourceWorkstreamIds'> | null): string[] {
  return record?.sourceWorkstreamIds ?? [];
}

export function registryFingerprint(entry: LegacyReconciliationRegistryEntry): string {
  return sha256Bytes(JSON.stringify(entry));
}

export function isRecognizedHistoricalTerminal(
  record: WorkflowProtocolRecord,
  registry: readonly LegacyReconciliationRegistryEntry[] = LIVE_LEGACY_RECONCILIATION_REGISTRY
): boolean {
  void record;
  void registry;
  // Old protocol-embedded audits are never a substitute for a separate closure file.
  return false;
}

function protocolGateKey(record: WorkflowProtocolRecord): string {
  return JSON.stringify({
    phase: record.phase,
    headCommit: record.headCommit,
    activeCheckpointId: record.activeCheckpointId,
    nextAction: record.nextAction,
    sourceWorkstreamIds: sourceIds(record),
    legacyReconciliation: record.legacyReconciliation ?? null,
  });
}

export function protocolDiskStateDiverges(
  disk: WorkflowProtocolRecord,
  fromState: WorkflowProtocolRecord
): boolean {
  return protocolGateKey(disk) !== protocolGateKey(fromState);
}

function listWorkstreamIds(repoRoot: string): string[] {
  const root = path.join(repoRoot, 'docs_private', 'automation', 'workstreams');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function historicalBlockerIds(record: WorkflowProtocolRecord): string[] {
  const fromAttempts = record.reviewAttempts.flatMap((attempt) => attempt.blockerIds ?? []);
  return [...new Set([...record.openBlockerIds, ...fromAttempts])];
}

export function hasMeaningfulExecutionEvidence(
  repoRoot: string,
  workstreamId: string
): boolean {
  const plansRoot = path.join(repoRoot, 'plans');
  if (existsSync(plansRoot)) {
    const stack = [plansRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.name.endsWith('.md')) continue;
        try {
          const text = readFileSync(full, 'utf8');
          if (!text.includes(workstreamId)) continue;
          const parsed = extractPlanContractMarker(text);
          if (parsed.status === 'present' && parsed.contract?.workstreamId === workstreamId) {
            return true;
          }
          if (new RegExp(`Workstream:\\s*\`${workstreamId}\``, 'u').test(text)) {
            return true;
          }
        } catch {
          // ignore unreadable plans
        }
      }
    }
  }
  const workstreamDir = path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    workstreamId
  );
  if (!existsSync(workstreamDir)) return false;
  return readdirSync(workstreamDir).some(
    (name) => name.startsWith('preflight-') || name.startsWith('fix-delta-')
  );
}

function validateCutoffRef(params: {
  repoRoot: string;
  releasedRef?: string;
  trustedReleaseSha: string;
}): { ok: true; commit: string; ref: string } | { ok: false; message: string } {
  const requested = params.releasedRef?.trim() || params.trustedReleaseSha;
  if (FORBIDDEN_RELEASE_REFS.has(requested) || requested === 'HEAD') {
    return { ok: false, message: 'released-ref must not be HEAD or a symbolic current-tip alias' };
  }
  if (requested !== params.trustedReleaseSha) {
    return {
      ok: false,
      message: `released-ref must be the exact trusted cutoff SHA ${params.trustedReleaseSha}`,
    };
  }
  const currentHead = readWorkflowGitBinding(params.repoRoot).headCommit;
  const resolved = resolveCommit(params.repoRoot, requested);
  if (!resolved) return { ok: false, message: `unable to resolve released-ref ${requested}` };
  if (resolved === currentHead && requested !== params.trustedReleaseSha) {
    return { ok: false, message: 'released-ref resolved to the current HEAD tip; refuse' };
  }
  const cutoff = resolveCommit(params.repoRoot, params.trustedReleaseSha);
  if (!cutoff) return { ok: false, message: 'trusted cutoff SHA did not resolve' };
  if (resolved !== cutoff) {
    return { ok: false, message: `released-ref must resolve to cutoff ${params.trustedReleaseSha}` };
  }
  return { ok: true, commit: resolved, ref: params.trustedReleaseSha };
}

function validateIdentityProof(params: {
  repoRoot: string;
  workstreamId: string;
  entry: LegacyReconciliationRegistryEntry;
}): string | null {
  const proof = params.entry.identityProof;
  const impl = proof.implementationCommit;
  const ancestorError = requireAncestor(
    params.repoRoot,
    impl,
    params.entry.trustedReleaseSha,
    `implementation ${impl} is not an ancestor of the historical cutoff`
  );
  if (ancestorError) return ancestorError;
  if (proof.kind === 'plan-in-commit') {
    const blob = runGit(params.repoRoot, ['show', `${impl}:${proof.planPath}`]);
    if (!blob) return `plan ${proof.planPath} is missing from ${impl}`;
    if (!commitTouches(params.repoRoot, impl, proof.planPath)) {
      return `plan ${proof.planPath} was not introduced by ${impl}`;
    }
    const parsed = extractPlanContractMarker(blob);
    const markerId =
      parsed.status === 'present'
        ? parsed.contract?.workstreamId
        : blob.match(/"workstreamId"\s*:\s*"([^"]+)"/u)?.[1];
    const headerMatch = blob.match(/Workstream:\s*`([^`]+)`/u)?.[1];
    if (markerId !== params.workstreamId && headerMatch !== params.workstreamId) {
      return `plan-in-commit workstreamId mismatch for ${params.workstreamId}`;
    }
    return null;
  }
  const manifestAbs = path.join(params.repoRoot, proof.manifestPath);
  if (!existsSync(manifestAbs)) return `identity manifest missing: ${proof.manifestPath}`;
  const digest = sha256Bytes(readFileSync(manifestAbs));
  if (digest !== proof.manifestSha256) {
    return 'identity manifest hash does not match the registry';
  }
  let parsed: { workstreamId?: string; changedFiles?: string[] };
  try {
    parsed = JSON.parse(readFileSync(manifestAbs, 'utf8')) as {
      workstreamId?: string;
      changedFiles?: string[];
    };
  } catch {
    return 'identity manifest is not valid JSON';
  }
  if (parsed.workstreamId !== params.workstreamId && parsed.workstreamId !== params.entry.childWorkstreamId) {
    return `identity manifest workstreamId ${parsed.workstreamId ?? 'missing'} does not match`;
  }
  const changed = new Set((parsed.changedFiles ?? []).map((file) => file.replace(/\\/gu, '/')));
  for (const file of proof.identityFiles) {
    if (!changed.has(file)) {
      return `identity file ${file} is not listed in the bound manifest`;
    }
    if (!commitTouches(params.repoRoot, impl, file)) {
      return `identity file ${file} was not touched by ${impl}`;
    }
  }
  return null;
}

export function validateSupersededEvidence(params: {
  repoRoot: string;
  implementationCommit: string;
  revertOrReplacementCommit: string;
  cutoffSha?: string;
}): string | null {
  const cutoff = params.cutoffSha ?? TRUSTED_LEGACY_RELEASE_SHA;
  const implementationError = requireAncestor(
    params.repoRoot,
    params.implementationCommit,
    cutoff,
    'superseded implementation is not in the historical cutoff'
  );
  if (implementationError) return implementationError;
  const proofError = requireAncestor(
    params.repoRoot,
    params.revertOrReplacementCommit,
    cutoff,
    'supersede proof commit is not an ancestor of the cutoff'
  );
  if (proofError) return proofError;
  const patch = runGit(params.repoRoot, [
    'log',
    '--format=%H %s',
    `${params.implementationCommit}..${params.revertOrReplacementCommit}`,
  ]);
  if (!patch) {
    return 'supersede requires a later revert or replacement commit with Git proof';
  }
  return null;
}

function validateEntrySnapshot(params: {
  record: WorkflowProtocolRecord;
  entry: LegacyReconciliationRegistryEntry;
  sha256: string;
}): string | null {
  if (params.sha256 !== params.entry.protocolPreimageSha256) {
    return `protocol preimage hash mismatch for ${params.entry.workstreamId}`;
  }
  if (params.record.phase !== params.entry.expectedPreviousPhase) {
    return `phase ${params.record.phase} does not match registry ${params.entry.expectedPreviousPhase}`;
  }
  if (params.record.nextAction !== params.entry.expectedNextAction) {
    return `nextAction ${params.record.nextAction} does not match registry`;
  }
  if (params.record.baseCommit !== params.entry.expectedBaseCommit) {
    return 'baseCommit does not match registry';
  }
  if ((params.record.headCommit ?? null) !== params.entry.expectedHeadCommit) {
    return 'headCommit does not match registry';
  }
  if ((params.record.activeCheckpointId ?? null) !== params.entry.expectedCheckpointId) {
    return 'activeCheckpointId does not match registry';
  }
  return null;
}

function uniqueOrphanCandidates(params: {
  repoRoot: string;
  parent: WorkflowProtocolRecord;
}): string[] {
  const parentId = params.parent.workstreamId;
  const expectedV2 = `${parentId}_v2`;
  const candidates = new Set<string>();
  for (const id of listWorkstreamIds(params.repoRoot)) {
    if (id === parentId) continue;
    const record = readProtocolRecord(params.repoRoot, id);
    if (!record) continue;
    const emptySources = sourceIds(record).length === 0;
    const sameCommits =
      record.baseCommit === params.parent.baseCommit &&
      record.headCommit === params.parent.headCommit;
    if (id === expectedV2) {
      candidates.add(id);
      continue;
    }
    if (emptySources && sameCommits && record.phase === 'finalised') {
      candidates.add(id);
    }
  }
  return [...candidates].sort();
}

function closureCanonical(closure: WorkflowLegacyClosureRecord): string {
  const { createdAt: _createdAt, ...rest } = closure;
  return JSON.stringify(rest);
}

export function inspectLegacyClosure(
  repoRoot: string,
  workstreamId: string
):
  | { status: 'missing' }
  | { status: 'malformed'; message: string }
  | { status: 'ok'; closure: WorkflowLegacyClosureRecord } {
  const filePath = getLegacyClosurePath(repoRoot, workstreamId);
  if (!existsSync(filePath)) return { status: 'missing' };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<WorkflowLegacyClosureRecord>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'malformed', message: 'legacy closure is not an object' };
    }
    if (parsed.schemaVersion !== '1' || parsed.workstreamId !== workstreamId) {
      return { status: 'malformed', message: 'legacy closure schema or workstreamId is invalid' };
    }
    if (
      !parsed.kind ||
      !parsed.disposition ||
      !parsed.registryId ||
      !parsed.registryFingerprint ||
      !parsed.observedSnapshot ||
      !parsed.identityAnchor ||
      typeof parsed.identityAnchor !== 'object' ||
      !parsed.releasedRef ||
      !parsed.releasedRefCommit ||
      !Array.isArray(parsed.evidenceCommits) ||
      !parsed.reason ||
      !parsed.command ||
      !parsed.protocolVersion ||
      !parsed.createdAt
    ) {
      return { status: 'malformed', message: 'legacy closure is missing required fields' };
    }
    return { status: 'ok', closure: parsed as WorkflowLegacyClosureRecord };
  } catch {
    return { status: 'malformed', message: 'legacy closure is unreadable or not JSON' };
  }
}

export function readLegacyClosure(
  repoRoot: string,
  workstreamId: string
): WorkflowLegacyClosureRecord | null {
  const inspected = inspectLegacyClosure(repoRoot, workstreamId);
  return inspected.status === 'ok' ? inspected.closure : null;
}

function writeJsonExclusive(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'wx');
    const expectedBytes = Buffer.byteLength(payload, 'utf8');
    const written = writeSync(fd, payload, undefined, 'utf8');
    if (written !== expectedBytes) {
      throw new Error('short write of legacy closure');
    }
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort close before residue cleanup.
      }
      try {
        unlinkSync(filePath);
      } catch {
        // Residue cleanup is best effort.
      }
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new Error('legacy closure already exists; refuse overwrite');
    }
    throw error;
  }
  closeSync(fd);
  fd = undefined;
  const onDisk = readFileSync(filePath);
  if (!onDisk.equals(Buffer.from(payload, 'utf8'))) {
    try {
      unlinkSync(filePath);
    } catch {
      // Residue cleanup is best effort.
    }
    throw new Error('legacy closure bytes do not match the intended payload');
  }
}

function buildIntendedClosure(params: {
  record: WorkflowProtocolRecord;
  entry: LegacyReconciliationRegistryEntry;
  releasedRef: string;
  releasedCommit: string;
  preimageSha256: string;
  childWorkstreamId?: string;
  reason: string;
  now?: () => Date;
}): WorkflowLegacyClosureRecord {
  const disposition: WorkflowLegacyClosureDisposition =
    params.entry.kind === 'reconstruct-lineage' ? 'lineage-reconstructed' : 'released';
  const proof = params.entry.identityProof;
  return {
    schemaVersion: '1',
    workstreamId: params.record.workstreamId,
    disposition,
    kind: params.entry.kind,
    registryId: params.entry.registryId,
    registryFingerprint: registryFingerprint(params.entry),
    observedSnapshot: {
      phase: params.record.phase,
      nextAction: params.record.nextAction,
      checkpointId: params.record.activeCheckpointId,
      sourceWorkstreamIds: params.record.sourceWorkstreamIds ?? null,
      baseCommit: params.record.baseCommit,
      headCommit: params.record.headCommit,
      protocolPreimageSha256: params.preimageSha256,
    },
    identityAnchor: {
      implementationCommit: proof.implementationCommit,
      proofKind: proof.kind,
      proofPath: proof.kind === 'plan-in-commit' ? proof.planPath : proof.manifestPath,
      proofWorkstreamId: params.record.workstreamId,
      manifestSha256: proof.kind === 'manifest-to-commit' ? proof.manifestSha256 : undefined,
      identityFiles: proof.kind === 'manifest-to-commit' ? [...proof.identityFiles] : undefined,
    },
    childWorkstreamId: params.childWorkstreamId,
    releasedRef: params.releasedRef,
    releasedRefCommit: params.releasedCommit,
    evidenceCommits: [
      proof.implementationCommit,
      params.record.baseCommit,
      params.record.headCommit ?? params.record.baseCommit,
    ],
    reason: params.reason,
    command: 'reconcile-legacy',
    protocolVersion: WORKFLOW_PROTOCOL_VERSION,
    createdAt: nowIso(params.now),
  };
}

function expectedDisposition(
  kind: WorkflowLegacyReconciliationKind
): WorkflowLegacyClosureDisposition {
  if (kind === 'reconstruct-lineage') return 'lineage-reconstructed';
  if (kind === 'superseded') return 'superseded';
  return 'released';
}

function sameStringList(left: string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = left ?? [];
  const b = [...(right ?? [])];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function expectedEvidenceCommits(
  record: WorkflowProtocolRecord,
  entry: LegacyReconciliationRegistryEntry
): string[] {
  return [
    entry.identityProof.implementationCommit,
    record.baseCommit,
    record.headCommit ?? record.baseCommit,
  ];
}

function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function readValidLegacyClosure(params: {
  repoRoot: string;
  protocol: WorkflowProtocolRecord;
  registry?: readonly LegacyReconciliationRegistryEntry[];
}): { ok: true; closure: WorkflowLegacyClosureRecord } | { ok: false; message: string } {
  const registry = params.registry ?? LIVE_LEGACY_RECONCILIATION_REGISTRY;
  const inspected = inspectLegacyClosure(params.repoRoot, params.protocol.workstreamId);
  if (inspected.status === 'missing') return { ok: false, message: 'legacy closure missing' };
  if (inspected.status === 'malformed') return { ok: false, message: inspected.message };
  const closure = inspected.closure;
  const entry = findLegacyRegistryEntry(registry, params.protocol.workstreamId, closure.kind);
  if (!entry || entry.registryId !== closure.registryId) {
    return { ok: false, message: 'legacy closure registryId is not live' };
  }
  if (registryFingerprint(entry) !== closure.registryFingerprint) {
    return { ok: false, message: 'legacy closure registry fingerprint mismatch' };
  }
  if (closure.command !== 'reconcile-legacy') {
    return { ok: false, message: 'legacy closure command is not reconcile-legacy' };
  }
  if (closure.protocolVersion !== WORKFLOW_PROTOCOL_VERSION) {
    return { ok: false, message: 'legacy closure protocolVersion mismatch' };
  }
  if (closure.kind === 'superseded' || closure.disposition === 'superseded') {
    return { ok: false, message: 'superseded closures are not live-recognized' };
  }
  if (entry.kind !== closure.kind || closure.disposition !== expectedDisposition(entry.kind)) {
    return { ok: false, message: 'legacy closure kind/disposition does not match registry' };
  }
  const preimage = protocolFileSha256(params.repoRoot, params.protocol.workstreamId);
  if (!preimage || preimage !== closure.observedSnapshot.protocolPreimageSha256) {
    return { ok: false, message: 'legacy closure protocol preimage no longer matches' };
  }
  const snapshotError = validateEntrySnapshot({
    record: params.protocol,
    entry,
    sha256: preimage,
  });
  if (snapshotError) {
    return { ok: false, message: snapshotError };
  }
  if (closure.observedSnapshot.protocolPreimageSha256 !== entry.protocolPreimageSha256) {
    return { ok: false, message: 'legacy closure snapshot preimage does not match registry' };
  }
  if (closure.observedSnapshot.phase !== entry.expectedPreviousPhase) {
    return { ok: false, message: 'legacy closure snapshot phase does not match registry' };
  }
  if (closure.observedSnapshot.nextAction !== entry.expectedNextAction) {
    return { ok: false, message: 'legacy closure snapshot nextAction does not match registry' };
  }
  if ((closure.observedSnapshot.checkpointId ?? null) !== entry.expectedCheckpointId) {
    return { ok: false, message: 'legacy closure snapshot checkpoint does not match registry' };
  }
  if (closure.observedSnapshot.baseCommit !== entry.expectedBaseCommit) {
    return { ok: false, message: 'legacy closure snapshot baseCommit does not match registry' };
  }
  if ((closure.observedSnapshot.headCommit ?? null) !== (entry.expectedHeadCommit ?? null)) {
    return { ok: false, message: 'legacy closure snapshot headCommit does not match registry' };
  }
  if (closure.observedSnapshot.phase !== params.protocol.phase) {
    return { ok: false, message: 'legacy closure snapshot phase no longer matches protocol' };
  }
  if (closure.observedSnapshot.nextAction !== params.protocol.nextAction) {
    return { ok: false, message: 'legacy closure snapshot nextAction no longer matches protocol' };
  }
  if ((closure.observedSnapshot.checkpointId ?? null) !== (params.protocol.activeCheckpointId ?? null)) {
    return { ok: false, message: 'legacy closure snapshot checkpoint no longer matches protocol' };
  }
  if (
    JSON.stringify(closure.observedSnapshot.sourceWorkstreamIds ?? null) !==
    JSON.stringify(params.protocol.sourceWorkstreamIds ?? null)
  ) {
    return { ok: false, message: 'legacy closure snapshot sources no longer match protocol' };
  }
  if (closure.observedSnapshot.baseCommit !== params.protocol.baseCommit) {
    return { ok: false, message: 'legacy closure snapshot baseCommit no longer matches protocol' };
  }
  if ((closure.observedSnapshot.headCommit ?? null) !== (params.protocol.headCommit ?? null)) {
    return { ok: false, message: 'legacy closure snapshot headCommit no longer matches protocol' };
  }
  const proof = entry.identityProof;
  const anchor = closure.identityAnchor;
  if (!anchor || typeof anchor !== 'object') {
    return { ok: false, message: 'legacy closure identityAnchor is missing' };
  }
  const expectedPath = proof.kind === 'plan-in-commit' ? proof.planPath : proof.manifestPath;
  if (
    anchor.implementationCommit !== proof.implementationCommit ||
    anchor.proofKind !== proof.kind ||
    anchor.proofPath !== expectedPath ||
    anchor.proofWorkstreamId !== params.protocol.workstreamId ||
    (proof.kind === 'manifest-to-commit' &&
      (anchor.manifestSha256 !== proof.manifestSha256 ||
        !sameStringList(anchor.identityFiles, proof.identityFiles)))
  ) {
    return { ok: false, message: 'legacy closure identity anchor does not match registry' };
  }
  const identity = validateIdentityProof({
    repoRoot: params.repoRoot,
    workstreamId: params.protocol.workstreamId,
    entry,
  });
  if (identity) return { ok: false, message: identity };
  if (
    closure.releasedRefCommit !== entry.trustedReleaseSha ||
    closure.releasedRef !== entry.trustedReleaseSha
  ) {
    return { ok: false, message: 'legacy closure cutoff mismatch' };
  }
  if (!sameStringList(closure.evidenceCommits, expectedEvidenceCommits(params.protocol, entry))) {
    return { ok: false, message: 'legacy closure evidenceCommits do not match registry identity' };
  }
  if (closure.reason !== entry.reason) {
    return { ok: false, message: 'legacy closure reason does not match registry' };
  }
  if (!isIsoTimestamp(closure.createdAt)) {
    return { ok: false, message: 'legacy closure createdAt is not a valid ISO timestamp' };
  }
  if (entry.kind === 'reconstruct-lineage') {
    if (!entry.childWorkstreamId || closure.childWorkstreamId !== entry.childWorkstreamId) {
      return { ok: false, message: 'legacy closure childWorkstreamId does not match registry' };
    }
    const child = readProtocolRecord(params.repoRoot, entry.childWorkstreamId);
    if (!child) return { ok: false, message: 'registered child is missing during closure validation' };
    if (child.phase !== entry.childExpectedPhase) {
      return { ok: false, message: 'registered child phase no longer matches registry' };
    }
    const childSha = protocolFileSha256(params.repoRoot, entry.childWorkstreamId);
    if (!childSha || childSha !== entry.childProtocolPreimageSha256) {
      return { ok: false, message: 'registered child preimage no longer matches registry' };
    }
    const orphan =
      entry.childExpectedSourceWorkstreamIds == null ||
      entry.childExpectedSourceWorkstreamIds.length === 0;
    if (orphan && sourceIds(child).length > 0) {
      return { ok: false, message: 'orphan reconstruction child now has sourceWorkstreamIds' };
    }
    if (!orphan && sourceIds(child)[0] !== params.protocol.workstreamId) {
      return { ok: false, message: 'reconstructed child no longer points at the parent' };
    }
    if (orphan) {
      const candidates = uniqueOrphanCandidates({
        repoRoot: params.repoRoot,
        parent: params.protocol,
      });
      if (candidates.length !== 1 || candidates[0] !== entry.childWorkstreamId) {
        return { ok: false, message: 'orphan reconstruction is no longer a unique child candidate' };
      }
      if (entry.expectedBlockerContinuity) {
        const parentBlockers = historicalBlockerIds(params.protocol);
        const childBlockers = historicalBlockerIds(child);
        const missing = entry.expectedBlockerContinuity.filter(
          (id) => !parentBlockers.includes(id) || !childBlockers.includes(id)
        );
        if (missing.length > 0) {
          return { ok: false, message: `orphan reconstruction lost blocker continuity ${missing.join(', ')}` };
        }
      }
    }
  } else if (closure.childWorkstreamId) {
    return { ok: false, message: 'released closure must not name a reconstructed child' };
  }
  return { ok: true, closure };
}

function evaluateClosure(params: {
  repoRoot: string;
  workstreamId: string;
  kind: WorkflowLegacyReconciliationKind;
  releasedRef?: string;
  childWorkstreamId?: string;
  reason?: string;
  registry: readonly LegacyReconciliationRegistryEntry[];
  now?: () => Date;
}):
  | {
      ok: true;
      record: WorkflowProtocolRecord;
      child: WorkflowProtocolRecord | null;
      closure: WorkflowLegacyClosureRecord;
    }
  | { ok: false; message: string; record: WorkflowProtocolRecord | null } {
  if ((CURRENT_HARDENING_WORKSTREAM_IDS as readonly string[]).includes(params.workstreamId)) {
    return { ok: false, message: 'current hardening workstreams cannot use legacy reconciliation', record: null };
  }
  const entry = findLegacyRegistryEntry(params.registry, params.workstreamId, params.kind);
  if (!entry) {
    return {
      ok: false,
      message: `workstream ${params.workstreamId} is not registered for ${params.kind}`,
      record: null,
    };
  }
  if (entry.kind === 'superseded') {
    return { ok: false, message: 'live superseded registry rows are disabled', record: null };
  }
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current || !isWorkflowProtocolRecord(current)) {
    return { ok: false, message: 'protocol record missing or malformed', record: current };
  }
  const preimage = protocolFileSha256(params.repoRoot, params.workstreamId);
  if (!preimage) return { ok: false, message: 'unable to hash protocol preimage', record: current };

  const git = assertProtocolGitBinding({
    repoRoot: params.repoRoot,
    protocol: current,
    requireBranchMatch: false,
  });
  if (!git.ok) return { ok: false, message: git.message, record: current };

  const released = validateCutoffRef({
    repoRoot: params.repoRoot,
    releasedRef: params.releasedRef,
    trustedReleaseSha: entry.trustedReleaseSha,
  });
  if (!released.ok) return { ok: false, message: released.message, record: current };
  const suppliedReason = params.reason?.trim();
  if (suppliedReason && suppliedReason !== entry.reason) {
    return { ok: false, message: 'reason must match the registry reason', record: current };
  }

  const paths = getWorkflowPaths(params.repoRoot);
  const loadedState = loadWorkflowReviewStateStrict(paths.statePath);
  if (!loadedState.ok) {
    return { ok: false, message: `workflow review state is ${loadedState.reason}`, record: current };
  }
  const active = loadedState.state.activeFinaliseContext;
  if (active && (active.workstreamId === current.workstreamId || active.workstreamId === entry.childWorkstreamId)) {
    return {
      ok: false,
      message: `refuse reconciliation while ${active.workstreamId} owns activeFinaliseContext`,
      record: current,
    };
  }

  const snapshotError = validateEntrySnapshot({ record: current, entry, sha256: preimage });
  if (snapshotError) return { ok: false, message: snapshotError, record: current };

  const identityError = validateIdentityProof({
    repoRoot: params.repoRoot,
    workstreamId: current.workstreamId,
    entry,
  });
  if (identityError) return { ok: false, message: identityError, record: current };

  let child: WorkflowProtocolRecord | null = null;
  let childId: string | undefined;
  if (params.kind === 'released') {
    if (current.phase !== 'review_closed' && current.phase !== 'finalise_ready' && current.phase !== 'initialized') {
      return { ok: false, message: `released reconciliation cannot start from phase ${current.phase}`, record: current };
    }
  } else {
    const orphanReconstruct =
      entry.childExpectedSourceWorkstreamIds == null ||
      entry.childExpectedSourceWorkstreamIds.length === 0;
    if (orphanReconstruct && !params.childWorkstreamId?.trim()) {
      return {
        ok: false,
        message: 'orphan reconstruction requires explicit --child-workstream; refuse to infer the child',
        record: current,
      };
    }
    childId = params.childWorkstreamId?.trim() || entry.childWorkstreamId;
    if (!childId || childId !== entry.childWorkstreamId) {
      return {
        ok: false,
        message: `reconstruct-lineage requires registered child ${entry.childWorkstreamId ?? 'missing'}`,
        record: current,
      };
    }
    child = readProtocolRecord(params.repoRoot, childId);
    if (!child) return { ok: false, message: `registered child ${childId} is missing`, record: current };
    if (child.phase !== entry.childExpectedPhase) {
      return { ok: false, message: `child phase ${child.phase} does not match registry`, record: current };
    }
    const childSha = protocolFileSha256(params.repoRoot, childId);
    if (!childSha || childSha !== entry.childProtocolPreimageSha256) {
      return { ok: false, message: 'child protocol preimage hash mismatch', record: current };
    }
    if (orphanReconstruct) {
      const candidates = uniqueOrphanCandidates({ repoRoot: params.repoRoot, parent: current });
      if (candidates.length !== 1 || candidates[0] !== childId) {
        return {
          ok: false,
          message: `orphan reconstruction is ambiguous; candidates=${candidates.join(',') || 'none'}`,
          record: current,
        };
      }
      if (entry.expectedBlockerContinuity) {
        const parentBlockers = historicalBlockerIds(current);
        const childBlockers = historicalBlockerIds(child);
        const missing = entry.expectedBlockerContinuity.filter(
          (id) => !parentBlockers.includes(id) || !childBlockers.includes(id)
        );
        if (missing.length > 0) {
          return {
            ok: false,
            message: `orphan reconstruction missing blocker continuity ${missing.join(', ')}`,
            record: current,
          };
        }
      }
    }
  }

  return {
    ok: true,
    record: current,
    child,
    closure: buildIntendedClosure({
      record: current,
      entry,
      releasedRef: entry.trustedReleaseSha,
      releasedCommit: released.commit,
      preimageSha256: preimage,
      childWorkstreamId: childId,
      reason: entry.reason,
      now: params.now,
    }),
  };
}

export function persistLegacyClosure(params: {
  repoRoot: string;
  workstreamId: string;
  intended: WorkflowLegacyClosureRecord;
  protocolBefore: Buffer;
  stateBefore: Buffer | null;
  registry?: readonly LegacyReconciliationRegistryEntry[];
}): void {
  const recheck = resolveCommit(params.repoRoot, params.intended.releasedRefCommit);
  if (recheck !== params.intended.releasedRefCommit) {
    throw new Error('trusted cutoff SHA moved during reconciliation; abort');
  }
  const filePath = getLegacyClosurePath(params.repoRoot, params.workstreamId);
  let created = false;
  try {
    writeJsonExclusive(filePath, params.intended);
    created = true;
    const written = inspectLegacyClosure(params.repoRoot, params.workstreamId);
    if (written.status !== 'ok') {
      throw new Error(`written legacy closure is invalid: ${written.status === 'malformed' ? written.message : 'missing'}`);
    }
    if (
      closureCanonical(written.closure) !== closureCanonical(params.intended) ||
      written.closure.createdAt !== params.intended.createdAt
    ) {
      throw new Error('written legacy closure does not match the intended record');
    }
    const protocolAfter = readFileSync(getProtocolRecordPath(params.repoRoot, params.workstreamId));
    if (!protocolAfter.equals(params.protocolBefore)) {
      throw new Error('protocol bytes changed during closure write');
    }
    const statePath = getWorkflowPaths(params.repoRoot).statePath;
    const stateAfter = existsSync(statePath) ? readFileSync(statePath) : null;
    if (
      Boolean(stateAfter) !== Boolean(params.stateBefore) ||
      (stateAfter && params.stateBefore && !stateAfter.equals(params.stateBefore))
    ) {
      throw new Error('workflow state bytes changed during closure write');
    }
    const protocol = readProtocolRecord(params.repoRoot, params.workstreamId);
    if (!protocol) {
      throw new Error('protocol record missing after closure write');
    }
    const valid = readValidLegacyClosure({
      repoRoot: params.repoRoot,
      protocol,
      registry: params.registry,
    });
    if (!valid.ok) {
      throw new Error(`written legacy closure failed read validation: ${valid.message}`);
    }
  } catch (error) {
    if (created && existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // Residue cleanup is best effort; the write still failed closed.
      }
    }
    throw error;
  }
}

function applyLocked(params: LegacyReconciliationRequest): LegacyReconciliationResult {
  const kind = params.kind.trim() as WorkflowLegacyReconciliationKind;
  const registry = params.registry ?? LIVE_LEGACY_RECONCILIATION_REGISTRY;
  const evaluated = evaluateClosure({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    kind,
    releasedRef: params.releasedRef,
    childWorkstreamId: params.childWorkstreamId,
    reason: params.reason,
    registry,
    now: params.now,
  });
  if (!evaluated.ok) return fail(evaluated.message, { record: evaluated.record });
  const inspected = inspectLegacyClosure(params.repoRoot, params.workstreamId);
  if (inspected.status === 'malformed') {
    return fail(`malformed legacy closure exists; refuse overwrite: ${inspected.message}`, {
      record: evaluated.record,
      childRecord: evaluated.child,
    });
  }
  if (inspected.status === 'ok') {
    if (closureCanonical(inspected.closure) === closureCanonical(evaluated.closure)) {
      return succeed('legacy closure already applied', {
        dryRun: false,
        wrote: false,
        record: evaluated.record,
        childRecord: evaluated.child,
        closure: inspected.closure,
      });
    }
    return fail('conflicting legacy closure already exists; refuse overwrite', {
      record: evaluated.record,
      childRecord: evaluated.child,
      closure: inspected.closure,
    });
  }
  const protocolPath = getProtocolRecordPath(params.repoRoot, params.workstreamId);
  const protocolBefore = readFileSync(protocolPath);
  const statePath = getWorkflowPaths(params.repoRoot).statePath;
  const stateBefore = existsSync(statePath) ? readFileSync(statePath) : null;
  persistLegacyClosure({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    intended: evaluated.closure,
    protocolBefore,
    stateBefore,
    registry,
  });
  return succeed(`legacy closure recorded (${kind})`, {
    dryRun: false,
    wrote: true,
    record: readProtocolRecord(params.repoRoot, params.workstreamId),
    childRecord: evaluated.child,
    closure: readLegacyClosure(params.repoRoot, params.workstreamId),
  });
}

export function applyLegacyReconciliation(
  params: LegacyReconciliationRequest
): LegacyReconciliationResult {
  const kind = params.kind.trim();
  if (kind === 'superseded') {
    return fail(
      'generic superseded reconciliation is disabled; use the separate superseded validator with Git revert proof',
      { dryRun: Boolean(params.dryRun) }
    );
  }
  if (kind !== 'released' && kind !== 'reconstruct-lineage') {
    return fail('kind must be released or reconstruct-lineage', { dryRun: Boolean(params.dryRun) });
  }
  if (!params.workstreamId.trim()) {
    return fail('workstreamId required', { dryRun: Boolean(params.dryRun) });
  }

  const registry = params.registry ?? LIVE_LEGACY_RECONCILIATION_REGISTRY;
  if (params.dryRun) {
    const evaluated = evaluateClosure({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      kind,
      releasedRef: params.releasedRef,
      childWorkstreamId: params.childWorkstreamId,
      reason: params.reason,
      registry,
      now: params.now,
    });
    if (!evaluated.ok) {
      return fail(evaluated.message, { dryRun: true, record: evaluated.record });
    }
    return succeed(`dry-run: would record ${kind} closure for ${params.workstreamId}`, {
      dryRun: true,
      wrote: false,
      record: evaluated.record,
      childRecord: evaluated.child,
      closure: evaluated.closure,
    });
  }

  const paths = getWorkflowPaths(params.repoRoot);
  return withWorkflowLock(paths.lockPath, () => applyLocked(params));
}
