import { readFileSync } from 'fs';
import path from 'path';
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

function currentHead(): string {
  return defaultGitCommandRunner(REAL_REPO, ['rev-parse', 'HEAD']).stdout.trim();
}

describe('fail-closed removed_from_release', { timeout: 40_000 }, () => {
  it('T-FA-EVIDENCE-MATRIX', () => {
    const source = readFileSync(
      path.join(REAL_REPO, 'tests/unit/workflow-v24-false-absent.test.ts'),
      'utf8'
    );
    const ids = [
      'T-FA-MISSING-ORIGIN-001',
      'T-FA-UNREADABLE-ORIGIN-002',
      'T-FA-MISSING-TRUSTED-003',
      'T-FA-UNRESOLVED-IDENTITY-004',
      'T-FA-GIT-ERROR-005',
      'T-FA-AMBIGUOUS-006',
      'T-FA-PROVEN-ABSENT-007',
      'T-FA-LIVE-ENGINE-008',
      'T-FA-TEMP-PROVEN-ABSENT',
      'T-FA-REVALIDATION',
    ];
    expect(ids.every((id) => source.includes(`it('${id}'`))).toBe(true);
  });

  it('T-FA-MISSING-ORIGIN-001', () => {
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      currentHead(),
      undefined,
      gitWithOverrides([
        {
          match: (args) => args.includes('refs/remotes/origin/main'),
          result: gitResult({ status: 1, stderr: 'unknown revision' }),
        },
      ]),
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok === false && /origin\/main is missing/.test(result.message)).toBe(true);
  });

  it('T-FA-UNREADABLE-ORIGIN-002', () => {
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      currentHead(),
      undefined,
      gitWithOverrides([
        {
          match: (args) => args.includes('refs/remotes/origin/main'),
          result: gitResult({ status: null, error: new Error('origin spawn failed') }),
        },
      ]),
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok === false && /unreadable/.test(result.message)).toBe(true);
  });

  it('T-FA-MISSING-TRUSTED-003', () => {
    const repoRoot = makeTempRoot('fa-temp');
    const baseline = initGitRepo(repoRoot);
    const impl = commitFile(repoRoot, 'impl.ts', 'impl');
    const noProof = rejectFalseAbsentRemovedFromRelease(repoRoot, baseline);
    const proven = rejectFalseAbsentRemovedFromRelease(
      repoRoot,
      baseline,
      undefined,
      undefined,
      [impl]
    );
    expect(noProof.ok === false && proven.ok === true).toBe(true);
  });

  it('T-FA-TEMP-PROVEN-ABSENT', () => {
    const repoRoot = makeTempRoot('fa-temp-proven');
    const baseline = initGitRepo(repoRoot);
    const impl = commitFile(repoRoot, 'impl.ts', 'impl');
    const proven = rejectFalseAbsentRemovedFromRelease(
      repoRoot,
      baseline,
      undefined,
      undefined,
      [impl]
    );
    expect(proven.ok).toBe(true);
  });

  it('T-FA-UNRESOLVED-IDENTITY-004', () => {
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      currentHead(),
      undefined,
      gitWithOverrides([
        {
          match: (args) => args[0] === 'ls-tree',
          result: gitResult({ status: null, error: new Error('ls-tree spawn failed') }),
        },
      ]),
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok === false && /engine identity is unreadable/.test(result.message)).toBe(true);
  });

  it('T-FA-GIT-ERROR-005', () => {
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      currentHead(),
      undefined,
      gitWithOverrides([
        {
          match: (args) => args.includes(`${TRUSTED_LEGACY_RELEASE_SHA}^{commit}`),
          throwError: new Error('trusted sha resolution threw'),
        },
      ]),
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok === false && /unreadable|threw/.test(result.message)).toBe(true);
  });

  it('T-FA-AMBIGUOUS-006', () => {
    const supplied = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      currentHead(),
      'not-a-sha',
      undefined,
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    const firstPath = TRUSTED_RELEASE_ENGINE_IDENTITY_PATHS[0];
    const partial = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      currentHead(),
      undefined,
      gitWithOverrides([
        {
          match: (args) => args[0] === 'ls-tree' && args.includes(firstPath),
          result: gitResult({ status: 0, stdout: `${firstPath}\n` }),
        },
        {
          match: (args) => args[0] === 'ls-tree',
          result: gitResult({ status: 0, stdout: '' }),
        },
      ]),
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(
      supplied.ok === false &&
        /ambiguous|not a full commit SHA/.test(supplied.message) &&
        partial.ok === false &&
        /ambiguous/.test(partial.message)
    ).toBe(true);
  });

  it('T-FA-LIVE-ENGINE-008', () => {
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      currentHead(),
      undefined,
      undefined,
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok === false && /false-absent/.test(result.message)).toBe(true);
  });

  it('does not treat an unresolved trusted SHA as proof while origin still has the engine', () => {
    const result = rejectFalseAbsentRemovedFromRelease(
      REAL_REPO,
      currentHead(),
      undefined,
      gitWithOverrides([
        {
          match: (args) => args.includes(`${TRUSTED_LEGACY_RELEASE_SHA}^{commit}`),
          result: gitResult({ status: 1, stderr: 'fatal: Needed a single revision' }),
        },
      ]),
      [TRUSTED_LEGACY_RELEASE_SHA]
    );
    expect(result.ok === false && /false-absent|live workflow engine/.test(result.message)).toBe(
      true
    );
  });

  it('T-FA-PROVEN-ABSENT-007', () => {
    const repoRoot = makeTempRoot('fa-proven-route');
    const baseline = initGitRepo(repoRoot);
    const impl = commitFile(repoRoot, 'impl.ts', 'impl');
    initWorkstream(repoRoot, 'ws_fa_proven', baseline);
    failFirstThenClosure(repoRoot, 'ws_fa_proven');
    const reset = defaultGitCommandRunner(repoRoot, ['reset', '--hard', baseline]);
    const removed = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fa_proven',
      disposition: 'removed_from_release',
      reason: 'implementation no longer in HEAD ancestry',
      implementationCommits: [impl],
    });
    expect(reset.status === 0 && removed.ok === true).toBe(true);
  });

  it('T-FA-REVALIDATION', () => {
    const repoRoot = makeTempRoot('fa-revalidate');
    const baseline = initGitRepo(repoRoot);
    const impl = commitFile(repoRoot, 'impl.ts', 'impl');
    initWorkstream(repoRoot, 'ws_fa_route', baseline);
    failFirstThenClosure(repoRoot, 'ws_fa_route');
    defaultGitCommandRunner(repoRoot, ['reset', '--hard', baseline]);
    const removed = applyProtocolTransition({
      repoRoot,
      command: 'route',
      workstreamId: 'ws_fa_route',
      disposition: 'removed_from_release',
      reason: 'implementation no longer in HEAD ancestry',
      implementationCommits: [impl],
    });
    const record = readProtocolRecord(repoRoot, 'ws_fa_route')!;
    const valid = revalidateRouteDisposition({ repoRoot, record });
    const unavailable = revalidateRouteDisposition({
      repoRoot,
      record,
      git: () => gitResult({ status: null, error: new Error('git unavailable') }),
    });
    expect(
      removed.ok === true &&
        valid.ok === true &&
        unavailable.ok === false &&
        /no longer holds|unreadable|unable/.test(unavailable.ok ? '' : unavailable.message)
    ).toBe(true);
  });
});
