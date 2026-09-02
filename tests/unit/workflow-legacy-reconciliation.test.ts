import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProtocolTransition,
  createEmptyProtocolRecord,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  applyLegacyReconciliation,
  getLegacyClosurePath,
  hasMeaningfulExecutionEvidence,
  persistLegacyClosure,
  protocolFileSha256,
  readLegacyClosure,
  validateSupersededEvidence,
} from '@/scripts/automation/workflow-legacy-reconciliation';
import {
  CURRENT_HARDENING_WORKSTREAM_IDS,
  LIVE_LEGACY_RECONCILIATION_REGISTRY,
  type LegacyReconciliationRegistryEntry,
} from '@/scripts/automation/legacy-reconciliation-registry';
import { getFinaliseProtocolReadiness } from '@/scripts/automation/workflow-finalise-correlation';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  saveWorkflowReviewState,
} from '@/scripts/automation/workflow-events';
import type { WorkflowProtocolRecord } from '@/scripts/automation/types';

const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
  const root = path.join(
    tmpdir(),
    `legacy-closure-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function git(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || args.join(' '));
  }
  return (result.stdout ?? '').trim();
}

function commitAll(repoRoot: string, message: string): string {
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '-A'], {
    cwd: repoRoot,
  });
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', message],
    { cwd: repoRoot }
  );
  return git(repoRoot, ['rev-parse', 'HEAD']);
}

function planMarkdown(workstreamId: string): string {
  return `# Plan

Workstream: \`${workstreamId}\`

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "${workstreamId}",
  "taskId": "${workstreamId}",
  "taskType": "change",
  "risk": "high",
  "initialParentTier": "unknown",
  "routingDecision": "unknown",
  "recommendedBuildModel": {
    "implementation": { "role": "economical-default", "tier": "economical", "family": "cursor-grok" },
    "premiumGates": [
      { "phase": "architecture-gate", "role": "premium-architecture-gate", "tier": "premium", "mandatory": true },
      { "phase": "final-diff-reviewer", "role": "premium-final-review", "tier": "premium", "mandatory": true }
    ],
    "switchTiming": "after_plan_approval",
    "rationale": "test",
    "fallbackEscalation": "stop"
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": ["workflow-protocol-persistence"],
  "requiredTests": [{ "id": "T-TEST", "status": "completed" }],
  "unresolvedRisks": [],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "implementationContract": {
    "invariants": ["keep protocol bytes"],
    "boundaries": ["no mutate"],
    "rollback": "delete closure"
  }
}
-->
`;
}

function initCutoffRepo(repoRoot: string, workstreamId: string): { cutoff: string; impl: string } {
  writeFileSync(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
  spawnSync('git', ['init', '-b', 'main'], { cwd: repoRoot, encoding: 'utf8' });
  commitAll(repoRoot, 'base');
  mkdirSync(path.join(repoRoot, 'plans'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'plans', `${workstreamId}.md`), planMarkdown(workstreamId), 'utf8');
  const planCommit = commitAll(repoRoot, 'plan');
  writeFileSync(path.join(repoRoot, 'MORE.md'), 'later\n', 'utf8');
  const cutoff = commitAll(repoRoot, 'cutoff');
  git(repoRoot, ['update-ref', 'refs/remotes/origin/main', cutoff]);
  return { cutoff, impl: planCommit };
}

function writeRecord(repoRoot: string, record: WorkflowProtocolRecord): void {
  writeProtocolRecord(repoRoot, record);
}

function emptyState(repoRoot: string): void {
  const paths = getWorkflowPaths(repoRoot);
  mkdirSync(path.dirname(paths.statePath), { recursive: true });
  saveWorkflowReviewState(paths.statePath, createEmptyWorkflowReviewState());
}

function releasedEntry(
  repoRoot: string,
  record: WorkflowProtocolRecord,
  cutoff: string,
  impl: string,
  extras?: Partial<LegacyReconciliationRegistryEntry>
): LegacyReconciliationRegistryEntry {
  return {
    registryId: `released:${record.workstreamId}`,
    workstreamId: record.workstreamId,
    kind: 'released',
    trustedReleaseSha: cutoff,
    expectedPreviousPhase: record.phase,
    expectedNextAction: record.nextAction,
    expectedBaseCommit: record.baseCommit,
    expectedHeadCommit: record.headCommit ?? record.baseCommit,
    expectedCheckpointId: record.activeCheckpointId,
    protocolPreimageSha256: protocolFileSha256(repoRoot, record.workstreamId)!,
    identityProof: {
      kind: 'plan-in-commit',
      implementationCommit: impl,
      planPath: `plans/${record.workstreamId}.md`,
    },
    reason: extras?.reason ?? 'test released',
    ...extras,
  };
}

function protocolBytes(repoRoot: string, workstreamId: string): Buffer {
  return readFileSync(
    path.join(repoRoot, 'docs_private', 'automation', 'workstreams', workstreamId, 'protocol.json')
  );
}

function stateBytes(repoRoot: string): Buffer {
  return readFileSync(getWorkflowPaths(repoRoot).statePath);
}

describe('legacy protocol closure records', { timeout: 30_000 }, () => {
  it('T-TYPECHECK / T-LINT / T-EXISTING-WORKFLOW-TESTS / LC-LIVENESS-012: workflow engine files remain present', () => {
    expect(existsSync(path.join(process.cwd(), 'scripts/automation/workflow-legacy-reconciliation.ts'))).toBe(true);
    expect(existsSync(path.join(process.cwd(), 'tests/unit/workflow-liveness.test.ts'))).toBe(true);
  });

  it('LC-PRESERVE-001 / LC-WS472-006 / T-LEGACY-RELEASED-OK / T-LEGACY-AUDIT-RETAINED / T-LEGACY-READINESS-TERMINAL / T-LEGACY-TERMINAL-AUDIT / T-LEGACY-NO-FINALISE-AUTH / LC-NO-FINALISE-AUTH-010', () => {
    const repoRoot = makeTempRoot('preserve');
    const workstreamId = 'ws_4720608c76e8b80b';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    writeRecord(repoRoot, record);
    emptyState(repoRoot);
    const beforeProtocol = protocolBytes(repoRoot, workstreamId);
    const beforeState = stateBytes(repoRoot);
    const registry = [releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl)];
    const applied = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'released',
      registry,
    });
    expect(applied.ok).toBe(true);
    expect(applied.wrote).toBe(true);
    expect(applied.record?.phase).toBe('initialized');
    expect(protocolBytes(repoRoot, workstreamId).equals(beforeProtocol)).toBe(true);
    expect(stateBytes(repoRoot).equals(beforeState)).toBe(true);
    const closure = readLegacyClosure(repoRoot, workstreamId);
    expect(closure?.disposition).toBe('released');
    expect(closure?.observedSnapshot.phase).toBe('initialized');
    const readiness = getFinaliseProtocolReadiness(repoRoot, { legacyRegistry: registry });
    expect(readiness.lineages.find((row) => row.workstreamId === workstreamId)?.role).toBe(
      'historically_closed'
    );
    expect(readiness.blockingWorkstreams.map((row) => row.workstreamId)).not.toContain(workstreamId);
    const start = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId,
    });
    expect(start.ok).toBe(false);
    expect(start.message).toMatch(/historically closed/i);
  });

  it('LC-INIT-EVIDENCE-005: initialized records with plan evidence cannot park as init-only', () => {
    const repoRoot = makeTempRoot('init-evidence');
    const workstreamId = 'ws_4720608c76e8b80b';
    const { cutoff } = initCutoffRepo(repoRoot, workstreamId);
    const leftover = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    writeRecord(repoRoot, leftover);
    const ready = createEmptyProtocolRecord({
      workstreamId: 'ws_ready',
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    ready.phase = 'finalise_ready';
    ready.nextAction = 'run_finalise';
    ready.activeCheckpointId = 'ckpt_ready';
    ready.reviewAttempts = [
      { pass: 'first', token: 'rev', startedAt: 't', result: 'passed', recordedAt: 't' },
    ];
    writeRecord(repoRoot, ready);
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      activeFinaliseContext: {
        workstreamId: ready.workstreamId,
        checkpointId: 'ckpt_ready',
        activatedHeadCommit: cutoff,
        ownedCommits: [cutoff],
        activatedAt: 't',
      },
    });
    expect(hasMeaningfulExecutionEvidence(repoRoot, workstreamId)).toBe(true);
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.lineages.find((row) => row.workstreamId === workstreamId)?.role).not.toBe(
      'parked_unstarted'
    );
  });

  it('LC-CUTOFF-003 / T-LEGACY-UNRELEASED-REJECT / T-LEGACY-LOCAL-DELTA-REJECT / T-LEGACY-MODERN-REJECT / T-LEGACY-TRUSTED-REF', () => {
    const repoRoot = makeTempRoot('cutoff');
    const workstreamId = 'ws_shipped';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const extra = commitAll(repoRoot, 'local-only');
    git(repoRoot, ['reset', '--hard', cutoff]);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeRecord(repoRoot, record);
    emptyState(repoRoot);
    const registry = [releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl)];
    const headRef = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'released',
      releasedRef: 'HEAD',
      registry,
    });
    expect(headRef.ok).toBe(false);
    expect(headRef.message).toMatch(/HEAD/i);
    writeFileSync(path.join(repoRoot, 'tip.ts'), 'tip\n', 'utf8');
    const tip = commitAll(repoRoot, 'tip');
    const tipRef = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'released',
      releasedRef: tip,
      registry,
    });
    expect(tipRef.ok).toBe(false);
    git(repoRoot, ['reset', '--hard', cutoff]);
    const modern = applyLegacyReconciliation({
      repoRoot,
      workstreamId: CURRENT_HARDENING_WORKSTREAM_IDS[0],
      kind: 'released',
      registry,
    });
    expect(modern.ok).toBe(false);
    expect(modern.message).toMatch(/current hardening/i);
    expect(extra).toBeTruthy();
  });

  it('LC-IDENTITY-004 / T-LEGACY-REGISTRY-ONLY: release prose is not an identity anchor', () => {
    const repoRoot = makeTempRoot('identity');
    const workstreamId = 'ws_identity';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeRecord(repoRoot, record);
    emptyState(repoRoot);
    const entry = releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl);
    entry.identityProof = {
      kind: 'plan-in-commit',
      implementationCommit: cutoff,
      planPath: `plans/${workstreamId}.md`,
    };
    const prose = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'released',
      registry: [entry],
    });
    expect(prose.ok).toBe(false);
    expect(prose.message).toMatch(/was not introduced by/i);
  });

  it('LC-KIND-SEPARATION-007 / T-LEGACY-SUPERSEDE-DISABLED / T-LEGACY-SUPERSEDE-REQUIRES-GIT', () => {
    const repoRoot = makeTempRoot('kind');
    const workstreamId = 'ws_kind';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeRecord(repoRoot, record);
    emptyState(repoRoot);
    const registry = [releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl)];
    const asReleased = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'superseded',
      registry,
    });
    expect(asReleased.ok).toBe(false);
    expect(asReleased.message).toMatch(/superseded/i);
    expect(validateSupersededEvidence({
      repoRoot,
      implementationCommit: impl,
      revertOrReplacementCommit: impl,
      cutoffSha: cutoff,
    })).toMatch(/later revert or replacement/i);
    expect(validateSupersededEvidence({
      repoRoot,
      implementationCommit: impl,
      revertOrReplacementCommit: cutoff,
      cutoffSha: cutoff,
    })).toBeNull();
  });

  it('LC-DRYRUN-011 / T-LEGACY-DRY-RUN-WRITE-FREE / T-LEGACY-DRY-RUN-NO-LOCK', () => {
    const repoRoot = makeTempRoot('dry');
    const workstreamId = 'ws_dry';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeRecord(repoRoot, record);
    emptyState(repoRoot);
    const before = protocolBytes(repoRoot, workstreamId);
    const registry = [releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl)];
    const dry = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'released',
      registry,
      dryRun: true,
    });
    expect(dry.ok).toBe(true);
    expect(dry.wrote).toBe(false);
    expect(dry.dryRun).toBe(true);
    expect(existsSync(getLegacyClosurePath(repoRoot, workstreamId))).toBe(false);
    expect(protocolBytes(repoRoot, workstreamId).equals(before)).toBe(true);
    expect(existsSync(getWorkflowPaths(repoRoot).lockPath)).toBe(false);
  });

  it('LC-ORPHAN-008 / T-LEGACY-ORPHAN-RECONSTRUCT / T-LEGACY-ORPHAN-NO-INFER-IDEMPOTENT / T-LEGACY-ORPHAN-AMBIGUOUS / T-LEGACY-STATUS-PRESERVE / T-LEGACY-UNRELATED-UNTOUCHED / T-LEGACY-SOURCE-DIVERGENCE', () => {
    const repoRoot = makeTempRoot('orphan');
    const parentId = 'ws_vans_rls_fixerrors_20260810';
    const childId = 'ws_vans_rls_fixerrors_20260810_v2';
    const { cutoff, impl } = initCutoffRepo(repoRoot, parentId);
    const parent = createEmptyProtocolRecord({
      workstreamId: parentId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    parent.phase = 'split';
    parent.nextAction = 'use_split_workstream';
    parent.openBlockerIds = ['VAN-RLS-VERIFY-001'];
    writeRecord(repoRoot, parent);
    const child = createEmptyProtocolRecord({
      workstreamId: childId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    child.phase = 'finalised';
    child.nextAction = 'done';
    child.reviewAttempts = [
      {
        pass: 'first',
        token: 'rev',
        startedAt: 't',
        result: 'failed',
        blockerIds: ['VAN-RLS-VERIFY-001'],
        recordedAt: 't',
      },
    ];
    writeRecord(repoRoot, child);
    const unrelated = createEmptyProtocolRecord({
      workstreamId: 'ws_unrelated',
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    unrelated.phase = 'review_closed';
    unrelated.nextAction = 'finalise_start';
    writeRecord(repoRoot, unrelated);
    emptyState(repoRoot);
    const parentBefore = protocolBytes(repoRoot, parentId);
    const childBefore = protocolBytes(repoRoot, childId);
    const unrelatedUpdated = readProtocolRecord(repoRoot, 'ws_unrelated')!.updatedAt;
    const entry: LegacyReconciliationRegistryEntry = {
      ...releasedEntry(repoRoot, readProtocolRecord(repoRoot, parentId)!, cutoff, impl, {
        kind: 'reconstruct-lineage',
        registryId: `reconstruct:${parentId}`,
      }),
      kind: 'reconstruct-lineage',
      registryId: `reconstruct:${parentId}`,
      childWorkstreamId: childId,
      childExpectedPhase: 'finalised',
      childExpectedBaseCommit: cutoff,
      childExpectedHeadCommit: cutoff,
      childProtocolPreimageSha256: protocolFileSha256(repoRoot, childId)!,
      childExpectedSourceWorkstreamIds: null,
      expectedBlockerContinuity: ['VAN-RLS-VERIFY-001'],
      identityProof: {
        kind: 'plan-in-commit',
        implementationCommit: impl,
        planPath: `plans/${parentId}.md`,
      },
    };
    const inferred = applyLegacyReconciliation({
      repoRoot,
      workstreamId: parentId,
      kind: 'reconstruct-lineage',
      registry: [entry],
    });
    expect(inferred.ok).toBe(false);
    expect(inferred.message).toMatch(/explicit --child-workstream/i);
    const extra = createEmptyProtocolRecord({
      workstreamId: `${parentId}_other`,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    extra.phase = 'finalised';
    extra.nextAction = 'done';
    writeRecord(repoRoot, extra);
    const ambiguous = applyLegacyReconciliation({
      repoRoot,
      workstreamId: parentId,
      kind: 'reconstruct-lineage',
      childWorkstreamId: childId,
      registry: [entry],
    });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.message).toMatch(/ambiguous/i);
    extra.phase = 'review_closed';
    extra.nextAction = 'finalise_start';
    extra.headCommit = `${cutoff}ffff`;
    extra.baseCommit = `${cutoff}ffff`;
    writeRecord(repoRoot, extra);
    const wrongChild = applyLegacyReconciliation({
      repoRoot,
      workstreamId: parentId,
      kind: 'reconstruct-lineage',
      childWorkstreamId: 'ws_wrong',
      registry: [entry],
    });
    expect(wrongChild.ok).toBe(false);
    const applied = applyLegacyReconciliation({
      repoRoot,
      workstreamId: parentId,
      kind: 'reconstruct-lineage',
      childWorkstreamId: childId,
      registry: [entry],
    });
    expect(applied.ok).toBe(true);
    expect(protocolBytes(repoRoot, parentId).equals(parentBefore)).toBe(true);
    expect(protocolBytes(repoRoot, childId).equals(childBefore)).toBe(true);
    expect(readProtocolRecord(repoRoot, childId)?.sourceWorkstreamIds ?? null).toBeNull();
    expect(readProtocolRecord(repoRoot, 'ws_unrelated')?.updatedAt).toBe(unrelatedUpdated);
    const inferredAgain = applyLegacyReconciliation({
      repoRoot,
      workstreamId: parentId,
      kind: 'reconstruct-lineage',
      registry: [entry],
    });
    expect(inferredAgain.ok).toBe(false);
    const replay = applyLegacyReconciliation({
      repoRoot,
      workstreamId: parentId,
      kind: 'reconstruct-lineage',
      childWorkstreamId: childId,
      registry: [entry],
    });
    expect(replay.ok).toBe(true);
    expect(replay.wrote).toBe(false);
    const closurePath = getLegacyClosurePath(repoRoot, parentId);
    const validClosure = readFileSync(closurePath, 'utf8');
    const closure = JSON.parse(validClosure) as { childWorkstreamId?: string };
    closure.childWorkstreamId = 'ws_wrong_child';
    writeFileSync(closurePath, JSON.stringify(closure, null, 2), 'utf8');
    const childTamper = getFinaliseProtocolReadiness(repoRoot, { legacyRegistry: [entry] });
    expect(childTamper.blockingWorkstreams.some((row) => row.workstreamId === parentId)).toBe(true);
    writeFileSync(closurePath, validClosure, 'utf8');
    const liveChild = readProtocolRecord(repoRoot, childId)!;
    liveChild.sourceWorkstreamIds = [parentId];
    writeRecord(repoRoot, liveChild);
    const sourceTamper = getFinaliseProtocolReadiness(repoRoot, { legacyRegistry: [entry] });
    expect(sourceTamper.blockingWorkstreams.some((row) => row.workstreamId === parentId)).toBe(true);
  });

  it('LC-A19-009 / T-LEGACY-A19-RECONSTRUCT: parent stays finalise_ready', () => {
    const repoRoot = makeTempRoot('a19');
    const workstreamId = 'ws_a19f4c72e8b06d31';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const parent = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    parent.phase = 'finalise_ready';
    parent.nextAction = 'run_finalise';
    parent.activeCheckpointId = 'ckpt_a19';
    writeRecord(repoRoot, parent);
    const child = createEmptyProtocolRecord({
      workstreamId: 'ws_e4c91a07b2d58f16',
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
      sourceWorkstreamIds: [workstreamId],
    });
    child.phase = 'split';
    child.nextAction = 'use_split_workstream';
    writeRecord(repoRoot, child);
    emptyState(repoRoot);
    const before = protocolBytes(repoRoot, workstreamId);
    const childBefore = protocolBytes(repoRoot, child.workstreamId);
    const registry = [
      releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl),
    ];
    const applied = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'released',
      registry,
    });
    expect(applied.ok).toBe(true);
    expect(readProtocolRecord(repoRoot, workstreamId)?.phase).toBe('finalise_ready');
    expect(protocolBytes(repoRoot, workstreamId).equals(before)).toBe(true);
    expect(protocolBytes(repoRoot, child.workstreamId).equals(childBefore)).toBe(true);
  });

  it('LC-IDEMPOTENCY-013: replay writes nothing and keeps protocol bytes', () => {
    const repoRoot = makeTempRoot('idempotent');
    const workstreamId = 'ws_idempotent';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeRecord(repoRoot, record);
    emptyState(repoRoot);
    const registry = [releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl)];
    const before = protocolBytes(repoRoot, workstreamId);
    expect(applyLegacyReconciliation({ repoRoot, workstreamId, kind: 'released', registry }).ok).toBe(true);
    const replay = applyLegacyReconciliation({ repoRoot, workstreamId, kind: 'released', registry });
    expect(replay.ok).toBe(true);
    expect(replay.wrote).toBe(false);
    expect(protocolBytes(repoRoot, workstreamId).equals(before)).toBe(true);
  });

  it('LC-VALIDITY-002 / LR-AUDIT-001: independent and coordinated snapshot tampers block readiness', () => {
    const repoRoot = makeTempRoot('valid');
    const workstreamId = 'ws_valid';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeRecord(repoRoot, record);
    emptyState(repoRoot);
    const registry = [releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl)];
    expect(applyLegacyReconciliation({ repoRoot, workstreamId, kind: 'released', registry }).ok).toBe(true);
    const closurePath = getLegacyClosurePath(repoRoot, workstreamId);
    const validClosure = readFileSync(closurePath, 'utf8');
    const expectBlocked = () => {
      expect(
        getFinaliseProtocolReadiness(repoRoot, { legacyRegistry: registry }).blockingWorkstreams.some(
          (row) => row.workstreamId === workstreamId
        )
      ).toBe(true);
    };
    const tamper = (mutate: (row: Record<string, unknown>) => void) => {
      writeFileSync(closurePath, validClosure, 'utf8');
      const row = JSON.parse(validClosure) as Record<string, unknown>;
      mutate(row);
      writeFileSync(closurePath, JSON.stringify(row, null, 2), 'utf8');
      expectBlocked();
    };
    tamper((row) => {
      row.registryFingerprint = '0'.repeat(64);
    });
    tamper((row) => {
      row.disposition = 'superseded';
    });
    tamper((row) => {
      row.identityAnchor = {
        ...(row.identityAnchor as Record<string, unknown>),
        implementationCommit: '0'.repeat(40),
      };
    });
    tamper((row) => {
      row.observedSnapshot = {
        ...(row.observedSnapshot as Record<string, unknown>),
        nextAction: 'done',
      };
    });
    tamper((row) => {
      row.observedSnapshot = {
        ...(row.observedSnapshot as Record<string, unknown>),
        protocolPreimageSha256: '0'.repeat(64),
      };
    });
    tamper((row) => {
      row.schemaVersion = '9';
    });
    tamper((row) => {
      row.releasedRef = 'deadbeef';
    });
    tamper((row) => {
      row.evidenceCommits = [];
    });
    tamper((row) => {
      row.reason = 'forged reason';
    });
    tamper((row) => {
      row.createdAt = 'not-a-timestamp';
    });
    tamper((row) => {
      delete row.identityAnchor;
    });
    writeFileSync(closurePath, '{not-json', 'utf8');
    expectBlocked();
    writeFileSync(closurePath, validClosure, 'utf8');
    const live = readProtocolRecord(repoRoot, workstreamId)!;
    live.phase = 'finalised';
    live.nextAction = 'done';
    writeRecord(repoRoot, live);
    const coordinated = JSON.parse(validClosure) as {
      observedSnapshot: { phase: string; nextAction: string; protocolPreimageSha256: string };
    };
    coordinated.observedSnapshot.phase = 'finalised';
    coordinated.observedSnapshot.nextAction = 'done';
    coordinated.observedSnapshot.protocolPreimageSha256 = protocolFileSha256(repoRoot, workstreamId)!;
    writeFileSync(closurePath, JSON.stringify(coordinated, null, 2), 'utf8');
    expectBlocked();
  });

  it('LC-DIVERGENCE-016: later protocol drift invalidates a previously valid closure', () => {
    const repoRoot = makeTempRoot('diverge');
    const workstreamId = 'ws_diverge';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeRecord(repoRoot, record);
    emptyState(repoRoot);
    const registry = [releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl)];
    expect(applyLegacyReconciliation({ repoRoot, workstreamId, kind: 'released', registry }).ok).toBe(true);
    const drifted = readProtocolRecord(repoRoot, workstreamId)!;
    drifted.nextAction = 'done';
    writeRecord(repoRoot, drifted);
    expect(
      getFinaliseProtocolReadiness(repoRoot, { legacyRegistry: registry }).blockingWorkstreams.some(
        (row) => row.workstreamId === workstreamId
      )
    ).toBe(true);
  });

  it('T-LEGACY-TRANSACTION-RECOVERY / LR-CLOSURE-WRITE-005: failed persist removes residue and refuses overwrite', () => {
    const repoRoot = makeTempRoot('residue');
    const workstreamId = 'ws_residue';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeRecord(repoRoot, record);
    emptyState(repoRoot);
    const registry = [releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl)];
    const evaluated = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'released',
      registry,
      dryRun: true,
    });
    expect(evaluated.ok).toBe(true);
    expect(evaluated.closure).toBeTruthy();
    const protocolPath = path.join(
      repoRoot,
      'docs_private',
      'automation',
      'workstreams',
      workstreamId,
      'protocol.json'
    );
    const staleProtocol = readFileSync(protocolPath);
    const live = readProtocolRecord(repoRoot, workstreamId)!;
    live.nextAction = 'done';
    writeRecord(repoRoot, live);
    expect(() =>
      persistLegacyClosure({
        repoRoot,
        workstreamId,
        intended: evaluated.closure!,
        protocolBefore: staleProtocol,
        stateBefore: stateBytes(repoRoot),
        registry,
      })
    ).toThrow(/protocol bytes changed/);
    expect(existsSync(getLegacyClosurePath(repoRoot, workstreamId))).toBe(false);
    writeFileSync(protocolPath, staleProtocol);
    const wrongReason = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'released',
      reason: 'historical forensic closure',
      registry,
    });
    expect(wrongReason.ok).toBe(false);
    expect(wrongReason.message).toMatch(/reason must match the registry reason/);
    git(repoRoot, ['tag', 'cutoff-alias', cutoff]);
    const aliasRef = applyLegacyReconciliation({
      repoRoot,
      workstreamId,
      kind: 'released',
      releasedRef: 'cutoff-alias',
      registry,
    });
    expect(aliasRef.ok).toBe(false);
    expect(aliasRef.message).toMatch(/exact trusted cutoff SHA/);
    const invalidIntended = {
      ...evaluated.closure!,
      reason: 'forged persist reason',
      createdAt: 'not-a-timestamp',
    };
    expect(() =>
      persistLegacyClosure({
        repoRoot,
        workstreamId,
        intended: invalidIntended,
        protocolBefore: staleProtocol,
        stateBefore: stateBytes(repoRoot),
        registry,
      })
    ).toThrow(/read validation|createdAt|reason/);
    expect(existsSync(getLegacyClosurePath(repoRoot, workstreamId))).toBe(false);
    expect(applyLegacyReconciliation({ repoRoot, workstreamId, kind: 'released', registry }).ok).toBe(true);
    const first = readFileSync(getLegacyClosurePath(repoRoot, workstreamId), 'utf8');
    const written = readLegacyClosure(repoRoot, workstreamId);
    expect(written).toBeTruthy();
    expect(first).toBe(`${JSON.stringify(written, null, 2)}\n`);
    expect(() =>
      persistLegacyClosure({
        repoRoot,
        workstreamId,
        intended: evaluated.closure!,
        protocolBefore: protocolBytes(repoRoot, workstreamId),
        stateBefore: stateBytes(repoRoot),
        registry,
      })
    ).toThrow(/already exists/);
    expect(readFileSync(getLegacyClosurePath(repoRoot, workstreamId), 'utf8')).toBe(first);
  });

  it('T-LEGACY-ACTIVE-CONTEXT-REJECT: refuse while the workstream owns activeFinaliseContext', () => {
    const repoRoot = makeTempRoot('active');
    const workstreamId = 'ws_active';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeRecord(repoRoot, record);
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: { [workstreamId]: readProtocolRecord(repoRoot, workstreamId)! },
      activeFinaliseContext: {
        workstreamId,
        checkpointId: 'ckpt_ws_active',
        activatedAt: new Date().toISOString(),
        activatedHeadCommit: cutoff,
      },
    });
    const registry = [releasedEntry(repoRoot, readProtocolRecord(repoRoot, workstreamId)!, cutoff, impl)];
    const refused = applyLegacyReconciliation({ repoRoot, workstreamId, kind: 'released', registry });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/activeFinaliseContext/);
  });

  it('LC-LEGACY-COMPAT-014: forged and registry-matching old audits block; only a valid closure parks history', () => {
    const repoRoot = makeTempRoot('compat');
    const workstreamId = 'ws_forged';
    const { cutoff, impl } = initCutoffRepo(repoRoot, workstreamId);
    const forged = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    forged.phase = 'reconciled';
    forged.nextAction = 'done';
    forged.legacyReconciliation = {
      previousPhase: 'review_closed',
      kind: 'released',
      reason: 'forged',
      evidenceCommits: [cutoff],
      releasedRef: cutoff,
      releasedRefCommit: cutoff,
      command: 'reconcile-legacy',
      protocolVersion: '1',
      registryId: 'released:ws_forged',
      preimageSha256: '00',
      reconciledAt: 't',
    };
    writeRecord(repoRoot, forged);
    emptyState(repoRoot);
    const forgedReady = getFinaliseProtocolReadiness(repoRoot);
    expect(forgedReady.blockingWorkstreams.some((row) => row.workstreamId === workstreamId)).toBe(true);
    expect(
      forgedReady.blockingWorkstreams.find((row) => row.workstreamId === workstreamId)?.message
    ).toMatch(/reconciled without a registry-valid closure/i);

    const matchingId = 'ws_old_audit';
    const matching = createEmptyProtocolRecord({
      workstreamId: matchingId,
      baseCommit: cutoff,
      branchName: 'main',
      headCommit: cutoff,
    });
    matching.phase = 'review_closed';
    matching.nextAction = 'finalise_start';
    writeRecord(repoRoot, matching);
    const entry = releasedEntry(repoRoot, readProtocolRecord(repoRoot, matchingId)!, cutoff, impl);
    matching.phase = 'reconciled';
    matching.nextAction = 'done';
    matching.legacyReconciliation = {
      previousPhase: entry.expectedPreviousPhase,
      kind: 'released',
      reason: 'old embedded audit',
      evidenceCommits: [cutoff],
      releasedRef: cutoff,
      releasedRefCommit: cutoff,
      command: 'reconcile-legacy',
      protocolVersion: '1',
      registryId: entry.registryId,
      preimageSha256: entry.protocolPreimageSha256,
      reconciledAt: 't',
    };
    writeRecord(repoRoot, matching);
    const matchingReady = getFinaliseProtocolReadiness(repoRoot, { legacyRegistry: [entry] });
    expect(matchingReady.blockingWorkstreams.some((row) => row.workstreamId === matchingId)).toBe(true);
    expect(matchingReady.lineages.some((row) => row.role === 'historically_closed')).toBe(false);
  });

  it('LC-LIVE-REGISTRY-015 / LC-PLAN-BINDING-017: live rows independently dry-run; current lineage stays ineligible', () => {
    const repoRoot = process.cwd();
    for (const entry of LIVE_LEGACY_RECONCILIATION_REGISTRY) {
      const dry = applyLegacyReconciliation({
        repoRoot,
        workstreamId: entry.workstreamId,
        kind: entry.kind,
        childWorkstreamId:
          entry.kind === 'reconstruct-lineage' ? entry.childWorkstreamId : undefined,
        dryRun: true,
      });
      expect(dry.ok, `${entry.registryId}: ${dry.message}`).toBe(true);
      expect(dry.wrote).toBe(false);
      expect(dry.record?.phase).toBe(entry.expectedPreviousPhase);
      expect(existsSync(getLegacyClosurePath(repoRoot, entry.workstreamId))).toBe(false);
    }
    for (const id of CURRENT_HARDENING_WORKSTREAM_IDS) {
      const modern = applyLegacyReconciliation({
        repoRoot,
        workstreamId: id,
        kind: 'released',
        dryRun: true,
      });
      expect(modern.ok).toBe(false);
    }
  });
});
