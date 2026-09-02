import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { expect } from 'vitest';
import { buildEvidenceManifest } from '@/scripts/automation/workflow-evidence-manifest';
import {
  WORKFLOW_ROUTING_REQUIRED_EXIT_CODE,
  applyProtocolTransition,
  readProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  computeGitPatchSha256,
  computeGitProductTreeFingerprint,
  listOrderedImplementationCommits,
} from '@/scripts/automation/workflow-v24-disposition';
import {
  captureVerificationIdentity,
  persistVerificationLedgerFromReporterFile,
  type VerificationLedgerReference,
} from '@/scripts/automation/workflow-verification-ledger';
import type { WorkflowRehomeProvenance } from '@/scripts/automation/types';

const tempRoots: string[] = [];

export function cleanupWorkflowV24Fixtures(): void {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root || !existsSync(root)) continue;
    const removed = spawnSync('rm', ['-rf', root], { encoding: 'utf8', shell: false });
    if (removed.status !== 0 && existsSync(root)) {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
}

export function makeTempRoot(label: string): string {
  const root = path.join(
    tmpdir(),
    `workflow-v24-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

export function git(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false });
  return (result.stdout ?? '').trim();
}

export function initGitRepo(repoRoot: string): string {
  writeFileSync(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
  spawnSync('git', ['init', '-b', 'main'], { cwd: repoRoot, shell: false });
  spawnSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repoRoot, shell: false });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.'], {
    cwd: repoRoot,
    shell: false,
  });
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
    { cwd: repoRoot, shell: false }
  );
  return git(repoRoot, ['rev-parse', 'HEAD']);
}

export function commitFile(repoRoot: string, fileName: string, message: string): string {
  writeFileSync(path.join(repoRoot, fileName), `${message}\n`, 'utf8');
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', fileName], {
    cwd: repoRoot,
    shell: false,
  });
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', message],
    { cwd: repoRoot, shell: false }
  );
  return git(repoRoot, ['rev-parse', 'HEAD']);
}

export function persistFixtureLedger(
  repoRoot: string,
  workstreamId: string,
  titles: string[],
  options: { status?: 'passed' | 'failed' | 'skipped' | 'todo'; file?: string } = {}
): VerificationLedgerReference {
  const identity = captureVerificationIdentity(repoRoot);
  expect(identity.ok).toBe(true);
  if (!identity.ok) throw new Error(identity.message);
  const file = options.file ?? 'tests/unit/fixture.test.ts';
  const status = options.status ?? 'passed';
  const reporter = {
    success: status === 'passed',
    testResults: [
      {
        name: path.join(repoRoot, file),
        assertionResults: titles.map((title) => ({
          ancestorTitles: [],
          fullName: title,
          title,
          status,
        })),
      },
    ],
  };
  const workstreamDir = path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    workstreamId
  );
  mkdirSync(workstreamDir, { recursive: true });
  const reporterPath = path.join(
    workstreamDir,
    `fixture-reporter-${randomBytes(8).toString('hex')}.json`
  );
  writeFileSync(reporterPath, JSON.stringify(reporter));
  const persisted = persistVerificationLedgerFromReporterFile({
    repoRoot,
    workstreamId,
    commandId: 'fixture-ledger',
    commandType: 'vitest_case',
    command: 'vitest',
    args: ['run'],
    cwd: repoRoot,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    exitCode: status === 'passed' ? 0 : 1,
    runnerName: 'vitest',
    runnerVersion: '3.2.4',
    reporterAbsolutePath: reporterPath,
    requiredIds: titles,
    persist: true,
    beforeIdentity: identity,
    afterIdentity: identity,
  });
  if (!persisted.ok) throw new Error(persisted.message);
  return persisted.reference;
}

export function writePassingManifest(
  repoRoot: string,
  workstreamId: string,
  kind: 'preflight' | 'fix-delta',
  closedBlockerIds?: string[]
): string {
  const protocol = readProtocolRecord(repoRoot, workstreamId);
  const verificationLedgerRefs =
    kind === 'fix-delta' && closedBlockerIds && closedBlockerIds.length > 0
      ? [persistFixtureLedger(repoRoot, workstreamId, closedBlockerIds)]
      : undefined;
  const built = buildEvidenceManifest({
    repoRoot,
    workstreamId,
    kind,
    baseCommit: protocol?.baseCommit ?? 'abc1234deadbeef',
    requiredTestIds: [],
    runChecks: false,
    closedBlockerIds,
    verificationLedgerRefs,
    commandResults: [
      {
        name: 'fixture',
        status: 'passed',
        exitCode: 0,
        durationMs: 1,
        summary: 'ok',
      },
    ],
  });
  expect(built.manifest.status).toBe('passed');
  return built.relativePath;
}

export function initWorkstream(repoRoot: string, workstreamId: string, baseCommit: string) {
  const result = applyProtocolTransition({
    repoRoot,
    command: 'init',
    workstreamId,
    baseCommit,
  });
  expect(result.ok).toBe(true);
  return result;
}

export function failFirstThenClosure(
  repoRoot: string,
  workstreamId: string,
  options: { commitFixBeforeClosure?: boolean } = {}
): void {
  const manifestPath = writePassingManifest(repoRoot, workstreamId, 'preflight');
  expect(
    applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId,
      manifestPath,
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
  if (options.commitFixBeforeClosure) {
    commitFile(repoRoot, `${workstreamId}_closure_fix.ts`, 'closure-fix');
  }
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
  const secondFail = applyProtocolTransition({
    repoRoot,
    command: 'review-record',
    workstreamId,
    token: closureStart.reviewToken!,
    result: 'failed',
    blockerFamilies: ['auth'],
    blockerIds: ['C'],
    siblingSurfaces: ['D'],
  });
  expect(secondFail.ok).toBe(false);
  expect(secondFail.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);
  expect(secondFail.record?.phase).toBe('routing_required');
}

export function exhaustSourceWorkstream(
  repoRoot: string,
  workstreamId: string,
  baseCommit: string
): void {
  initWorkstream(repoRoot, workstreamId, baseCommit);
  failFirstThenClosure(repoRoot, workstreamId, { commitFixBeforeClosure: true });
}

export function declaredRehome(
  baseCommit: string,
  branchName: string,
  predecessorHeadCommit = 'bca7afa3b34f98b3ddcaa1d7cfd18da8ca144e1a',
  predecessorReleaseContext = 'D:/Websites/avsworklog#main',
  extras: Partial<WorkflowRehomeProvenance> = {}
): WorkflowRehomeProvenance {
  return {
    schemaVersion: '1',
    status: 'declared',
    predecessorRootWorkstreamId: 'ws_96e9f347f9da5b8f',
    predecessorDescendantWorkstreamId: 'ws_96e9f347f9da5b8f_lc005',
    predecessorHeadCommit,
    predecessorReleaseContext,
    successorBranchName: branchName,
    successorBaselineCommit: baseCommit,
    sourcePatchSha256: extras.sourcePatchSha256 ?? 'b6f702708202edfdb10d73f69945f6b77c69b3402287011a747b2c6749a5f1a0',
    sourceProductTreeFingerprint:
      extras.sourceProductTreeFingerprint ??
      '6de6ce5e65258b15b98bfb8977590fae154083eff942cf09b4dc6091bd019019',
    predecessorHeadIsAncestor: false,
    predecessorPassedReview: false,
    ...extras,
  };
}

export function gitSourceEvidence(repoRoot: string, baseline: string, head: string) {
  const patch = computeGitPatchSha256(repoRoot, baseline, head);
  const fingerprint = computeGitProductTreeFingerprint(repoRoot, head);
  const commits = listOrderedImplementationCommits(repoRoot, baseline, head);
  if (typeof patch === 'object') throw new Error(patch.error);
  if (typeof fingerprint === 'object') throw new Error(fingerprint.error);
  if (!Array.isArray(commits)) throw new Error(commits.error);
  return { patch, fingerprint, commits };
}
