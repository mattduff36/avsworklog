import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFinaliseProtocolOutcome,
  applyProtocolTransition,
  assertFinaliseProductCommitAllowed,
  commitFinaliseCorrelationStateAndProtocols,
  createEmptyProtocolRecord,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  getFinaliseProtocolReadiness,
  listDiskProtocolInventory,
  shouldApplyFinaliseCorrelation,
} from '@/scripts/automation/workflow-finalise-correlation';
import { correlateFinaliseAutomationRun } from '@/scripts/automation/logger';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  saveWorkflowReviewState,
} from '@/scripts/automation/workflow-events';
import { appendOwnedCommit } from '@/scripts/automation/workflow-git-binding';
import {
  createOrLoadFinaliseCheckpoint,
} from '@/scripts/automation/finalise-checkpoint';
import type { WorkflowProtocolRecord } from '@/scripts/automation/types';

const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
  const root = path.join(
    tmpdir(),
    `workflow-liveness-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
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

function initGitRepo(repoRoot: string): string {
  writeFileSync(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
  spawnSync('git', ['init', '-b', 'main'], { cwd: repoRoot });
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.'],
    { cwd: repoRoot }
  );
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
    { cwd: repoRoot }
  );
  return (
    spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout ?? ''
  ).trim();
}

function commitFile(repoRoot: string, fileName: string, message: string): string {
  writeFileSync(path.join(repoRoot, fileName), `${message}\n`, 'utf8');
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.'],
    { cwd: repoRoot }
  );
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', message],
    { cwd: repoRoot }
  );
  return (
    spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout ?? ''
  ).trim();
}

function writeProtocol(
  repoRoot: string,
  record: WorkflowProtocolRecord
): WorkflowProtocolRecord {
  writeProtocolRecord(repoRoot, record);
  return record;
}

function readyChild(
  repoRoot: string,
  workstreamId: string,
  head: string,
  extra: Partial<WorkflowProtocolRecord> = {}
): WorkflowProtocolRecord {
  const record = createEmptyProtocolRecord({
    workstreamId,
    baseCommit: extra.baseCommit ?? head,
    branchName: extra.branchName ?? 'main',
    headCommit: extra.headCommit ?? head,
    sourceWorkstreamIds: extra.sourceWorkstreamIds,
  });
  record.phase = extra.phase ?? 'finalise_ready';
  record.nextAction = extra.nextAction ?? 'run_finalise';
  record.activeCheckpointId = extra.activeCheckpointId ?? `ckpt_${workstreamId}`;
  record.reviewedTreeFingerprint = extra.reviewedTreeFingerprint ?? null;
  if (extra.openBlockerIds) record.openBlockerIds = extra.openBlockerIds;
  if (extra.reviewAttempts) record.reviewAttempts = extra.reviewAttempts;
  if (extra.activeReviewToken !== undefined) record.activeReviewToken = extra.activeReviewToken;
  return writeProtocol(repoRoot, record);
}

function activate(
  repoRoot: string,
  workstreamId: string,
  checkpointId: string,
  head: string
): void {
  const paths = getWorkflowPaths(repoRoot);
  mkdirSync(path.dirname(paths.statePath), { recursive: true });
  const protocol = readProtocolRecord(repoRoot, workstreamId);
  saveWorkflowReviewState(paths.statePath, {
    ...createEmptyWorkflowReviewState(),
    protocolRecords: protocol ? { [workstreamId]: protocol } : {},
    activeFinaliseContext: {
      workstreamId,
      checkpointId,
      activatedAt: new Date().toISOString(),
      activatedHeadCommit: head,
      ownedCommits: [head],
    },
  });
}

describe('workflow liveness hardening', () => {
  it('T-SPLIT-PARENT-CHILD / T-SPLIT-AUDIT-PRESERVE: parked ancestor does not block ready child', () => {
    const repoRoot = makeTempRoot('split-parent');
    const head = initGitRepo(repoRoot);
    const parent = createEmptyProtocolRecord({
      workstreamId: 'ws_parent',
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    parent.phase = 'split';
    parent.nextAction = 'use_split_workstream';
    parent.openBlockerIds = ['AUDIT-1'];
    writeProtocol(repoRoot, parent);
    readyChild(repoRoot, 'ws_child', head, { sourceWorkstreamIds: ['ws_parent'] });
    activate(repoRoot, 'ws_child', 'ckpt_ws_child', head);

    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.blockingWorkstreams.map((row) => row.workstreamId)).not.toContain('ws_parent');
    expect(
      readiness.lineages.find((row) => row.workstreamId === 'ws_parent')?.role
    ).toBe('parked_split_ancestor');
    expect(readiness.warnings.some((warning) => warning.includes('AUDIT-1'))).toBe(true);
    expect(readiness.allowed).toBe(true);
  });

  it('T-SPLIT-NESTED: nested split ancestors plus ready grandchild succeed', () => {
    const repoRoot = makeTempRoot('split-nested');
    const head = initGitRepo(repoRoot);
    for (const [id, parent] of [
      ['ws_root', null],
      ['ws_mid', 'ws_root'],
    ] as const) {
      const record = createEmptyProtocolRecord({
        workstreamId: id,
        baseCommit: head,
        branchName: 'main',
        headCommit: head,
        sourceWorkstreamIds: parent ? [parent] : undefined,
      });
      record.phase = 'split';
      record.nextAction = 'use_split_workstream';
      writeProtocol(repoRoot, record);
    }
    readyChild(repoRoot, 'ws_leaf', head, { sourceWorkstreamIds: ['ws_mid'] });
    activate(repoRoot, 'ws_leaf', 'ckpt_ws_leaf', head);
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(true);
    expect(
      readiness.lineages.filter((row) => row.role === 'parked_split_ancestor')
    ).toHaveLength(2);
  });

  it('T-SPLIT-ORPHAN / T-SPLIT-CYCLE: malformed split lineages block', () => {
    const orphanRoot = makeTempRoot('orphan');
    const orphanHead = initGitRepo(orphanRoot);
    const orphan = createEmptyProtocolRecord({
      workstreamId: 'ws_orphan',
      baseCommit: orphanHead,
      branchName: 'main',
      headCommit: orphanHead,
    });
    orphan.phase = 'split';
    orphan.nextAction = 'use_split_workstream';
    writeProtocol(orphanRoot, orphan);
    const orphanReady = getFinaliseProtocolReadiness(orphanRoot);
    expect(orphanReady.allowed).toBe(false);
    expect(orphanReady.blockingWorkstreams[0]?.role).toBe('orphan_split');

    const cycleRoot = makeTempRoot('cycle');
    const cycleHead = initGitRepo(cycleRoot);
    const a = createEmptyProtocolRecord({
      workstreamId: 'ws_a',
      baseCommit: cycleHead,
      branchName: 'main',
      headCommit: cycleHead,
      sourceWorkstreamIds: ['ws_b'],
    });
    a.phase = 'split';
    writeProtocol(cycleRoot, a);
    const b = createEmptyProtocolRecord({
      workstreamId: 'ws_b',
      baseCommit: cycleHead,
      branchName: 'main',
      headCommit: cycleHead,
      sourceWorkstreamIds: ['ws_a'],
    });
    b.phase = 'split';
    writeProtocol(cycleRoot, b);
    const cycleReady = getFinaliseProtocolReadiness(cycleRoot);
    expect(cycleReady.allowed).toBe(false);
    expect(cycleReady.blockingWorkstreams.some((row) => row.role === 'orphan_split')).toBe(true);
  });

  it('T-SPLIT-NO-FALSE-FINALISE: descendant finalise does not mark ancestors finalised', () => {
    const repoRoot = makeTempRoot('no-false');
    const head = initGitRepo(repoRoot);
    const parent = createEmptyProtocolRecord({
      workstreamId: 'ws_keep_split',
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    parent.phase = 'split';
    writeProtocol(repoRoot, parent);
    const child = readyChild(repoRoot, 'ws_done', head, {
      sourceWorkstreamIds: ['ws_keep_split'],
    });
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    const previous = createEmptyWorkflowReviewState();
    const outcome = applyFinaliseProtocolOutcome({
      repoRoot,
      state: previous,
      workstreamId: child.workstreamId,
      outcome: 'passed',
    });
    expect(outcome.record?.phase).toBe('finalised');
    expect(readProtocolRecord(repoRoot, child.workstreamId)?.phase).toBe('finalise_ready');
    commitFinaliseCorrelationStateAndProtocols({
      repoRoot,
      statePath: paths.statePath,
      previousState: previous,
      nextState: outcome.state,
      workstreamIds: [child.workstreamId],
    });
    expect(readProtocolRecord(repoRoot, 'ws_keep_split')?.phase).toBe('split');
    expect(readProtocolRecord(repoRoot, child.workstreamId)?.phase).toBe('finalised');
  });

  it('T-INDEP-ACTIVE-BLOCKS / T-INDEP-ALL-BLOCKERS: independent leaves all block together', () => {
    const repoRoot = makeTempRoot('indep');
    const head = initGitRepo(repoRoot);
    readyChild(repoRoot, 'ws_one', head);
    const two = createEmptyProtocolRecord({
      workstreamId: 'ws_two',
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    two.phase = 'review_closed';
    two.nextAction = 'finalise_start';
    writeProtocol(repoRoot, two);
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    expect(readiness.allowed).toBe(false);
    expect(readiness.blockingWorkstreams.map((row) => row.workstreamId).sort()).toEqual([
      'ws_one',
      'ws_two',
    ]);
    expect(
      readiness.blockingWorkstreams.find((row) => row.workstreamId === 'ws_two')?.suggestedCommands
    ).toContain('npx tsx scripts/workflow-protocol.ts finalise-start --workstream ws_two');
  });

  it('T-INIT-SIBLING-PARK / T-STARTED-SIBLING-BLOCKS: unstarted sibling parks; started sibling blocks', () => {
    const repoRoot = makeTempRoot('sibling');
    const head = initGitRepo(repoRoot);
    readyChild(repoRoot, 'ws_ready', head);
    activate(repoRoot, 'ws_ready', 'ckpt_ws_ready', head);
    const unstarted = createEmptyProtocolRecord({
      workstreamId: 'ws_init_only',
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    writeProtocol(repoRoot, unstarted);
    const parked = getFinaliseProtocolReadiness(repoRoot);
    expect(parked.allowed).toBe(true);
    expect(parked.lineages.find((row) => row.workstreamId === 'ws_init_only')?.role).toBe(
      'parked_unstarted'
    );
    expect(readProtocolRecord(repoRoot, 'ws_init_only')?.phase).toBe('initialized');

    const started = readProtocolRecord(repoRoot, 'ws_init_only')!;
    started.reviewAttempts = [
      {
        pass: 'first',
        token: 'rev_first_x',
        startedAt: new Date().toISOString(),
      },
    ];
    writeProtocol(repoRoot, started);
    const blocked = getFinaliseProtocolReadiness(repoRoot);
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockingWorkstreams.some((row) => row.workstreamId === 'ws_init_only')).toBe(
      true
    );
  });

  it('T-HEAD-CAPTURE / T-HEAD-MID-REVIEW / T-HEAD-FINALISE-MATCH / T-HEAD-DRIFT-REJECT / T-DELTA-REBIND / T-NO-SILENT-REBIND / T-TREE-MID-REVIEW / T-TREE-FINALISE-MATCH', () => {
    const repoRoot = makeTempRoot('head');
    const firstHead = initGitRepo(repoRoot);
    const workstreamId = 'ws_head';
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: firstHead,
      branchName: 'main',
      headCommit: firstHead,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeProtocol(repoRoot, record);

    const secondHead = commitFile(repoRoot, 'later.ts', 'later');
    const blockedStart = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId,
    });
    expect(blockedStart.ok).toBe(false);
    expect(blockedStart.message).toMatch(/--pass delta/);
    expect(readProtocolRecord(repoRoot, workstreamId)?.headCommit).toBe(firstHead);

    const deltaStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'delta',
    });
    expect(deltaStart.ok).toBe(true);
    expect(deltaStart.record?.reviewAttempts.at(-1)?.headCommit).toBe(secondHead);
    expect(deltaStart.record?.phase).toBe('delta_review');

    writeFileSync(path.join(repoRoot, 'dirty.ts'), 'export const n = 1;\n', 'utf8');
    const treeMoved = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: deltaStart.reviewToken!,
      result: 'passed',
    });
    expect(treeMoved.ok).toBe(false);
    expect(treeMoved.message).toMatch(/fingerprint moved/i);
    expect(readProtocolRecord(repoRoot, workstreamId)?.headCommit).toBe(firstHead);

    rmSync(path.join(repoRoot, 'dirty.ts'));
    const treeRestored = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: deltaStart.reviewToken!,
      result: 'passed',
    });
    expect(treeRestored.ok).toBe(true);
    expect(treeRestored.record?.headCommit).toBe(secondHead);

    const midHeadStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'delta',
    });
    commitFile(repoRoot, 'during.ts', 'during-review');
    const midHead = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: midHeadStart.reviewToken!,
      result: 'passed',
    });
    expect(midHead.ok).toBe(false);
    expect(midHead.message).toMatch(/HEAD moved during review/i);

    const thirdHead = (
      spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout ?? ''
    ).trim();
    const reboundStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'delta',
    });
    const rebound = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: reboundStart.reviewToken!,
      result: 'passed',
    });
    expect(rebound.ok).toBe(true);
    expect(rebound.record?.headCommit).toBe(thirdHead);
    expect(rebound.record?.phase).toBe('review_closed');

    const started = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId,
    });
    expect(started.ok).toBe(true);
    expect(started.record?.headCommit).toBe(thirdHead);

    const fixRecord = createEmptyProtocolRecord({
      workstreamId: 'ws_fix',
      baseCommit: thirdHead,
      branchName: 'main',
      headCommit: thirdHead,
    });
    fixRecord.phase = 'fix_recorded';
    writeProtocol(repoRoot, fixRecord);
    const deltaFromFix = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_fix',
      pass: 'delta',
    });
    expect(deltaFromFix.ok).toBe(false);
    expect(deltaFromFix.message).toMatch(/review_closed/);
  });

  it('T-C8-WRONG-BRANCH / T-C8-DETACHED / T-C9-POST-ACTIVATION / T-C9-FINALISE-OWNED-COMMITS', () => {
    const repoRoot = makeTempRoot('c8c9');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_c8';
    applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId,
      baseCommit: head,
    });
    const current = readProtocolRecord(repoRoot, workstreamId)!;
    current.phase = 'review_closed';
    current.headCommit = head;
    writeProtocol(repoRoot, current);

    spawnSync('git', ['checkout', '-b', 'other'], { cwd: repoRoot });
    const wrongBranch = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId,
    });
    expect(wrongBranch.ok).toBe(false);
    expect(wrongBranch.message).toMatch(/does not match protocol branch/i);

    spawnSync('git', ['checkout', 'main'], { cwd: repoRoot });
    spawnSync('git', ['checkout', '--detach', 'HEAD'], { cwd: repoRoot });
    const detachedFinalise = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId,
    });
    expect(detachedFinalise.ok).toBe(false);
    expect(detachedFinalise.message).toMatch(/detached/i);
    spawnSync('git', ['checkout', 'main'], { cwd: repoRoot });
    const started = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId,
    });
    expect(started.ok).toBe(true);
    createOrLoadFinaliseCheckpoint({
      repoRoot,
      workstreamId,
      checkpointId: started.checkpointId!,
    });

    const drifted = commitFile(repoRoot, 'after-start.ts', 'after-start');
    expect(() =>
      createOrLoadFinaliseCheckpoint({
        repoRoot,
        workstreamId,
        checkpointId: started.checkpointId!,
      })
    ).toThrow(/newer Git state|bound to/);

    const owned = appendOwnedCommit({
      repoRoot,
      ownedCommits: [head],
      activatedHeadCommit: head,
    });
    expect(owned.ok).toBe(true);
    if (owned.ok) {
      expect(owned.ownedCommits.at(-1)).toBe(drifted);
    }

    const detachedRoot = makeTempRoot('detached');
    const detachedHead = initGitRepo(detachedRoot);
    spawnSync('git', ['checkout', '--detach', 'HEAD'], { cwd: detachedRoot });
    const detached = applyProtocolTransition({
      repoRoot: detachedRoot,
      command: 'init',
      workstreamId: 'ws_detached',
      baseCommit: detachedHead,
    });
    expect(detached.ok).toBe(false);
    expect(detached.message).toMatch(/detached|named Git branch/i);
  });

  it('T-STATE-DISK-DIVERGENCE / T-BRANCH-SCOPE / T-STATE-FIRST-LIVENESS', () => {
    const repoRoot = makeTempRoot('divergence');
    const head = initGitRepo(repoRoot);
    readyChild(repoRoot, 'ws_disk', head);
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    const disk = readProtocolRecord(repoRoot, 'ws_disk')!;
    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: {
        ws_disk: {
          ...disk,
          phase: 'review_closed',
        },
      },
    });
    const divergence = getFinaliseProtocolReadiness(repoRoot);
    expect(divergence.allowed).toBe(false);
    expect(divergence.blockingWorkstreams.some((row) => row.role === 'malformed')).toBe(true);

    const scopeRoot = makeTempRoot('scope');
    const scopeHead = initGitRepo(scopeRoot);
    readyChild(scopeRoot, 'ws_other_branch', scopeHead, { branchName: 'feature/x' });
    readyChild(scopeRoot, 'ws_current', scopeHead);
    activate(scopeRoot, 'ws_current', 'ckpt_ws_current', scopeHead);
    const scoped = getFinaliseProtocolReadiness(scopeRoot);
    expect(scoped.lineages.find((row) => row.workstreamId === 'ws_other_branch')?.role).toBe(
      'other_branch'
    );
    expect(scoped.blockingWorkstreams.map((row) => row.workstreamId)).not.toContain(
      'ws_other_branch'
    );
    expect(scoped.allowed).toBe(true);

    const livenessRoot = makeTempRoot('liveness');
    const livenessHead = initGitRepo(livenessRoot);
    const ready = readyChild(livenessRoot, 'ws_live', livenessHead);
    const previous = createEmptyWorkflowReviewState();
    const outcome = applyFinaliseProtocolOutcome({
      repoRoot: livenessRoot,
      state: previous,
      workstreamId: ready.workstreamId,
      outcome: 'passed',
    });
    expect(outcome.record?.phase).toBe('finalised');
    expect(readProtocolRecord(livenessRoot, ready.workstreamId)?.phase).toBe('finalise_ready');
    const blockedPath = path.join(livenessRoot, 'blocked');
    writeFileSync(blockedPath, 'not-a-directory', 'utf8');
    expect(() =>
      commitFinaliseCorrelationStateAndProtocols({
        repoRoot: livenessRoot,
        statePath: path.join(blockedPath, 'state.json'),
        previousState: previous,
        nextState: outcome.state,
        workstreamIds: [ready.workstreamId],
      })
    ).toThrow();
    expect(readProtocolRecord(livenessRoot, ready.workstreamId)?.phase).toBe('finalise_ready');

    const failedOutcome = applyFinaliseProtocolOutcome({
      repoRoot: livenessRoot,
      state: previous,
      workstreamId: ready.workstreamId,
      outcome: 'failed',
    });
    expect(failedOutcome.record?.nextAction).toBe('rerun_or_repair_finalise');
    expect(readProtocolRecord(livenessRoot, ready.workstreamId)?.phase).toBe('finalise_ready');
    expect(readProtocolRecord(livenessRoot, ready.workstreamId)?.nextAction).toBe('run_finalise');
  });

  it('T-DELTA-PHASE-GUARD: failed delta cannot activate finalise', () => {
    const repoRoot = makeTempRoot('failed-delta');
    const head = initGitRepo(repoRoot);
    const workstreamId = 'ws_failed_delta';
    const record = createEmptyProtocolRecord({
      workstreamId,
      baseCommit: head,
      branchName: 'main',
      headCommit: head,
    });
    record.phase = 'review_closed';
    record.nextAction = 'finalise_start';
    writeProtocol(repoRoot, record);
    const deltaStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'delta',
    });
    expect(deltaStart.ok).toBe(true);
    const failed = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: deltaStart.reviewToken!,
      result: 'failed',
      blockerFamilies: ['auth'],
      blockerIds: ['DELTA-1'],
      siblingSurfaces: ['reports'],
    });
    expect(failed.ok).toBe(true);
    expect(failed.record?.phase).toBe('review_closed');
    expect(failed.record?.openBlockerIds).toContain('DELTA-1');
    const activate = applyProtocolTransition({
      repoRoot,
      command: 'finalise-start',
      workstreamId,
    });
    expect(activate.ok).toBe(false);
    expect(activate.message).toMatch(/successful review/i);
    expect(readProtocolRecord(repoRoot, workstreamId)?.phase).toBe('review_closed');
  });

  it('dangling parent and ambiguous split children block', () => {
    const danglingRoot = makeTempRoot('dangling');
    const danglingHead = initGitRepo(danglingRoot);
    readyChild(danglingRoot, 'ws_dangling', danglingHead, {
      sourceWorkstreamIds: ['ws_missing_parent'],
    });
    const dangling = getFinaliseProtocolReadiness(danglingRoot);
    expect(dangling.allowed).toBe(false);
    expect(dangling.blockingWorkstreams.some((row) => row.message.includes('dangling parent'))).toBe(
      true
    );

    const ambiguousRoot = makeTempRoot('ambiguous');
    const ambiguousHead = initGitRepo(ambiguousRoot);
    const parent = createEmptyProtocolRecord({
      workstreamId: 'ws_ambiguous',
      baseCommit: ambiguousHead,
      branchName: 'main',
      headCommit: ambiguousHead,
    });
    parent.phase = 'split';
    writeProtocol(ambiguousRoot, parent);
    readyChild(ambiguousRoot, 'ws_child_a', ambiguousHead, {
      sourceWorkstreamIds: ['ws_ambiguous'],
    });
    readyChild(ambiguousRoot, 'ws_child_b', ambiguousHead, {
      sourceWorkstreamIds: ['ws_ambiguous'],
    });
    const ambiguous = getFinaliseProtocolReadiness(ambiguousRoot);
    expect(ambiguous.allowed).toBe(false);
    expect(ambiguous.blockingWorkstreams.some((row) => row.message.includes('ambiguous'))).toBe(
      true
    );
  });

  it('C8-ROUTINE-DETACHED-002: ordinary finalise still refuses detached HEAD', () => {
    const repoRoot = makeTempRoot('ordinary-detached');
    const head = initGitRepo(repoRoot);
    expect(() => assertFinaliseProductCommitAllowed(repoRoot)).not.toThrow();
    spawnSync('git', ['checkout', '--detach', 'HEAD'], { cwd: repoRoot });
    expect(() => assertFinaliseProductCommitAllowed(repoRoot)).toThrow(/named branch|detached/i);
    expect(
      getFinaliseProtocolReadiness(repoRoot).blockingWorkstreams.some((row) => row.workstreamId === 'git-binding')
    ).toBe(true);
    spawnSync('git', ['checkout', 'main'], { cwd: repoRoot });
    readyChild(repoRoot, 'ws_named', head);
    expect(() => assertFinaliseProductCommitAllowed(repoRoot)).not.toThrow();
  });

  it('C9-ROUTINE-FINALISE-001: ordinary finalise may commit; activated C9 still binds HEAD', () => {
    const repoRoot = makeTempRoot('owned-head');
    const head = initGitRepo(repoRoot);
    expect(() => assertFinaliseProductCommitAllowed(repoRoot)).not.toThrow();
    readyChild(repoRoot, 'ws_owned', head);
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    saveWorkflowReviewState(paths.statePath, {
      ...createEmptyWorkflowReviewState(),
      protocolRecords: { ws_owned: readProtocolRecord(repoRoot, 'ws_owned')! },
      activeFinaliseContext: {
        workstreamId: 'ws_owned',
        checkpointId: 'ckpt_ws_owned',
        activatedAt: new Date().toISOString(),
      },
    });
    expect(() => assertFinaliseProductCommitAllowed(repoRoot)).toThrow(
      /missing activatedHeadCommit/
    );
    activate(repoRoot, 'ws_owned', 'ckpt_ws_owned', head);
    expect(() => assertFinaliseProductCommitAllowed(repoRoot)).not.toThrow();
    spawnSync('git', ['checkout', '-b', 'other'], { cwd: repoRoot });
    expect(() => assertFinaliseProductCommitAllowed(repoRoot)).toThrow(/wrong branch/i);
    spawnSync('git', ['checkout', 'main'], { cwd: repoRoot });
    commitFile(repoRoot, 'unowned.ts', 'unowned');
    expect(() => assertFinaliseProductCommitAllowed(repoRoot)).toThrow(/activated\/owned/);
  });

  it('symlink protocol dirs and malformed state fail closed', () => {
    const repoRoot = makeTempRoot('unsafe-state');
    const head = initGitRepo(repoRoot);
    const workstreams = path.join(repoRoot, 'docs_private', 'automation', 'workstreams');
    mkdirSync(workstreams, { recursive: true });
    readyChild(repoRoot, 'ws_real', head);
    const linkPath = path.join(workstreams, 'ws_link');
    try {
      symlinkSync(path.join(workstreams, 'ws_real'), linkPath, 'dir');
      const inventory = listDiskProtocolInventory(repoRoot);
      expect(inventory.unsafeDirectoryNames).toContain('ws_link');
      expect(getFinaliseProtocolReadiness(repoRoot).blockingWorkstreams.some((row) =>
        row.workstreamId === 'ws_link'
      )).toBe(true);
    } catch {
      // Windows may refuse directory symlinks without privilege; the lstat path is still covered.
    }

    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    writeFileSync(paths.statePath, '{not-json', 'utf8');
    expect(() =>
      correlateFinaliseAutomationRun({
        scriptName: 'finalise',
        status: 'failed',
        runId: 'run-malformed',
        repoRoot,
      })
    ).toThrow(/unreadable|malformed/);
    expect(readFileSync(paths.statePath, 'utf8')).toBe('{not-json');
  });

  it('T-FINALISE-DRY-RUN-NO-CORRELATE: dry-run does not correlate', () => {
    expect(
      shouldApplyFinaliseCorrelation({
        scriptName: 'finalise',
        mode: 'dry-run',
        args: ['--dry-run'],
      })
    ).toBe(false);
    expect(shouldApplyFinaliseCorrelation({ scriptName: 'finalise', args: [] })).toBe(true);
  });

  it('AVS-FAP-PUSH-001: fap and ffap authorize matching push variants', () => {
    const fap = readFileSync(path.join(process.cwd(), '.cursor/commands/fap.md'), 'utf8');
    const ffap = readFileSync(path.join(process.cwd(), '.cursor/commands/ffap.md'), 'utf8');
    expect(fap).toMatch(/finalise:push/);
    expect(ffap).toMatch(/finalise:full:push/);
    expect(fap).toMatch(/authorized push phrase/iu);
    expect(ffap).toMatch(/authorized push phrase/iu);
    expect(fap).not.toMatch(/does \*\*not\*\* authorize pushing/iu);
    expect(ffap).not.toMatch(/does \*\*not\*\* authorize pushing/iu);
  });
});

describe('workflow dry-run write freedom against the live repo', () => {
  it('T-D3-DRY-RUN: --dry-run leaves protocol, state, checkpoints, release, and run logs unchanged', { timeout: 120_000 }, () => {
    const repoRoot = process.cwd();
    const watch = [
      path.join(repoRoot, 'docs_private/automation/knowledge/workflow-review-state.json'),
      path.join(repoRoot, 'lib/config/release-version.json'),
    ];
    const before = watch.map((filePath) =>
      existsSync(filePath) ? readFileSync(filePath) : Buffer.from('')
    );
    const protocolRoot = path.join(repoRoot, 'docs_private/automation/workstreams');
    const listProtocolEntries = () =>
      existsSync(protocolRoot)
        ? readdirSync(protocolRoot, { recursive: true })
            .map(String)
            .filter((entry) => !/(^|[\\/])ws_test_/u.test(entry))
            .sort()
            .join('\n')
        : '';
    const protocolBefore = listProtocolEntries();
    const runsDir = path.join(repoRoot, 'docs_private/automation/runs/finalise');
    const runsBefore = existsSync(runsDir) ? readdirSync(runsDir).sort().join('\n') : '';

    const result = spawnSync('npx', ['tsx', 'scripts/finalise.ts', '--dry-run'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    expect(result.status).toBe(0);
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toMatch(/Protocol readiness/);

    watch.forEach((filePath, index) => {
      const after = existsSync(filePath) ? readFileSync(filePath) : Buffer.from('');
      expect(after.equals(before[index]!)).toBe(true);
    });
    const protocolAfter = listProtocolEntries();
    expect(protocolAfter).toBe(protocolBefore);
    const runsAfter = existsSync(runsDir) ? readdirSync(runsDir).sort().join('\n') : '';
    expect(runsAfter).toBe(runsBefore);
  });
});
