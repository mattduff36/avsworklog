import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProtocolTransition,
  readProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import { TRUSTED_LEGACY_RELEASE_SHA } from '@/scripts/automation/legacy-reconciliation-registry';
import {
  defaultGitCommandRunner,
  rejectFalseAbsentRemovedFromRelease,
  revalidateRouteDisposition,
  TRUSTED_RELEASE_ENGINE_IDENTITY_PATHS,
  type GitCommandResult,
  type GitCommandRunner,
} from '@/scripts/automation/workflow-v24-disposition';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  failFirstThenClosure,
  initGitRepo,
  initWorkstream,
  makeTempRoot,
} from '@/tests/unit/workflow-v24-test-harness';

const REAL_REPO = process.cwd();

afterEach(async () => {
  cleanupWorkflowV24Fixtures();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

function gitResult(
  partial: Partial<GitCommandResult> & Pick<GitCommandResult, 'status'>
): GitCommandResult {
  return {
    stdout: '',
    stderr: '',
    ...partial,
  };
}

function gitWithOverrides(
  overrides: Array<{
    match: (args: string[]) => boolean;
    result?: GitCommandResult;
    throwError?: Error;
  }>
): GitCommandRunner {
  return (repoRoot, args) => {
    for (const override of overrides) {
      if (!override.match(args)) continue;
      if (override.throwError) throw override.throwError;
      if (!override.result) throw new Error('override missing result');
      return override.result;
    }
    return defaultGitCommandRunner(repoRoot, args);
  };
}

describe('T-FA-EVIDENCE-MATRIX fail-closed removed_from_release', { timeout: 40_000 }, () => {
  it('T-FA-MISSING-ORIGIN-001', () => {
    const git = gitWithOverrides([
      {
        match: (args) => args.includes('refs/remotes/origin/main'),
        result: gitResult({ status: 1, stderr: 'unknown revision' }),
      },
    ]);
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      defaultGitCommandRunner(REAL_REPO, ['rev-parse', 'HEAD']).stdout.trim(),
      undefined,
      git,
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/origin\/main is missing/);
  });

  it('T-FA-UNREADABLE-ORIGIN-002', () => {
    const git = gitWithOverrides([
      {
        match: (args) => args.includes('refs/remotes/origin/main'),
        result: gitResult({ status: null, error: new Error('origin spawn failed') }),
      },
    ]);
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      defaultGitCommandRunner(REAL_REPO, ['rev-parse', 'HEAD']).stdout.trim(),
      undefined,
      git,
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/unreadable/);
  });

  it('T-FA-MISSING-TRUSTED-003 / T-FA-TEMP-PROVEN-ABSENT / T-FA-PROVEN-ABSENT-007', () => {
    const repoRoot = makeTempRoot('fa-temp');
    const baseline = initGitRepo(repoRoot);
    const impl = commitFile(repoRoot, 'impl.ts', 'impl');
    const noProof = rejectFalseAbsentRemovedFromRelease(repoRoot, baseline);
    expect(noProof.ok).toBe(false);
    const proven = rejectFalseAbsentRemovedFromRelease(
      repoRoot,
      baseline,
      undefined,
      undefined,
      [impl]
    );
    expect(proven.ok, proven.ok ? '' : proven.message).toBe(true);
  });

  it('T-FA-UNRESOLVED-IDENTITY-004', () => {
    const git = gitWithOverrides([
      {
        match: (args) => args[0] === 'ls-tree',
        result: gitResult({ status: null, error: new Error('ls-tree spawn failed') }),
      },
    ]);
    const head = defaultGitCommandRunner(REAL_REPO, ['rev-parse', 'HEAD']).stdout.trim();
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      head,
      undefined,
      git,
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/engine identity is unreadable/);
  });

  it('T-FA-GIT-ERROR-005', () => {
    const git = gitWithOverrides([
      {
        match: (args) => args.includes(`${TRUSTED_LEGACY_RELEASE_SHA}^{commit}`),
        throwError: new Error('trusted sha resolution threw'),
      },
    ]);
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      defaultGitCommandRunner(REAL_REPO, ['rev-parse', 'HEAD']).stdout.trim(),
      undefined,
      git,
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/unreadable|threw/);
  });

  it('T-FA-AMBIGUOUS-006', () => {
    const originAmbiguous = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      defaultGitCommandRunner(REAL_REPO, ['rev-parse', 'HEAD']).stdout.trim(),
      'not-a-sha',
      undefined,
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(originAmbiguous.ok).toBe(false);
    if (!originAmbiguous.ok) expect(originAmbiguous.message).toMatch(/ambiguous/);

    const firstPath = TRUSTED_RELEASE_ENGINE_IDENTITY_PATHS[0];
    const git = gitWithOverrides([
      {
        match: (args) => args[0] === 'ls-tree' && args.includes(firstPath),
        result: gitResult({ status: 0, stdout: `${firstPath}\n` }),
      },
      {
        match: (args) => args[0] === 'ls-tree',
        result: gitResult({ status: 0, stdout: '' }),
      },
    ]);
    const partial = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      defaultGitCommandRunner(REAL_REPO, ['rev-parse', 'HEAD']).stdout.trim(),
      undefined,
      git,
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.message).toMatch(/ambiguous/);
  });

  it('T-FA-LIVE-ENGINE-008', () => {
    const head = defaultGitCommandRunner(REAL_REPO, ['rev-parse', 'HEAD']).stdout.trim();
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      head,
      undefined,
      undefined,
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/false-absent/);
  });

  it('T-FA-REVALIDATION / T-FA-PROVEN-ABSENT-007', () => {
    const repoRoot = makeTempRoot('fa-revalidate');
    const baseline = initGitRepo(repoRoot);
    const impl = commitFile(repoRoot, 'impl.ts', 'impl');
    initWorkstream(repoRoot, 'ws_fa_route', baseline);
    failFirstThenClosure(repoRoot, 'ws_fa_route');
    const reset = defaultGitCommandRunner(repoRoot, ['reset', '--hard', baseline]);
    expect(reset.status).toBe(0);
    const removed = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fa_route',
      disposition: 'removed_from_release',
      reason: 'implementation no longer in HEAD ancestry',
      implementationCommits: [impl],
    });
    expect(removed.ok, removed.message).toBe(true);
    const record = readProtocolRecord(repoRoot, 'ws_fa_route')!;
    expect(revalidateRouteDisposition({ repoRoot, record }).ok).toBe(true);
    const unavailable = revalidateRouteDisposition({
      repoRoot,
      record,
      git: () => gitResult({ status: null, error: new Error('git unavailable') }),
    });
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.message).toMatch(/no longer holds|unreadable|unable/);
  });
});
