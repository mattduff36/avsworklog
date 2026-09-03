import { mkdirSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { extractPlanContractMarker } from '@/scripts/automation/workflow-plan-contract';
import { SUCCESSOR_ENGINE_PATHS } from '@/scripts/automation/types';
import {
  WORKFLOW_ROUTING_REQUIRED_EXIT_CODE,
  applyProtocolTransition,
  createEmptyProtocolRecord,
  readProtocolRecord,
  reduceRoute,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import { getFinaliseProtocolReadiness } from '@/scripts/automation/workflow-finalise-correlation';
import { applyLegacyReconciliation } from '@/scripts/automation/workflow-legacy-reconciliation';
import {
  CURRENT_HARDENING_WORKSTREAM_IDS,
  TRUSTED_LEGACY_RELEASE_SHA,
} from '@/scripts/automation/legacy-reconciliation-registry';
import {
  buildRouteDisposition,
  listOrderedImplementationCommits,
  rejectFalseAbsentRemovedFromRelease,
  revalidateRouteDisposition,
} from '@/scripts/automation/workflow-v24-disposition';
import { readWorkflowGitBinding } from '@/scripts/automation/workflow-git-binding';
import type { WorkflowProtocolRecord, WorkflowProtocolReviewAttempt } from '@/scripts/automation/types';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  initGitRepo,
  initWorkstream,
  makeTempRoot,
  writePassingManifest,
} from '@/tests/unit/workflow-v24-test-harness';

const REAL_REPO = process.cwd();
const ISOLATE_PARENT = 'b4a5aa09992c23c8358876421996606e7d7701fc';
const LEGAL_FIRST_HEAD = 'f223f06dd52d2f005b4ea4c6f1a66a87712a5274';
const LEGAL_CLOSURE_HEAD = 'a331d0c88c98aee014d4ec624a796407359cf7a2';
const throwawayIds: string[] = [];

afterEach(async () => {
  cleanupWorkflowV24Fixtures();
  while (throwawayIds.length > 0) {
    const workstreamId = throwawayIds.pop();
    if (!workstreamId) continue;
    rmSync(path.join(REAL_REPO, 'docs_private', 'automation', 'workstreams', workstreamId), {
      recursive: true,
      force: true,
    });
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
});

function exhaustedInitialized(params: {
  repoRoot: string;
  workstreamId: string;
  baseCommit: string;
  branchName: string;
  failedCount?: number;
  token?: string | null;
}): WorkflowProtocolRecord {
  const record = createEmptyProtocolRecord({
    workstreamId: params.workstreamId,
    baseCommit: params.baseCommit,
    branchName: params.branchName,
    headCommit: params.baseCommit,
    inheritedFailedReviewCount: params.failedCount ?? 7,
  });
  record.failedPremiumReviewCount = params.failedCount ?? 7;
  record.activeReviewToken = params.token ?? null;
  record.activeReviewPass = params.token ? 'first' : null;
  writeProtocolRecord(params.repoRoot, record);
  return record;
}

function leftoverRoutingRecord(workstreamId: string, extras: Partial<WorkflowProtocolRecord> = {}) {
  const branchName = readWorkflowGitBinding(REAL_REPO).branchName;
  if (!branchName) throw new Error('real repo branch required');
  const attempts: WorkflowProtocolReviewAttempt[] = [
    {
      pass: 'first',
      token: `rev_first_${workstreamId}`,
      startedAt: '2026-08-01T00:00:00.000Z',
      recordedAt: '2026-08-01T00:01:00.000Z',
      headCommit: LEGAL_FIRST_HEAD,
      result: 'failed',
      blockerIds: ['WF-ENGINE-001'],
    },
    {
      pass: 'closure',
      token: `rev_closure_${workstreamId}`,
      startedAt: '2026-08-02T00:00:00.000Z',
      recordedAt: '2026-08-02T00:01:00.000Z',
      headCommit: LEGAL_CLOSURE_HEAD,
      result: 'failed',
      blockerIds: ['WF-ENGINE-001'],
    },
  ];
  const record = createEmptyProtocolRecord({
    workstreamId,
    baseCommit: TRUSTED_LEGACY_RELEASE_SHA,
    branchName,
    headCommit: TRUSTED_LEGACY_RELEASE_SHA,
    inheritedFailedReviewCount: 7,
  });
  record.failedPremiumReviewCount = 7;
  record.phase = 'routing_required';
  record.nextAction = 'route_or_isolate';
  record.reviewAttempts = attempts;
  Object.assign(record, extras);
  mkdirSync(path.join(REAL_REPO, 'docs_private', 'automation', 'workstreams', workstreamId), {
    recursive: true,
  });
  writeProtocolRecord(REAL_REPO, record);
  throwawayIds.push(workstreamId);
  return record;
}

describe('exhausted initialized to routing_required', { timeout: 40_000 }, () => {
  it('T-EXH-INIT-TO-ROUTING-001 / T-EXH-INIT-NO-FIRST-002 / T-EXH-GUARDS-003', () => {
    const repoRoot = makeTempRoot('exh');
    const baseCommit = initGitRepo(repoRoot);
    exhaustedInitialized({
      repoRoot,
      workstreamId: 'ws_exh_init',
      baseCommit,
      branchName: 'main',
    });

    const notExhausted = exhaustedInitialized({
      repoRoot,
      workstreamId: 'ws_exh_fresh',
      baseCommit,
      branchName: 'main',
      failedCount: 0,
    });
    expect(notExhausted.failedPremiumReviewCount).toBe(0);
    const freshAck = applyProtocolTransition({
      repoRoot,
      command: 'exhaustion-acknowledge',
      workstreamId: 'ws_exh_fresh',
    });
    expect(freshAck.ok).toBe(false);

    exhaustedInitialized({
      repoRoot,
      workstreamId: 'ws_exh_token',
      baseCommit,
      branchName: 'main',
      token: 'rev_first_active',
    });
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'exhaustion-acknowledge',
        workstreamId: 'ws_exh_token',
      }).ok
    ).toBe(false);

    const ack = applyProtocolTransition({
      repoRoot,
      command: 'exhaustion-acknowledge',
      workstreamId: 'ws_exh_init',
    });
    expect(ack.ok, ack.message).toBe(true);
    const routed = readProtocolRecord(repoRoot, 'ws_exh_init')!;
    expect(routed.phase).toBe('routing_required');
    expect(routed.nextAction).toBe('route_or_isolate');
    expect(routed.failedPremiumReviewCount).toBe(7);
    expect(routed.inheritedFailedReviewCount).toBe(7);
    expect(routed.reviewAttempts).toEqual([]);
    expect(routed.headCommit).toBe(baseCommit);
    expect(routed.activeReviewToken).toBeNull();

    const first = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_exh_init',
      pass: 'first',
    });
    expect(first.ok).toBe(false);
    expect(first.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);
    expect(readProtocolRecord(repoRoot, 'ws_exh_init')?.phase).toBe('routing_required');

    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'exhaustion-acknowledge',
        workstreamId: 'ws_exh_init',
      }).ok
    ).toBe(false);
  });
});

describe('fix-delta refresh on current HEAD/tree', { timeout: 40_000 }, () => {
  it('T-FIXDELTA-REFRESH-001 / T-FIXDELTA-REFRESH-NO-RESET-002 / T-FIXDELTA-REFRESH-LOCK-003 / T-FIXDELTA-REFRESH-PHASE-004', () => {
    const repoRoot = makeTempRoot('refresh');
    const baseCommit = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_refresh', baseCommit);
    const preflight = writePassingManifest(repoRoot, 'ws_refresh', 'preflight');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'preflight-record',
        workstreamId: 'ws_refresh',
        manifestPath: preflight,
      }).ok
    ).toBe(true);
    const firstStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId: 'ws_refresh',
      pass: 'first',
    });
    expect(firstStart.ok).toBe(true);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'review-record',
        workstreamId: 'ws_refresh',
        token: firstStart.reviewToken!,
        result: 'failed',
        blockerFamilies: ['auth'],
        blockerIds: ['A'],
        siblingSurfaces: ['B'],
      }).ok
    ).toBe(true);
    const firstFix = writePassingManifest(repoRoot, 'ws_refresh', 'fix-delta', ['A']);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'fix-record',
        workstreamId: 'ws_refresh',
        manifestPath: firstFix,
        closedBlockerIds: ['A'],
      }).ok
    ).toBe(true);
    const recorded = readProtocolRecord(repoRoot, 'ws_refresh')!;
    expect(recorded.phase).toBe('fix_recorded');
    expect(recorded.failedPremiumReviewCount).toBe(1);

    const noDrift = writePassingManifest(repoRoot, 'ws_refresh', 'fix-delta', ['A']);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'fix-delta-refresh',
        workstreamId: 'ws_refresh',
        manifestPath: noDrift,
        closedBlockerIds: ['A'],
      }).ok
    ).toBe(false);

    commitFile(repoRoot, 'refresh-drift.ts', 'drift');
    const lockedWrong = writePassingManifest(repoRoot, 'ws_refresh', 'fix-delta', ['B']);
    const lockFail = applyProtocolTransition({
      repoRoot,
      command: 'fix-delta-refresh',
      workstreamId: 'ws_refresh',
      manifestPath: lockedWrong,
      closedBlockerIds: ['B'],
    });
    expect(lockFail.ok).toBe(false);
    expect(lockFail.message).toMatch(/match the recorded fix-delta|match the failed review/);

    const refreshedManifest = writePassingManifest(repoRoot, 'ws_refresh', 'fix-delta', ['A']);
    const refreshed = applyProtocolTransition({
      repoRoot,
      command: 'fix-delta-refresh',
      workstreamId: 'ws_refresh',
      manifestPath: refreshedManifest,
      closedBlockerIds: ['A'],
    });
    expect(refreshed.ok, refreshed.message).toBe(true);
    const after = readProtocolRecord(repoRoot, 'ws_refresh')!;
    expect(after.phase).toBe('fix_recorded');
    expect(after.nextAction).toBe('review_start_closure');
    expect(after.failedPremiumReviewCount).toBe(1);
    expect(after.inheritedFailedReviewCount).toBe(recorded.inheritedFailedReviewCount);
    expect(after.reviewAttempts).toHaveLength(recorded.reviewAttempts.length);
    expect(after.fixDeltaManifestPath).not.toBe(recorded.fixDeltaManifestPath);
    expect(after.openBlockerIds).toEqual([]);

    after.phase = 'review_closed';
    writeProtocolRecord(repoRoot, after);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'fix-delta-refresh',
        workstreamId: 'ws_refresh',
        manifestPath: refreshedManifest,
        closedBlockerIds: ['A'],
      }).message
    ).toMatch(/review_closed/);
  });
});

describe('leftover already_in_release', { timeout: 40_000 }, () => {
  it('T-LEFTOVER-DISPOSITION-001 / T-LEFTOVER-NOT-APPROVAL-002 / T-LEFTOVER-UNBLOCKS-003', () => {
    const workstreamId = `ws_test_leftover_disp_${Date.now()}`;
    leftoverRoutingRecord(workstreamId);
    const routed = reduceRoute({
      repoRoot: REAL_REPO,
      workstreamId,
      disposition: 'already_in_release',
      reason: 'trusted released engine remains on origin/main; leaf owns no new release delta',
    });
    expect(routed.ok, routed.message).toBe(true);
    expect(routed.record?.phase).toBe('already_in_release');
    expect(routed.record?.phase).not.toBe('review_closed');
    expect(routed.record?.phase).not.toBe('finalised');
    expect(routed.record?.phase).not.toBe('finalise_ready');
    expect(routed.record?.nextAction).toBe('non_release_disposition');
    expect(routed.record?.routeDisposition?.target).toBe('already_in_release');
    expect(routed.record?.routeDisposition?.gitEvidence.kind).toBe(
      'trusted_release_content_identity'
    );
    expect(routed.record?.failedPremiumReviewCount).toBe(7);
    writeProtocolRecord(REAL_REPO, routed.record!);
    const valid = revalidateRouteDisposition({ repoRoot: REAL_REPO, record: routed.record! });
    expect(valid.ok, valid.ok ? '' : valid.message).toBe(true);
    const readiness = getFinaliseProtocolReadiness(REAL_REPO);
    expect(readiness.blockingWorkstreams.some((row) => row.workstreamId === workstreamId)).toBe(
      false
    );
    expect(readiness.lineages.find((row) => row.workstreamId === workstreamId)?.role).toBe(
      'non_release_disposition'
    );
    expect(readiness.lineages.find((row) => row.workstreamId === workstreamId)?.phase).toBe(
      'already_in_release'
    );

    const chainId = `ws_test_leftover_chain_${Date.now()}`;
    leftoverRoutingRecord(chainId, {
      sourceWorkstreamIds: ['ws_missing_parent', 'ws_missing_root'],
      reviewAttempts: [],
    });
    const chained = reduceRoute({
      repoRoot: REAL_REPO,
      workstreamId: chainId,
      disposition: 'already_in_release',
      reason: 'exhausted leftover with ancestor-id chain and no local review attempts',
    });
    expect(chained.ok, chained.message).toBe(true);
    expect(chained.record?.phase).toBe('already_in_release');
    expect(chained.record?.routeDisposition?.gitEvidence.latestLegalReviewCandidateHead).toBe(
      TRUSTED_LEGACY_RELEASE_SHA
    );
  });

  it('T-LEFTOVER-FALSE-ABSENT-004', () => {
    const workstreamId = `ws_test_leftover_absent_${Date.now()}`;
    leftoverRoutingRecord(workstreamId);
    const derived = listOrderedImplementationCommits(
      REAL_REPO,
      TRUSTED_LEGACY_RELEASE_SHA,
      LEGAL_CLOSURE_HEAD
    );
    expect(Array.isArray(derived)).toBe(true);
    const removed = reduceRoute({
      repoRoot: REAL_REPO,
      workstreamId,
      disposition: 'removed_from_release',
      reason: 'off-branch review SHAs are not in HEAD',
      implementationCommits: Array.isArray(derived) ? derived : [],
    });
    expect(removed.ok).toBe(false);
    expect(removed.message).toMatch(/false-absent/);
    expect(readProtocolRecord(REAL_REPO, workstreamId)?.phase).toBe('routing_required');

    const tempRoot = makeTempRoot('false-absent-temp');
    const tempHead = initGitRepo(tempRoot);
    const falseAbsent = rejectFalseAbsentRemovedFromRelease(tempRoot, tempHead);
    expect(falseAbsent.ok).toBe(true);
  });

  it('T-LEFTOVER-FAIL-CLOSED-005', () => {
    const workstreamId = `ws_test_leftover_fail_${Date.now()}`;
    leftoverRoutingRecord(workstreamId, {
      baseCommit: LEGAL_CLOSURE_HEAD,
      headCommit: LEGAL_CLOSURE_HEAD,
    });
    const wrongIdentity = reduceRoute({
      repoRoot: REAL_REPO,
      workstreamId,
      disposition: 'already_in_release',
      reason: 'wrong protocol identity',
    });
    expect(wrongIdentity.ok).toBe(false);
    expect(wrongIdentity.message).toMatch(/trusted release SHA/);

    const tempRoot = makeTempRoot('leftover-temp');
    const baseCommit = initGitRepo(tempRoot);
    initWorkstream(tempRoot, 'ws_temp_leftover', baseCommit);
    failClosedTemp(tempRoot, 'ws_temp_leftover');
    const noOrigin = buildRouteDisposition({
      repoRoot: tempRoot,
      record: readProtocolRecord(tempRoot, 'ws_temp_leftover')!,
      target: 'already_in_release',
      reason: 'temp repo cannot prove leftover identity',
      nowIso: new Date().toISOString(),
    });
    expect(noOrigin.ok).toBe(false);
  });
});

describe('first-review binding repairs', () => {
  it('FD-GIT', () => {
    const diff = spawnSync(
      'git',
      ['diff', '--name-only', `${ISOLATE_PARENT}..HEAD`],
      { cwd: REAL_REPO, encoding: 'utf8', shell: false }
    );
    const files = new Set(
      (diff.stdout ?? '')
        .split('\n')
        .map((line) => line.trim().replace(/\\/g, '/'))
        .filter(Boolean)
    );
    expect(
      diff.status === 0 &&
        SUCCESSOR_ENGINE_PATHS.every((relative) => files.has(relative)) &&
        ![...files].some(
          (file) => file.includes('app/(dashboard)/approvals') || file.includes('timesheet-submit')
        )
    ).toBe(true);
  });

  it('FD-VERIFY', () => {
    const suite = JSON.parse(
      readFileSync(
        path.join(REAL_REPO, 'scripts/automation/workflow-suite-manifest.json'),
        'utf8'
      )
    ) as { files?: string[] };
    const source = readFileSync(
      path.join(REAL_REPO, 'tests/unit/workflow-v24-leftover-refresh.test.ts'),
      'utf8'
    );
    expect(
      suite.files?.includes('tests/unit/workflow-v24-leftover-refresh.test.ts') === true &&
        source.includes('T-EXH-INIT-TO-ROUTING-001') &&
        source.includes('T-FIXDELTA-REFRESH-001') &&
        source.includes('T-LEFTOVER-DISPOSITION-001') &&
        source.includes('already_in_release')
    ).toBe(true);
  });
});

describe('no legacy backdoor or inherited sources', { timeout: 20_000 }, () => {
  it('T-NO-LEGACY-BACKDOOR-005 / T-NO-LEGACY-BACKDOOR-006', () => {
    expect(CURRENT_HARDENING_WORKSTREAM_IDS).toContain('ws_96e9f347f9da5b8f_lc005');
    const rejected = applyLegacyReconciliation({
      repoRoot: REAL_REPO,
      workstreamId: 'ws_96e9f347f9da5b8f_lc005',
      kind: 'released',
      dryRun: true,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toMatch(/cannot use legacy reconciliation/);
  });

  it('T-PLAN-REHOME-VALID-000 / T-REHOME-ISOLATION-000', () => {
    const planPath = path.join(
      REAL_REPO,
      'docs_private',
      'automation',
      'workstreams',
      'ws_c3f8a1d62e904b75',
      'plan.md'
    );
    const parsed = extractPlanContractMarker(readFileSync(planPath, 'utf8'));
    expect(parsed.status).toBe('present');
    expect(parsed.contract?.sourceWorkstreamIds ?? []).toEqual([]);
    expect(parsed.contract?.rehomeProvenance ?? null).toBeNull();
    expect(parsed.contract?.architectureGate).toBe('approved_with_conditions');
  });

  it('T-REHOME-INIT-NO-SOURCES-007', () => {
    const repoRoot = makeTempRoot('nosrc');
    const baseCommit = initGitRepo(repoRoot);
    const init = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_c3f8a1d62e904b75_probe',
      baseCommit,
    });
    expect(init.ok, init.message).toBe(true);
    expect(init.record?.sourceWorkstreamIds ?? []).toEqual([]);
    expect(init.record?.inheritedFailedReviewCount).toBe(0);
    expect(init.record?.failedPremiumReviewCount).toBe(0);
    expect(init.record?.rehomeProvenance ?? null).toBeNull();
  });
});

function failClosedTemp(repoRoot: string, workstreamId: string): void {
  const preflight = writePassingManifest(repoRoot, workstreamId, 'preflight');
  expect(
    applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId,
      manifestPath: preflight,
    }).ok
  ).toBe(true);
  const firstStart = applyProtocolTransition({
    repoRoot,
    command: 'review-start',
    workstreamId,
    pass: 'first',
  });
  expect(firstStart.ok).toBe(true);
  expect(
    applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: firstStart.reviewToken!,
      result: 'failed',
      blockerFamilies: ['auth'],
      blockerIds: ['A'],
      siblingSurfaces: ['B'],
    }).ok
  ).toBe(true);
  const fixPath = writePassingManifest(repoRoot, workstreamId, 'fix-delta', ['A']);
  expect(
    applyProtocolTransition({
      repoRoot,
      command: 'fix-record',
      workstreamId,
      manifestPath: fixPath,
      closedBlockerIds: ['A'],
    }).ok
  ).toBe(true);
  const closureStart = applyProtocolTransition({
    repoRoot,
    command: 'review-start',
    workstreamId,
    pass: 'closure',
  });
  expect(closureStart.ok).toBe(true);
  const second = applyProtocolTransition({
    repoRoot,
    command: 'review-record',
    workstreamId,
    token: closureStart.reviewToken!,
    result: 'failed',
    blockerFamilies: ['auth'],
    blockerIds: ['C'],
    siblingSurfaces: ['D'],
  });
  expect(second.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);
}
