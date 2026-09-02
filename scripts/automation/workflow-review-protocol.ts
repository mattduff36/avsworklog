import { createHash, randomBytes } from 'crypto';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';
import type {
  WorkflowActiveFinaliseContext,
  WorkflowProtocolPhase,
  WorkflowProtocolRecord,
  WorkflowProtocolReviewAttempt,
  WorkflowProtocolReviewPass,
  WorkflowRehomeProvenance,
  WorkflowReviewState,
  WorkflowRouteDispositionTarget,
} from './types';
import { getCurrentTreeFingerprint, recomputeManifestProvenIds } from './workflow-evidence-manifest';
import { requiredTestIdsForBlocker } from './workflow-verification-ledger';
import {
  appendOwnedCommit,
  assertNamedBranchForInit,
  assertProtocolGitBinding,
  lastOwnedCommit,
  readWorkflowGitBinding,
} from './workflow-git-binding';
import {
  getWorkflowPaths,
  loadWorkflowReviewStateStrict,
  saveWorkflowReviewState,
  upsertWorkstreamRecord,
  withWorkflowLock,
  writeJsonAtomic,
} from './workflow-events';
import {
  extractPlanContractMarker,
  resolvePlanPath,
} from './workflow-plan-contract';
import {
  buildBoundRehomeProvenance,
  buildRouteDisposition,
  isApprovalValidReviewEvidence,
  lineageBudgetExhausted,
  lineageFailedPremiumReviewCount,
  lineageFirstConsumed,
  planRequiresBoundRehome,
  revalidateBoundRehomeProvenance,
} from './workflow-v24-disposition';

export function resolveProtocolPlanAbsolutePath(repoRoot: string, planPath: string): string {
  return path.isAbsolute(planPath) ? planPath : path.resolve(repoRoot, planPath);
}

export const WORKFLOW_PROTOCOL_VERSION = '1' as const;
export const WORKFLOW_ROUTING_REQUIRED_EXIT_CODE = 2;

export type WorkflowProtocolCommand =
  | 'init'
  | 'preflight-record'
  | 'review-start'
  | 'review-record'
  | 'fix-record'
  | 'split'
  | 'route'
  | 'rehome-bind'
  | 'finalise-start'
  | 'reconcile-legacy'
  | 'status';

export interface WorkflowProtocolTransitionResult {
  ok: boolean;
  exitCode: number;
  record: WorkflowProtocolRecord | null;
  message: string;
  reviewToken?: string;
  checkpointId?: string;
  splitWorkstreamId?: string;
  childRecord?: WorkflowProtocolRecord;
}

function nowIso(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString();
}

function createToken(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function createCheckpointId(workstreamId: string): string {
  const stamp = Date.now().toString(36);
  return `ckpt_${workstreamId}_${stamp}_${randomBytes(4).toString('hex')}`;
}

function runGit(repoRoot: string, args: string[]): string | null {
  // Lazy require to keep unit tests free of spawn unless needed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim() || null;
}

export function getProtocolDirectory(repoRoot: string, workstreamId: string): string {
  return path.join(repoRoot, 'docs_private', 'automation', 'workstreams', workstreamId);
}

export function getProtocolRecordPath(repoRoot: string, workstreamId: string): string {
  return path.join(getProtocolDirectory(repoRoot, workstreamId), 'protocol.json');
}

function expectedPlanRequiredTestIds(
  record: WorkflowProtocolRecord
): { ok: true; ids?: string[] } | { ok: false; message: string } {
  if (!record.planPath) return { ok: true };
  if (!existsSync(record.planPath)) {
    return { ok: false, message: `plan path is missing: ${record.planPath}` };
  }
  try {
    const parsed = extractPlanContractMarker(readFileSync(record.planPath, 'utf8'));
    if (parsed.status !== 'present' || !parsed.contract) {
      return {
        ok: false,
        message: `plan contract is ${parsed.status}: ${(parsed.errors ?? []).join('; ')}`,
      };
    }
    const ids = parsed.contract.requiredTests
      .map((test) => test.id)
      .filter((id) => !id.startsWith('WF-PAY-'));
    if (parsed.contract.risk === 'high' && ids.length === 0) {
      return { ok: false, message: 'high-risk plan requiredTests are empty' };
    }
    return { ok: true, ids };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'plan contract could not be read',
    };
  }
}

export function createEmptyProtocolRecord(params: {
  workstreamId: string;
  baseCommit: string;
  branchName?: string | null;
  headCommit?: string | null;
  planPath?: string | null;
  sourceWorkstreamIds?: string[];
  inheritedFailedReviewCount?: number;
  rehomeProvenance?: WorkflowRehomeProvenance | null;
  now?: () => Date;
}): WorkflowProtocolRecord {
  return {
    schemaVersion: WORKFLOW_PROTOCOL_VERSION,
    workstreamId: params.workstreamId,
    identityStatus: 'present',
    sourceWorkstreamIds: params.sourceWorkstreamIds,
    inheritedFailedReviewCount: params.inheritedFailedReviewCount ?? 0,
    branchName: params.branchName ?? null,
    baseCommit: params.baseCommit,
    headCommit: params.headCommit ?? null,
    phase: 'initialized',
    nextAction: 'run_preflight',
    failedPremiumReviewCount: params.inheritedFailedReviewCount ?? 0,
    activeReviewToken: null,
    activeReviewPass: null,
    reviewAttempts: [],
    blockerFamilies: [],
    openBlockerIds: [],
    evidenceManifestPath: null,
    fixDeltaManifestPath: null,
    activeCheckpointId: null,
    reviewedTreeFingerprint: null,
    planPath: params.planPath ?? null,
    updatedAt: nowIso(params.now),
    rehomeProvenance: params.rehomeProvenance ?? null,
    routeDisposition: null,
  };
}

export function isWorkflowProtocolRecord(value: unknown): value is WorkflowProtocolRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkflowProtocolRecord>;
  return (
    candidate.schemaVersion === '1' &&
    typeof candidate.workstreamId === 'string' &&
    candidate.identityStatus === 'present' &&
    typeof candidate.baseCommit === 'string' &&
    typeof candidate.phase === 'string' &&
    typeof candidate.failedPremiumReviewCount === 'number' &&
    Array.isArray(candidate.reviewAttempts)
  );
}

export function readProtocolRecord(
  repoRoot: string,
  workstreamId: string
): WorkflowProtocolRecord | null {
  const filePath = getProtocolRecordPath(repoRoot, workstreamId);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return isWorkflowProtocolRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeProtocolRecord(repoRoot: string, record: WorkflowProtocolRecord): string {
  const filePath = getProtocolRecordPath(repoRoot, record.workstreamId);
  writeJsonAtomic(filePath, record);
  return filePath;
}

export function lastReviewAttempt(
  record: WorkflowProtocolRecord
): WorkflowProtocolRecord['reviewAttempts'][number] | null {
  return record.reviewAttempts[record.reviewAttempts.length - 1] ?? null;
}

export function reviewAllowsFinaliseStart(record: WorkflowProtocolRecord): boolean {
  if (record.phase === 'reconciled' || record.phase === 'finalised') return false;
  if (
    record.phase === 'routing_required' ||
    record.phase === 'removed_from_release' ||
    record.phase === 'reverted' ||
    record.phase === 'superseded' ||
    record.phase === 'rehomed'
  ) {
    return false;
  }
  if (record.openBlockerIds.length > 0) return false;
  const last = lastReviewAttempt(record);
  if (!last) {
    return record.phase === 'review_closed' || record.phase === 'finalise_ready';
  }
  return isApprovalValidReviewEvidence(last, record);
}

function upsertProtocolInState(
  state: WorkflowReviewState,
  record: WorkflowProtocolRecord
): WorkflowReviewState {
  return {
    ...state,
    schemaVersion: '2',
    protocolRecords: {
      ...(state.protocolRecords ?? {}),
      [record.workstreamId]: record,
    },
  };
}

function setActiveFinaliseContext(
  state: WorkflowReviewState,
  context: WorkflowActiveFinaliseContext | null
): WorkflowReviewState {
  return {
    ...state,
    schemaVersion: '2',
    activeFinaliseContext: context,
  };
}

export function getActiveFinaliseContext(
  state: WorkflowReviewState
): WorkflowActiveFinaliseContext | null {
  return state.activeFinaliseContext ?? null;
}

export function assertFinaliseProductCommitAllowed(repoRoot: string): void {
  const paths = getWorkflowPaths(repoRoot);
  const loaded = loadWorkflowReviewStateStrict(paths.statePath);
  if (!loaded.ok) {
    throw new Error(`workflow review state is ${loaded.reason}; refuse product commit`);
  }
  const git = readWorkflowGitBinding(repoRoot);
  if (git.detached || !git.branchName) {
    throw new Error('finalise product commit requires a named branch');
  }
  const active = getActiveFinaliseContext(loaded.state);
  if (!active) {
    // Ordinary FAST/STANDARD finalise has no C9 activation chain.
    return;
  }
  if (!active.activatedHeadCommit) {
    throw new Error(
      'active finalise context is missing activatedHeadCommit; refuse product commit'
    );
  }
  const expected = lastOwnedCommit(active.ownedCommits, active.activatedHeadCommit);
  const protocol = readProtocolRecord(repoRoot, active.workstreamId);
  if (protocol?.branchName && protocol.branchName !== git.branchName) {
    throw new Error(
      `current branch ${git.branchName} does not match protocol branch ${protocol.branchName}; refuse to authorise a product commit on the wrong branch`
    );
  }
  if (!git.headCommit || !expected || git.headCommit !== expected) {
    throw new Error(
      `HEAD ${git.headCommit ?? 'unknown'} is not the activated/owned finalise SHA ${expected ?? 'missing'}; refuse to authorise a newer Git state`
    );
  }
}

export function recordFinaliseOwnedCommit(repoRoot: string): {
  ok: true;
  ownedCommits: string[];
} | { ok: false; message: string } {
  const paths = getWorkflowPaths(repoRoot);
  return withWorkflowLock(paths.lockPath, () => {
    const loaded = loadWorkflowReviewStateStrict(paths.statePath);
    if (!loaded.ok) {
      return { ok: false as const, message: `workflow review state is ${loaded.reason}` };
    }
    const state = loaded.state;
    const active = getActiveFinaliseContext(state);
    if (!active?.activatedHeadCommit) {
      return { ok: false as const, message: 'no active finalise context with activatedHeadCommit' };
    }
    const appended = appendOwnedCommit({
      repoRoot,
      ownedCommits: active.ownedCommits ?? [active.activatedHeadCommit],
      activatedHeadCommit: active.activatedHeadCommit,
    });
    if (!appended.ok) return appended;
    const next: WorkflowReviewState = {
      ...state,
      activeFinaliseContext: {
        ...active,
        ownedCommits: appended.ownedCommits,
      },
    };
    saveWorkflowReviewState(paths.statePath, next);
    const checkpointPath = path.join(
      repoRoot,
      'docs_private',
      'automation',
      'workstreams',
      active.workstreamId,
      'checkpoints',
      `${active.checkpointId}.json`
    );
    if (existsSync(checkpointPath)) {
      try {
        const parsed = JSON.parse(readFileSync(checkpointPath, 'utf8')) as Record<string, unknown>;
        writeJsonAtomic(checkpointPath, {
          ...parsed,
          ownedCommits: appended.ownedCommits,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        return {
          ok: false as const,
          message: `unable to sync owned commits onto checkpoint ${active.checkpointId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
    return { ok: true as const, ownedCommits: appended.ownedCommits };
  });
}

function validateEvidenceManifest(params: {
  repoRoot: string;
  workstreamId: string;
  manifestPath: string;
  requireKind: 'preflight' | 'fix-delta';
  expectedBaseCommit?: string | null;
  expectedRequiredTestIds?: string[];
}): { ok: boolean; message: string; absolutePath: string | null; contentHash?: string } {
  const absolutePath = path.isAbsolute(params.manifestPath)
    ? params.manifestPath
    : path.join(params.repoRoot, params.manifestPath);
  if (!existsSync(absolutePath)) {
    return { ok: false, message: `manifest missing: ${params.manifestPath}`, absolutePath: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
    if (parsed.schemaVersion !== '1') {
      return { ok: false, message: 'manifest schemaVersion must be 1', absolutePath };
    }
    if (parsed.workstreamId !== params.workstreamId) {
      return { ok: false, message: 'manifest workstreamId mismatch', absolutePath };
    }
    if (parsed.kind !== params.requireKind) {
      return {
        ok: false,
        message: `manifest kind must be ${params.requireKind}`,
        absolutePath,
      };
    }
    if (parsed.status !== 'passed') {
      return { ok: false, message: 'manifest status must be passed', absolutePath };
    }
    if (typeof parsed.contentHash !== 'string' || !parsed.contentHash) {
      return { ok: false, message: 'manifest contentHash missing', absolutePath };
    }
    if (typeof parsed.bodyHash !== 'string' || parsed.bodyHash !== parsed.contentHash) {
      return { ok: false, message: 'manifest contentHash must equal bodyHash', absolutePath };
    }
    const { contentHash: _contentHash, bodyHash: _bodyHash, ...body } = parsed;
    const recomputedBodyHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex')
      .slice(0, 32);
    if (recomputedBodyHash !== parsed.bodyHash) {
      return { ok: false, message: 'manifest bodyHash does not match canonical body', absolutePath };
    }
    if (typeof parsed.baseCommit !== 'string' || !parsed.baseCommit) {
      return { ok: false, message: 'manifest baseCommit missing', absolutePath };
    }
    if (params.expectedBaseCommit && parsed.baseCommit !== params.expectedBaseCommit) {
      return { ok: false, message: 'manifest baseCommit mismatch', absolutePath };
    }
    if (typeof parsed.headCommit !== 'string' || !parsed.headCommit) {
      return { ok: false, message: 'manifest headCommit missing', absolutePath };
    }
    if (typeof parsed.inputFingerprint !== 'string' || !parsed.inputFingerprint) {
      return { ok: false, message: 'manifest inputFingerprint missing', absolutePath };
    }
    if (typeof parsed.createdAt !== 'string' || !parsed.createdAt) {
      return { ok: false, message: 'manifest createdAt missing', absolutePath };
    }
    const createdMs = Date.parse(parsed.createdAt);
    if (!Number.isFinite(createdMs) || Date.now() - createdMs > 6 * 60 * 60 * 1000) {
      return { ok: false, message: 'manifest is stale (>6h) or has invalid createdAt', absolutePath };
    }
    const current = getCurrentTreeFingerprint(params.repoRoot);
    if (parsed.inputFingerprint !== current.inputFingerprint) {
      return { ok: false, message: 'manifest inputFingerprint is stale vs current tree', absolutePath };
    }
    if (parsed.headCommit !== current.headCommit) {
      return { ok: false, message: 'manifest headCommit is stale vs current HEAD', absolutePath };
    }
    if (params.requireKind === 'preflight') {
      const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
      if (commands.length === 0) {
        return { ok: false, message: 'preflight manifest requires executed commands', absolutePath };
      }
      const requiredTests = Array.isArray(parsed.requiredTests) ? parsed.requiredTests : [];
      const proven = recomputeManifestProvenIds({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
        parsed,
      });
      if (!proven.ok) {
        return { ok: false, message: proven.message, absolutePath };
      }
      const incomplete = requiredTests.filter((entry) => {
        if (!entry || typeof entry !== 'object') return true;
        const row = entry as Record<string, unknown>;
        if (typeof row.id !== 'string') return true;
        return !proven.executedIds.has(row.id);
      });
      if (requiredTests.length > 0 && incomplete.length > 0) {
        return {
          ok: false,
          message: 'preflight requiredTests must be proven by verification ledger or exact command',
          absolutePath,
        };
      }
      if (params.expectedRequiredTestIds && params.expectedRequiredTestIds.length > 0) {
        const missingPlanIds = params.expectedRequiredTestIds.filter(
          (id) => !proven.executedIds.has(id)
        );
        if (missingPlanIds.length > 0) {
          return {
            ok: false,
            message: `preflight missing proven plan requiredTests: ${missingPlanIds.join(', ')}`,
            absolutePath,
          };
        }
      }
    }
    if (params.requireKind === 'fix-delta') {
      const closed = Array.isArray(parsed.closedBlockerIds)
        ? parsed.closedBlockerIds.filter((id): id is string => typeof id === 'string')
        : [];
      if (closed.length === 0) {
        return { ok: false, message: 'fix-delta requires closedBlockerIds', absolutePath };
      }
      if (new Set(closed).size !== closed.length) {
        return { ok: false, message: 'fix-delta closedBlockerIds contains duplicates', absolutePath };
      }
      const proven = recomputeManifestProvenIds({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
        parsed,
      });
      if (!proven.ok) {
        return { ok: false, message: proven.message, absolutePath };
      }
      for (const blockerId of closed) {
        const expectedIds = requiredTestIdsForBlocker(blockerId);
        const missing = expectedIds.filter((id) => !proven.executedIds.has(id));
        if (missing.length > 0) {
          return {
            ok: false,
            message: `fix-delta blocker ${blockerId} lacks proven ledger tests: ${missing.join(', ')}`,
            absolutePath,
          };
        }
      }
    }
    return {
      ok: true,
      message: 'manifest accepted',
      absolutePath,
      contentHash: parsed.contentHash,
    };
  } catch (error) {
    return {
      ok: false,
      message: `manifest unreadable: ${error instanceof Error ? error.message : String(error)}`,
      absolutePath,
    };
  }
}

function fail(
  message: string,
  record: WorkflowProtocolRecord | null = null,
  exitCode = 1
): WorkflowProtocolTransitionResult {
  return { ok: false, exitCode, record, message };
}

function succeed(
  message: string,
  record: WorkflowProtocolRecord,
  extras?: Partial<WorkflowProtocolTransitionResult>
): WorkflowProtocolTransitionResult {
  return {
    ok: true,
    exitCode: 0,
    record,
    message,
    ...extras,
  };
}

export function reduceProtocolInit(params: {
  repoRoot: string;
  workstreamId?: string;
  planPath?: string;
  baseCommit?: string;
  sourceWorkstreamIds?: string[];
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  let workstreamId = params.workstreamId?.trim() || '';
  let sourceWorkstreamIds = params.sourceWorkstreamIds;
  let planPath = params.planPath ?? null;
  let inheritedFailedReviewCount = 0;
  let rehomeProvenance: WorkflowRehomeProvenance | null = null;

  if (params.planPath) {
    const resolved = resolvePlanPath({
      candidatePath: params.planPath,
      repoRoot: params.repoRoot,
    });
    if (resolved.status !== 'ok' || !resolved.absolutePath) {
      return fail(`invalid plan path: ${resolved.errors.join('; ') || 'unresolved'}`);
    }
    planPath = resolved.absolutePath;
    const raw = readFileSync(resolved.absolutePath, 'utf8');
    const parsed = extractPlanContractMarker(raw);
    if (parsed.status !== 'present' || !parsed.contract) {
      return fail(`plan contract ${parsed.status}: ${parsed.errors.join('; ')}`);
    }
    if (
      workstreamId &&
      parsed.contract.workstreamId &&
      workstreamId !== parsed.contract.workstreamId
    ) {
      return fail(
        `workstreamId mismatch: --workstream=${workstreamId} plan=${parsed.contract.workstreamId}`
      );
    }
    workstreamId = workstreamId || parsed.contract.workstreamId;
    sourceWorkstreamIds = sourceWorkstreamIds ?? parsed.contract.sourceWorkstreamIds;
    if (parsed.contract.rehomeProvenance) {
      rehomeProvenance = {
        ...parsed.contract.rehomeProvenance,
        status: 'declared',
        predecessorPassedReview: false,
        predecessorHeadIsAncestor: false,
      };
    }
    if (
      parsed.contract.risk === 'high' &&
      parsed.contract.reviewClosureProtocol &&
      parsed.contract.reviewClosureProtocol !== 'two-pass-v1'
    ) {
      return fail('unsupported reviewClosureProtocol');
    }
  }

  if (!workstreamId) {
    return fail('workstreamId is required from --workstream or a validated plan contract');
  }

  const existing = readProtocolRecord(params.repoRoot, workstreamId);
  if (existing && existing.phase !== 'initialized') {
    return fail(`protocol already exists in phase ${existing.phase}`, existing);
  }

  if (sourceWorkstreamIds?.length) {
    for (const sourceId of sourceWorkstreamIds) {
      const source = readProtocolRecord(params.repoRoot, sourceId);
      if (!source) {
        return fail(
          `source workstream ${sourceId} is missing; a new ID cannot mint a fresh review budget`
        );
      }
      inheritedFailedReviewCount = Math.max(
        inheritedFailedReviewCount,
        lineageFailedPremiumReviewCount(source)
      );
    }
  }

  const baseCommit =
    params.baseCommit?.trim() ||
    runGit(params.repoRoot, ['rev-parse', 'HEAD']) ||
    '';
  if (!/^[0-9a-f]{7,64}$/i.test(baseCommit)) {
    return fail('baseCommit must be an explicit git commit hash');
  }

  const git = assertNamedBranchForInit(params.repoRoot);
  if (!git.ok) return fail(git.message);

  const record = createEmptyProtocolRecord({
    workstreamId,
    baseCommit,
    branchName: git.binding.branchName,
    headCommit: git.binding.headCommit,
    planPath,
    sourceWorkstreamIds,
    inheritedFailedReviewCount,
    rehomeProvenance,
    now: params.now,
  });

  return succeed('protocol initialized', record);
}

export function reducePreflightRecord(params: {
  repoRoot: string;
  workstreamId: string;
  manifestPath: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (lineageBudgetExhausted(current) || lineageFirstConsumed(current) || current.phase === 'routing_required') {
    return fail(
      'preflight cannot reopen an exhausted or first-consumed CRITICAL lineage',
      current,
      WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
    );
  }
  if (current.phase !== 'initialized' && current.phase !== 'preflight_ready') {
    return fail(`preflight-record not allowed in phase ${current.phase}`, current);
  }
  if (planRequiresBoundRehome(current) && current.rehomeProvenance?.status !== 'bound') {
    return fail('rehome-bind required before preflight for a re-homed successor', current);
  }
  if (current.rehomeProvenance?.status === 'bound') {
    const rehome = revalidateBoundRehomeProvenance({
      repoRoot: params.repoRoot,
      provenance: current.rehomeProvenance,
    });
    if (!rehome.ok) return fail(rehome.message, current);
  }
  const planTests = expectedPlanRequiredTestIds(current);
  if (!planTests.ok) return fail(planTests.message, current);
  const expectedRequiredTestIds = planTests.ids;

  const validation = validateEvidenceManifest({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    manifestPath: params.manifestPath,
    requireKind: 'preflight',
    expectedBaseCommit: current.baseCommit,
    expectedRequiredTestIds,
  });
  if (!validation.ok || !validation.absolutePath) {
    return fail(validation.message, current);
  }

  const next: WorkflowProtocolRecord = {
    ...current,
    phase: 'preflight_ready',
    nextAction: 'review_start_first',
    evidenceManifestPath: path.relative(params.repoRoot, validation.absolutePath).replace(/\\/g, '/'),
    updatedAt: nowIso(params.now),
  };
  return succeed('preflight recorded', next);
}

export function reduceReviewStart(params: {
  repoRoot: string;
  workstreamId: string;
  pass: WorkflowProtocolReviewPass;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');

  const git = assertProtocolGitBinding({
    repoRoot: params.repoRoot,
    protocol: current,
  });
  if (!git.ok) return fail(git.message, current);

  if (current.phase === 'routing_required' || lineageBudgetExhausted(current)) {
    return fail(
      'routing_required: lineage premium review budget exhausted; route, isolate, remove, revert, or evidence-backed supersede. review-start rejected',
      current,
      WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
    );
  }

  const tree = getCurrentTreeFingerprint(params.repoRoot);

  if (params.pass === 'delta') {
    if (
      current.phase !== 'review_closed' &&
      current.phase !== 'finalise_ready' &&
      current.phase !== 'delta_review'
    ) {
      return fail(`delta review-start requires review_closed (have ${current.phase})`, current);
    }
    const token = createToken('rev_delta');
    const attempt: WorkflowProtocolReviewAttempt = {
      pass: 'delta',
      token,
      startedAt: nowIso(params.now),
      headCommit: git.binding.headCommit,
      treeFingerprint: tree.inputFingerprint,
    };
    const next: WorkflowProtocolRecord = {
      ...current,
      phase: 'delta_review',
      nextAction: 'review_record',
      activeReviewToken: token,
      activeReviewPass: 'delta',
      activeCheckpointId: null,
      reviewAttempts: [...current.reviewAttempts, attempt],
      updatedAt: nowIso(params.now),
    };
    return succeed('delta review token issued', next, { reviewToken: token });
  }

  if (params.pass === 'first') {
    if (lineageFirstConsumed(current)) {
      return fail(
        'first review already consumed in this CRITICAL lineage; split does not mint a new first',
        current,
        WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
      );
    }
    if (current.phase !== 'preflight_ready') {
      return fail(`first review-start requires preflight_ready (have ${current.phase})`, current);
    }
    if (!current.evidenceManifestPath) {
      return fail('first review requires a recorded preflight manifest', current);
    }
    const planTests = expectedPlanRequiredTestIds(current);
    if (!planTests.ok) return fail(planTests.message, current);
    const validation = validateEvidenceManifest({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: current.evidenceManifestPath,
      requireKind: 'preflight',
      expectedBaseCommit: current.baseCommit,
      expectedRequiredTestIds: planTests.ids,
    });
    if (!validation.ok) {
      return fail(`first review evidence is stale or invalid: ${validation.message}`, current);
    }
  } else {
    if (current.phase !== 'fix_recorded') {
      return fail(`closure review-start requires fix_recorded (have ${current.phase})`, current);
    }
    if (!current.fixDeltaManifestPath) {
      return fail('closure review requires a recorded fix-delta manifest', current);
    }
    if (lineageBudgetExhausted(current)) {
      return fail(
        'review budget exhausted; routing_required',
        current,
        WORKFLOW_ROUTING_REQUIRED_EXIT_CODE
      );
    }
    const validation = validateEvidenceManifest({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: current.fixDeltaManifestPath,
      requireKind: 'fix-delta',
      expectedBaseCommit: current.baseCommit,
    });
    if (!validation.ok) {
      return fail(`closure review evidence is stale or invalid: ${validation.message}`, current);
    }
  }

  const token = createToken(`rev_${params.pass}`);
  const attempt: WorkflowProtocolReviewAttempt = {
    pass: params.pass,
    token,
    startedAt: nowIso(params.now),
    headCommit: git.binding.headCommit,
    treeFingerprint: tree.inputFingerprint,
  };
  const next: WorkflowProtocolRecord = {
    ...current,
    phase: params.pass === 'first' ? 'first_review' : 'closure_review',
    nextAction: 'review_record',
    activeReviewToken: token,
    activeReviewPass: params.pass,
    reviewAttempts: [...current.reviewAttempts, attempt],
    updatedAt: nowIso(params.now),
  };
  return succeed(`${params.pass} review token issued`, next, { reviewToken: token });
}

export function reduceReviewRecord(params: {
  repoRoot: string;
  workstreamId: string;
  token: string;
  result: 'passed' | 'failed';
  blockerFamilies?: string[];
  blockerIds?: string[];
  siblingSurfaces?: string[];
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (
    current.phase !== 'first_review' &&
    current.phase !== 'closure_review' &&
    current.phase !== 'delta_review'
  ) {
    return fail(`review-record not allowed in phase ${current.phase}`, current);
  }
  const git = assertProtocolGitBinding({
    repoRoot: params.repoRoot,
    protocol: current,
  });
  if (!git.ok) return fail(git.message, current);
  if (!current.activeReviewToken || current.activeReviewToken !== params.token) {
    return fail('invalid or consumed review token', current);
  }
  if (!current.activeReviewPass) {
    return fail('active review pass missing', current);
  }
  const startedAttempt = current.reviewAttempts.find((attempt) => attempt.token === params.token);
  const startedHead = startedAttempt?.headCommit ?? null;
  const recordHead = git.binding.headCommit;
  if (startedHead && recordHead && startedHead !== recordHead) {
    return fail(
      `HEAD moved during review (started ${startedHead}, now ${recordHead}); re-run review-start. Do not rewrite review metadata to the current HEAD.`,
      current
    );
  }
  const currentTree = getCurrentTreeFingerprint(params.repoRoot).inputFingerprint;
  const startedTree = startedAttempt?.treeFingerprint ?? null;
  if (startedTree && startedTree !== currentTree) {
    return fail(
      'working tree fingerprint moved during review; re-run review-start. Do not rewrite review metadata to the current tree.',
      current
    );
  }

  const families = [...new Set((params.blockerFamilies ?? []).map((v) => v.trim()).filter(Boolean))];
  const blockers = [...new Set((params.blockerIds ?? []).map((v) => v.trim()).filter(Boolean))];
  const siblings = [...new Set((params.siblingSurfaces ?? []).map((v) => v.trim()).filter(Boolean))];

  if (params.result === 'failed') {
    if (families.length === 0 || blockers.length === 0 || siblings.length === 0) {
      return fail(
        'failed review-record requires blockerFamilies, blockerIds, and siblingSurfaces',
        current
      );
    }
  }

  const attempts = current.reviewAttempts.map((attempt) =>
    attempt.token === params.token
      ? {
          ...attempt,
          result: params.result,
          blockerFamilies: families,
          blockerIds: blockers,
          siblingSurfaces: siblings,
          recordedAt: nowIso(params.now),
        }
      : attempt
  );

  let failedCount = current.failedPremiumReviewCount;
  let phase: WorkflowProtocolPhase = current.phase;
  let nextAction = current.nextAction;
  let exitCode = 0;
  let message = `review ${params.result}`;

  if (params.result === 'passed') {
    if (current.activeReviewPass === 'closure' && current.openBlockerIds.length > 0) {
      return fail(
        `closure pass cannot pass while open blockers remain: ${current.openBlockerIds.join(', ')}`,
        current
      );
    }
    if (
      (current.activeReviewPass === 'closure' || current.activeReviewPass === 'delta') &&
      blockers.length > 0
    ) {
      return fail('closure pass=passed must not introduce open blockerIds', current);
    }
    phase = 'review_closed';
    nextAction = 'finalise_start';
    message = 'review closed';
  } else if (current.activeReviewPass === 'delta') {
    phase = 'review_closed';
    nextAction = 'review_start_delta';
    message = 'delta review failed; retry review-start --pass delta after addressing blockers';
  } else {
    failedCount += 1;
    if (failedCount >= 2) {
      phase = 'routing_required';
      nextAction = 'route_or_isolate';
      exitCode = WORKFLOW_ROUTING_REQUIRED_EXIT_CODE;
      message = 'second failed premium review; routing_required';
    } else {
      phase = 'fix_sweep_required';
      nextAction = 'consolidated_fix_record';
      message = 'first failed review; consolidated fix sweep required';
    }
  }

  const reviewedHead =
    params.result === 'passed' ? recordHead ?? runGit(params.repoRoot, ['rev-parse', 'HEAD']) : null;
  const next: WorkflowProtocolRecord = {
    ...current,
    phase,
    nextAction,
    failedPremiumReviewCount: failedCount,
    activeReviewToken: null,
    activeReviewPass: null,
    reviewAttempts: attempts,
    blockerFamilies: [...new Set([...current.blockerFamilies, ...families])],
    openBlockerIds: params.result === 'passed' ? [] : blockers,
    headCommit: reviewedHead ?? current.headCommit,
    reviewedTreeFingerprint:
      params.result === 'passed' ? currentTree : current.reviewedTreeFingerprint,
    updatedAt: nowIso(params.now),
  };

  return {
    ok: exitCode === 0,
    exitCode,
    record: next,
    message,
  };
}

export function reduceFixRecord(params: {
  repoRoot: string;
  workstreamId: string;
  manifestPath: string;
  closedBlockerIds?: string[];
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (current.phase !== 'fix_sweep_required') {
    return fail(`fix-record requires fix_sweep_required (have ${current.phase})`, current);
  }
  if (!params.closedBlockerIds || params.closedBlockerIds.length === 0) {
    return fail('fix-record requires explicit --closed-blocker-ids', current);
  }
  const validation = validateEvidenceManifest({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    manifestPath: params.manifestPath,
    requireKind: 'fix-delta',
    expectedBaseCommit: current.baseCommit,
  });
  if (!validation.ok || !validation.absolutePath) {
    return fail(validation.message, current);
  }

  const closed = new Set(params.closedBlockerIds.map((id) => id.trim()).filter(Boolean));
  const remaining = current.openBlockerIds.filter((id) => !closed.has(id));
  if (remaining.length > 0) {
    return fail(
      `fix-record incomplete; open blockers remain: ${remaining.join(', ')}`,
      current
    );
  }
  try {
    const manifest = JSON.parse(
      readFileSync(validation.absolutePath, 'utf8')
    ) as {
      closedBlockerIds?: string[];
      blockerEvidence?: Array<{ blockerId?: string }>;
    };
    const manifestClosed = new Set(manifest.closedBlockerIds ?? []);
    for (const id of closed) {
      if (!manifestClosed.has(id)) {
        return fail(`fix-record closed id ${id} missing from manifest closedBlockerIds`, current);
      }
      const hasEvidence = (manifest.blockerEvidence ?? []).some(
        (entry) => entry.blockerId === id
      );
      if (!hasEvidence) {
        return fail(`fix-record closed id ${id} missing blockerEvidence`, current);
      }
    }
  } catch (error) {
    return fail(
      `unable to bind fix evidence: ${error instanceof Error ? error.message : String(error)}`,
      current
    );
  }

  const next: WorkflowProtocolRecord = {
    ...current,
    phase: 'fix_recorded',
    nextAction: 'review_start_closure',
    fixDeltaManifestPath: path.relative(params.repoRoot, validation.absolutePath).replace(/\\/g, '/'),
    openBlockerIds: [],
    updatedAt: nowIso(params.now),
  };
  return succeed('fix delta recorded', next);
}

export function reduceSplit(params: {
  repoRoot: string;
  workstreamId: string;
  newWorkstreamId: string;
  narrowerPartition: boolean;
  hasFixDelta: boolean;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (current.phase !== 'routing_required' && current.phase !== 'fix_sweep_required') {
    return fail(`split not allowed in phase ${current.phase}`, current);
  }
  if (!params.newWorkstreamId.trim()) {
    return fail('newWorkstreamId required', current);
  }
  const childId = params.newWorkstreamId.trim();
  if (childId === current.workstreamId) {
    return fail('split child cannot be the parent', current);
  }
  if ((current.sourceWorkstreamIds ?? []).includes(childId)) {
    return fail('split would create a lineage cycle', current);
  }
  if (readProtocolRecord(params.repoRoot, childId)) {
    return fail('newWorkstreamId already exists', current);
  }
  if (listImmediateChildWorkstreamIds(params.repoRoot, current.workstreamId).length > 0) {
    return fail('split already has a continuation child', current);
  }

  const inheritBudget = lineageFailedPremiumReviewCount(current);
  void params.narrowerPartition;
  void params.hasFixDelta;

  const child = createEmptyProtocolRecord({
    workstreamId: childId,
    baseCommit: current.baseCommit,
    branchName: current.branchName,
    headCommit: current.headCommit,
    planPath: current.planPath,
    sourceWorkstreamIds: [current.workstreamId, ...(current.sourceWorkstreamIds ?? [])],
    inheritedFailedReviewCount: inheritBudget,
    now: params.now,
  });
  child.failedPremiumReviewCount = inheritBudget;
  child.blockerFamilies = [...current.blockerFamilies];
  child.openBlockerIds = [...current.openBlockerIds];
  child.fixDeltaManifestPath = current.fixDeltaManifestPath;
  if (inheritBudget >= 2) {
    child.phase = 'routing_required';
    child.nextAction = 'route_or_isolate';
  } else {
    // Split is only legal from fix_sweep_required | routing_required. After one
    // failed premium round the child keeps closure-only ownership; it does not
    // regain first. After two failed rounds every child is routing_required.
    child.phase = current.phase;
    child.nextAction =
      current.phase === 'routing_required' ? 'route_or_isolate' : 'consolidated_fix_record';
  }

  const parent: WorkflowProtocolRecord = {
    ...current,
    phase: 'split',
    nextAction: 'use_split_workstream',
    updatedAt: nowIso(params.now),
  };

  return {
    ok: true,
    exitCode: 0,
    record: parent,
    message: 'workstream split recorded',
    splitWorkstreamId: child.workstreamId,
    childRecord: child,
  };
}

export function reduceRoute(params: {
  repoRoot: string;
  workstreamId: string;
  disposition: WorkflowRouteDispositionTarget;
  reason: string;
  implementationCommits?: string[];
  revertCommit?: string;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorHead?: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  const built = buildRouteDisposition({
    repoRoot: params.repoRoot,
    record: current,
    target: params.disposition,
    reason: params.reason,
    implementationCommits: params.implementationCommits,
    revertCommit: params.revertCommit,
    supersedeCommit: params.supersedeCommit,
    successorRepo: params.successorRepo,
    successorBranch: params.successorBranch,
    successorBaseline: params.successorBaseline,
    predecessorHead: params.predecessorHead,
    nowIso: nowIso(params.now),
  });
  if (!built.ok) return fail(built.message, current);
  const next: WorkflowProtocolRecord = {
    ...current,
    phase: params.disposition,
    nextAction: 'non_release_disposition',
    activeReviewToken: null,
    activeReviewPass: null,
    activeCheckpointId: null,
    routeDisposition: built.disposition,
    failedPremiumReviewCount: current.failedPremiumReviewCount,
    inheritedFailedReviewCount: current.inheritedFailedReviewCount,
    reviewAttempts: current.reviewAttempts,
    headCommit: current.headCommit,
    reviewedTreeFingerprint: current.reviewedTreeFingerprint,
    updatedAt: nowIso(params.now),
  };
  return succeed(`route recorded as ${params.disposition}; not approval and not finalised`, next);
}

export function reduceRehomeBind(params: {
  repoRoot: string;
  workstreamId: string;
  predecessorRootWorkstreamId: string;
  predecessorDescendantWorkstreamId: string;
  predecessorHeadCommit: string;
  predecessorReleaseContext: string;
  successorBaselineCommit: string;
  successorBranchName: string;
  sourcePatchSha256: string;
  sourceProductTreeFingerprint: string;
  sourceReleaseContext: string;
  sourceHeadCommit: string;
  sourceBaselineCommit: string;
  sourceReviewWorkstreamId?: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  if (current.phase !== 'initialized') {
    return fail(`rehome-bind requires initialized (have ${current.phase})`, current);
  }
  if (!current.rehomeProvenance) {
    return fail('rehome-bind requires declared plan/protocol rehomeProvenance', current);
  }
  const bound = buildBoundRehomeProvenance({
    repoRoot: params.repoRoot,
    record: current,
    declared: current.rehomeProvenance,
    predecessorRootWorkstreamId: params.predecessorRootWorkstreamId,
    predecessorDescendantWorkstreamId: params.predecessorDescendantWorkstreamId,
    predecessorHeadCommit: params.predecessorHeadCommit,
    predecessorReleaseContext: params.predecessorReleaseContext,
    successorBaselineCommit: params.successorBaselineCommit,
    successorBranchName: params.successorBranchName,
    sourcePatchSha256: params.sourcePatchSha256,
    sourceProductTreeFingerprint: params.sourceProductTreeFingerprint,
    sourceReleaseContext: params.sourceReleaseContext,
    sourceHeadCommit: params.sourceHeadCommit,
    sourceBaselineCommit: params.sourceBaselineCommit,
    sourceReviewWorkstreamId: params.sourceReviewWorkstreamId,
    nowIso: nowIso(params.now),
  });
  if (!bound.ok) return fail(bound.message, current);
  const next: WorkflowProtocolRecord = {
    ...current,
    rehomeProvenance: bound.provenance,
    failedPremiumReviewCount: 0,
    inheritedFailedReviewCount: 0,
    updatedAt: nowIso(params.now),
  };
  return succeed('rehome provenance bound; predecessor is not claimed as passed', next);
}

export function reduceFinaliseStart(params: {
  repoRoot: string;
  workstreamId: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current) return fail('protocol record missing; run init first');
  const closurePath = path.join(
    params.repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    current.workstreamId,
    'legacy-closure.json'
  );
  if (existsSync(closurePath)) {
    return fail('historically closed workstream cannot finalise-start', current);
  }
  if (current.phase !== 'review_closed' && current.phase !== 'finalise_ready') {
    return fail(`finalise-start requires review_closed (have ${current.phase})`, current);
  }
  if (!reviewAllowsFinaliseStart(current)) {
    return fail(
      'finalise-start requires a successful review with no open blockers; if HEAD or the tree drifted, run review-start --pass delta and record a passing delta review first',
      current
    );
  }
  const tree = getCurrentTreeFingerprint(params.repoRoot);
  const git = assertProtocolGitBinding({
    repoRoot: params.repoRoot,
    protocol: current,
    expectedHeadCommit: current.headCommit,
    expectedTreeFingerprint: current.reviewedTreeFingerprint,
    currentTreeFingerprint: tree.inputFingerprint,
  });
  if (!git.ok) {
    if (/HEAD has moved/i.test(git.message) || /fingerprint moved/i.test(git.message)) {
      return fail(
        `${git.message} Run npx tsx scripts/workflow-protocol.ts review-start --workstream ${current.workstreamId} --pass delta to refresh the final-diff review. Do not rewrite review metadata to the current HEAD.`,
        current
      );
    }
    return fail(git.message, current);
  }
  if (!current.headCommit) {
    return fail('finalise-start requires a reviewed headCommit bound by a successful review', current);
  }
  const checkpointId =
    current.phase === 'finalise_ready' && current.activeCheckpointId
      ? current.activeCheckpointId
      : createCheckpointId(current.workstreamId);
  const next: WorkflowProtocolRecord = {
    ...current,
    phase: 'finalise_ready',
    nextAction: 'run_finalise',
    activeCheckpointId: checkpointId,
    updatedAt: nowIso(params.now),
  };
  return succeed('finalise context activated', next, { checkpointId });
}

function listImmediateChildWorkstreamIds(repoRoot: string, parentId: string): string[] {
  const root = path.join(repoRoot, 'docs_private', 'automation', 'workstreams');
  if (!existsSync(root)) return [];
  const ids: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = readProtocolRecord(repoRoot, entry.name);
    if (child?.sourceWorkstreamIds?.[0] === parentId) {
      ids.push(child.workstreamId);
    }
  }
  return ids;
}

/**
 * Safe finalise completion/failure transition. Does not invent review tokens.
 * Passed: phase -> finalised in memory. Disk persistence of `finalised` is deferred
 * until shared workflow state is saved.
 */
export function applyFinaliseProtocolOutcome(params: {
  repoRoot: string;
  state: WorkflowReviewState;
  workstreamId: string;
  outcome: 'passed' | 'failed' | 'unknown';
  now?: () => Date;
}): {
  state: WorkflowReviewState;
  record: WorkflowProtocolRecord | null;
} {
  const current = readProtocolRecord(params.repoRoot, params.workstreamId);
  if (!current || !isWorkflowProtocolRecord(current)) {
    return { state: params.state, record: null };
  }
  if (current.phase !== 'finalise_ready' && current.phase !== 'finalised') {
    return { state: params.state, record: current };
  }

  const updatedAt = nowIso(params.now);
  if (params.outcome !== 'passed') {
    const failedRecord: WorkflowProtocolRecord = {
      ...current,
      nextAction: 'rerun_or_repair_finalise',
      updatedAt,
    };
    return {
      state: upsertProtocolInState(params.state, failedRecord),
      record: failedRecord,
    };
  }

  const finalized: WorkflowProtocolRecord = {
    ...current,
    phase: 'finalised',
    nextAction: 'done',
    activeCheckpointId: null,
    updatedAt,
  };
  let nextState = upsertProtocolInState(params.state, finalized);
  if (nextState.activeFinaliseContext?.workstreamId === params.workstreamId) {
    nextState = setActiveFinaliseContext(nextState, null);
  }
  return { state: nextState, record: finalized };
}

/**
 * Persist shared workflow state first, then mark matched protocols finalised on disk.
 */
export function commitFinaliseCorrelationStateAndProtocols(params: {
  repoRoot: string;
  statePath: string;
  previousState: WorkflowReviewState;
  nextState: WorkflowReviewState;
  workstreamIds: string[];
}): void {
  const protocolBackups = new Map<string, WorkflowProtocolRecord | null>();
  for (const workstreamId of params.workstreamIds) {
    protocolBackups.set(workstreamId, readProtocolRecord(params.repoRoot, workstreamId));
  }

  const restore = (): void => {
    for (const [, previous] of protocolBackups) {
      if (previous) {
        writeProtocolRecord(params.repoRoot, previous);
      }
    }
    try {
      saveWorkflowReviewState(params.statePath, params.previousState);
    } catch {
      // Best-effort restore; original error is rethrown by caller.
    }
  };

  try {
    saveWorkflowReviewState(params.statePath, params.nextState);
    for (const workstreamId of params.workstreamIds) {
      const record = params.nextState.protocolRecords?.[workstreamId];
      if (record && isWorkflowProtocolRecord(record)) {
        writeProtocolRecord(params.repoRoot, record);
      }
    }
  } catch (error) {
    restore();
    throw error;
  }
}

function persistParentAndOptionalChildUnlocked(params: {
  repoRoot: string;
  parent: WorkflowProtocolRecord;
  child?: WorkflowProtocolRecord;
  activateFinalise?: boolean;
}): void {
  const paths = getWorkflowPaths(params.repoRoot);
  const previousParent = readProtocolRecord(params.repoRoot, params.parent.workstreamId);
  const previousChild = params.child
    ? readProtocolRecord(params.repoRoot, params.child.workstreamId)
    : null;
  const loadedState = loadWorkflowReviewStateStrict(paths.statePath);
  if (!loadedState.ok) {
    throw new Error(`workflow review state is ${loadedState.reason}; refuse protocol persist`);
  }
  const previousState = loadedState.state;
  const childWasNew = Boolean(params.child && !previousChild);
  try {
    writeProtocolRecord(params.repoRoot, params.parent);
    if (params.child) {
      writeProtocolRecord(params.repoRoot, params.child);
    }
    let state = previousState;
    state = upsertProtocolInState(state, params.parent);
    if (params.child) {
      state = upsertProtocolInState(state, params.child);
    }
    if (
      state.activeFinaliseContext?.workstreamId === params.parent.workstreamId &&
      params.parent.phase !== 'finalise_ready'
    ) {
      state = setActiveFinaliseContext(state, null);
    }
    state = upsertWorkstreamRecord(state, {
      workstreamId: params.parent.workstreamId,
      branchName: params.parent.branchName,
      headCommit: params.parent.headCommit,
      taskIds: [],
      eventIds: [],
      status: params.parent.phase === 'finalised' ? 'finalised' : 'open',
      sourceWorkstreamIds: params.parent.sourceWorkstreamIds,
      updatedAt: params.parent.updatedAt,
    });
    if (params.child) {
      const existingChild = previousState.workstreams?.[params.child.workstreamId];
      state = upsertWorkstreamRecord(state, {
        workstreamId: params.child.workstreamId,
        branchName: params.child.branchName,
        headCommit: params.child.headCommit,
        taskIds: [],
        eventIds: [],
        status:
          existingChild?.status ??
          (params.child.phase === 'finalised' ? 'finalised' : 'open'),
        sourceWorkstreamIds: params.child.sourceWorkstreamIds,
        updatedAt: params.child.updatedAt,
      });
    }
    if (params.activateFinalise && params.parent.activeCheckpointId) {
      const tree = getCurrentTreeFingerprint(params.repoRoot);
      const activatedHead = params.parent.headCommit;
      state = setActiveFinaliseContext(state, {
        workstreamId: params.parent.workstreamId,
        checkpointId: params.parent.activeCheckpointId,
        activatedAt: params.parent.updatedAt,
        activatedHeadCommit: activatedHead,
        activatedTreeFingerprint: params.parent.reviewedTreeFingerprint ?? tree.inputFingerprint,
        ownedCommits: activatedHead ? [activatedHead] : [],
      });
    }
    saveWorkflowReviewState(paths.statePath, state);
  } catch (error) {
    if (previousParent) {
      writeProtocolRecord(params.repoRoot, previousParent);
    }
    if (previousChild) {
      writeProtocolRecord(params.repoRoot, previousChild);
    } else if (params.child && childWasNew) {
      const childPath = getProtocolRecordPath(params.repoRoot, params.child.workstreamId);
      if (existsSync(childPath)) {
        unlinkSync(childPath);
      }
    }
    try {
      saveWorkflowReviewState(paths.statePath, previousState);
    } catch {
      // Best-effort restore; original error is rethrown.
    }
    throw error;
  }
}

function applyProtocolTransitionUnlocked(params: {
  repoRoot: string;
  command: WorkflowProtocolCommand;
  workstreamId?: string;
  planPath?: string;
  baseCommit?: string;
  manifestPath?: string;
  pass?: WorkflowProtocolReviewPass;
  token?: string;
  result?: 'passed' | 'failed';
  blockerFamilies?: string[];
  blockerIds?: string[];
  siblingSurfaces?: string[];
  closedBlockerIds?: string[];
  newWorkstreamId?: string;
  narrowerPartition?: boolean;
  hasFixDelta?: boolean;
  sourceWorkstreamIds?: string[];
  disposition?: WorkflowRouteDispositionTarget;
  reason?: string;
  implementationCommits?: string[];
  revertCommit?: string;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorRootWorkstreamId?: string;
  predecessorDescendantWorkstreamId?: string;
  predecessorHeadCommit?: string;
  predecessorReleaseContext?: string;
  successorBaselineCommit?: string;
  successorBranchName?: string;
  sourcePatchSha256?: string;
  sourceProductTreeFingerprint?: string;
  sourceReleaseContext?: string;
  sourceHeadCommit?: string;
  sourceBaselineCommit?: string;
  sourceReviewWorkstreamId?: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  if (params.command === 'status') {
    if (!params.workstreamId) return fail('workstreamId required for status');
    const record = readProtocolRecord(params.repoRoot, params.workstreamId);
    if (!record) return fail('protocol record missing');
    return succeed(`phase=${record.phase}`, record);
  }

  if (params.command === 'init') {
    const result = reduceProtocolInit({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      planPath: params.planPath,
      baseCommit: params.baseCommit,
      sourceWorkstreamIds: params.sourceWorkstreamIds,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (!params.workstreamId) {
    return fail('workstreamId required');
  }

  if (params.command === 'preflight-record') {
    if (!params.manifestPath) return fail('manifestPath required');
    const result = reducePreflightRecord({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: params.manifestPath,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'review-start') {
    if (params.pass !== 'first' && params.pass !== 'closure' && params.pass !== 'delta') {
      return fail('pass must be first|closure|delta');
    }
    const result = reduceReviewStart({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      pass: params.pass,
      now: params.now,
    });
    if (
      result.record &&
      (result.ok || result.exitCode === WORKFLOW_ROUTING_REQUIRED_EXIT_CODE)
    ) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'review-record') {
    if (!params.token) return fail('token required');
    if (params.result !== 'passed' && params.result !== 'failed') {
      return fail('result must be passed|failed');
    }
    const result = reduceReviewRecord({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      token: params.token,
      result: params.result,
      blockerFamilies: params.blockerFamilies,
      blockerIds: params.blockerIds,
      siblingSurfaces: params.siblingSurfaces,
      now: params.now,
    });
    if (
      result.record &&
      (result.ok || result.exitCode === WORKFLOW_ROUTING_REQUIRED_EXIT_CODE)
    ) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'fix-record') {
    if (!params.manifestPath) return fail('manifestPath required');
    const result = reduceFixRecord({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      manifestPath: params.manifestPath,
      closedBlockerIds: params.closedBlockerIds,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'split') {
    if (!params.newWorkstreamId) return fail('newWorkstreamId required');
    const result = reduceSplit({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      newWorkstreamId: params.newWorkstreamId,
      narrowerPartition: Boolean(params.narrowerPartition),
      hasFixDelta: Boolean(params.hasFixDelta),
      now: params.now,
    });
    if (result.ok && result.record && result.childRecord) {
      persistParentAndOptionalChildUnlocked({
        repoRoot: params.repoRoot,
        parent: result.record,
        child: result.childRecord,
      });
    }
    return result;
  }

  if (params.command === 'route') {
    if (!params.disposition) return fail('disposition required');
    const result = reduceRoute({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      disposition: params.disposition,
      reason: params.reason ?? '',
      implementationCommits: params.implementationCommits,
      revertCommit: params.revertCommit,
      supersedeCommit: params.supersedeCommit,
      successorRepo: params.successorRepo,
      successorBranch: params.successorBranch,
      successorBaseline: params.successorBaseline,
      predecessorHead: params.predecessorHeadCommit,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'rehome-bind') {
    const result = reduceRehomeBind({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      predecessorRootWorkstreamId: params.predecessorRootWorkstreamId ?? '',
      predecessorDescendantWorkstreamId: params.predecessorDescendantWorkstreamId ?? '',
      predecessorHeadCommit: params.predecessorHeadCommit ?? '',
      predecessorReleaseContext: params.predecessorReleaseContext ?? '',
      successorBaselineCommit: params.successorBaselineCommit ?? '',
      successorBranchName: params.successorBranchName ?? '',
      sourcePatchSha256: params.sourcePatchSha256 ?? '',
      sourceProductTreeFingerprint: params.sourceProductTreeFingerprint ?? '',
      sourceReleaseContext: params.sourceReleaseContext ?? '',
      sourceHeadCommit: params.sourceHeadCommit ?? '',
      sourceBaselineCommit: params.sourceBaselineCommit ?? '',
      sourceReviewWorkstreamId: params.sourceReviewWorkstreamId,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({ repoRoot: params.repoRoot, parent: result.record });
    }
    return result;
  }

  if (params.command === 'finalise-start') {
    const result = reduceFinaliseStart({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      now: params.now,
    });
    if (result.ok && result.record) {
      persistParentAndOptionalChildUnlocked({
        repoRoot: params.repoRoot,
        parent: result.record,
        activateFinalise: true,
      });
    }
    return result;
  }

  return fail(`unknown command ${params.command}`);
}

export function applyProtocolTransition(params: {
  repoRoot: string;
  command: WorkflowProtocolCommand;
  workstreamId?: string;
  planPath?: string;
  baseCommit?: string;
  manifestPath?: string;
  pass?: WorkflowProtocolReviewPass;
  token?: string;
  result?: 'passed' | 'failed';
  blockerFamilies?: string[];
  blockerIds?: string[];
  siblingSurfaces?: string[];
  closedBlockerIds?: string[];
  newWorkstreamId?: string;
  narrowerPartition?: boolean;
  hasFixDelta?: boolean;
  sourceWorkstreamIds?: string[];
  disposition?: WorkflowRouteDispositionTarget;
  reason?: string;
  implementationCommits?: string[];
  revertCommit?: string;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorRootWorkstreamId?: string;
  predecessorDescendantWorkstreamId?: string;
  predecessorHeadCommit?: string;
  predecessorReleaseContext?: string;
  successorBaselineCommit?: string;
  successorBranchName?: string;
  sourcePatchSha256?: string;
  sourceProductTreeFingerprint?: string;
  sourceReleaseContext?: string;
  sourceHeadCommit?: string;
  sourceBaselineCommit?: string;
  sourceReviewWorkstreamId?: string;
  now?: () => Date;
}): WorkflowProtocolTransitionResult {
  // Status is read-only and does not need the mutation lock.
  if (params.command === 'status') {
    return applyProtocolTransitionUnlocked(params);
  }
  const paths = getWorkflowPaths(params.repoRoot);
  return withWorkflowLock(paths.lockPath, () => applyProtocolTransitionUnlocked(params));
}
