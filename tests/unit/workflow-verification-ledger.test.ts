import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEvidenceManifest } from '@/scripts/automation/workflow-evidence-manifest';
import {
  inspectCommitAncestry,
  isCommitAncestor,
  rejectUnreviewedHeadDrift,
  requireCommitNotAncestor,
  type GitCommandRunner,
} from '@/scripts/automation/workflow-v24-disposition';
import {
  BLOCKER_REQUIRED_TEST_IDS,
  captureVerificationIdentity,
  hashVerificationLedgerBody,
  persistVerificationLedgerFromReporterFile,
  proveCanonicalWorkflowSuite,
  provenVitestCaseIds,
  hashCanonicalWorkflowSuiteManifest,
  readAndValidateVerificationLedger,
  runVitestJsonAndPersistLedger,
  titleContainsExactRequiredId,
  type CanonicalWorkflowSuiteManifest,
  type VerificationLedgerCommandType,
  type VerificationLedgerReference,
} from '@/scripts/automation/workflow-verification-ledger';
import {
  cleanupWorkflowV24Fixtures,
  commitFile,
  git,
  initGitRepo,
  makeTempRoot,
} from '@/tests/unit/workflow-v24-test-harness';

const INSTALL_ROOT = path.resolve(__dirname, '..', '..');
const FAKE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function expectOk<T extends { ok: true } | { ok: false; message: string }>(
  result: T
): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(result.message);
  return result;
}

function writeVitestConfig(repoRoot: string): string {
  const configPath = path.join(repoRoot, 'vitest.config.mjs');
  writeFileSync(
    configPath,
    `export default { test: { include: ['**/*.test.ts'], globals: true, setupFiles: [] } };\n`,
    'utf8'
  );
  return configPath;
}

function persistSyntheticLedger(params: {
  repoRoot: string;
  workstreamId: string;
  titles: Array<{ title: string; status?: 'passed' | 'failed' | 'skipped' | 'todo'; file?: string }>;
  commandType?: VerificationLedgerCommandType;
  requiredIds?: string[];
  expectedSuiteManifestHash?: string;
  persist?: boolean;
}):
  | { ok: true; reference: VerificationLedgerReference; record: import('@/scripts/automation/workflow-verification-ledger').VerificationLedgerRecord }
  | { ok: false; message: string } {
  const identity = captureVerificationIdentity(params.repoRoot);
  if (!identity.ok) return identity;
  const byFile = new Map<string, typeof params.titles>();
  for (const row of params.titles) {
    const file = row.file ?? 'tests/unit/fixture.test.ts';
    const list = byFile.get(file) ?? [];
    list.push(row);
    byFile.set(file, list);
  }
  const reporter = {
    success: params.titles.every((row) => (row.status ?? 'passed') === 'passed'),
    testResults: [...byFile.entries()].map(([file, rows]) => ({
      name: path.join(params.repoRoot, file),
      assertionResults: rows.map((row) => ({
        ancestorTitles: [],
        fullName: row.title,
        title: row.title,
        status: row.status ?? 'passed',
      })),
    })),
  };
  const workstreamDir = path.join(
    params.repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    params.workstreamId
  );
  mkdirSync(workstreamDir, { recursive: true });
  const reporterPath = path.join(workstreamDir, `synthetic-reporter-${Date.now()}-${Math.random()}.json`);
  writeFileSync(reporterPath, JSON.stringify(reporter));
  return persistVerificationLedgerFromReporterFile({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    commandId: 'synthetic-ledger',
    commandType: params.commandType ?? 'vitest_case',
    command: 'vitest',
    args: ['run'],
    cwd: params.repoRoot,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    exitCode: reporter.success ? 0 : 1,
    runnerName: 'vitest',
    runnerVersion: '3.2.4',
    reporterAbsolutePath: reporterPath,
    requiredIds: params.requiredIds ?? params.titles.map((row) => row.title),
    expectedSuiteManifestHash: params.expectedSuiteManifestHash,
    persist: params.persist,
    beforeIdentity: identity,
    afterIdentity: identity,
  });
}

function prepareLiveVitestRoot(repoRoot: string): string {
  writeFileSync(
    path.join(repoRoot, '.gitignore'),
    ['node_modules/', '.vitest/', '.vite/', 'coverage/', '*.timestamp-*'].join('\n') + '\n',
    'utf8'
  );
  return writeVitestConfig(repoRoot);
}

function runLiveVitest(params: {
  repoRoot: string;
  workstreamId: string;
  files: string[];
  requiredIds?: string[];
  commandType?: VerificationLedgerCommandType;
  extraArgs?: string[];
  persist?: boolean;
  expectedSuiteManifestHash?: string;
}) {
  const configPath = prepareLiveVitestRoot(params.repoRoot);
  return runVitestJsonAndPersistLedger({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    commandId: 'live-vitest',
    commandType: params.commandType ?? 'vitest_case',
    files: params.files,
    extraArgs: [
      '--config',
      configPath,
      '--root',
      params.repoRoot,
      ...(params.extraArgs ?? []),
    ],
    requiredIds: params.requiredIds,
    expectedSuiteManifestHash: params.expectedSuiteManifestHash,
    persist: params.persist,
    vitestInstallRoot: INSTALL_ROOT,
  });
}

describe('TEE V2.4 verification ledger', { timeout: 90_000 }, () => {
  it('T-LEDGER-SRC-NOT-EXECUTED: source titles are not execution proof', () => {
    const repoRoot = makeTempRoot('src-not-run');
    initGitRepo(repoRoot);
    mkdirSync(path.join(repoRoot, 'tests', 'unit'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, 'tests', 'unit', 'present.test.ts'),
      `import { it } from 'vitest';\nit('T-LEDGER-SRC-NOT-EXECUTED in source', () => {});\n`,
      'utf8'
    );
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_src',
      kind: 'preflight',
      baseCommit: git(repoRoot, ['rev-parse', 'HEAD']),
      requiredTestIds: ['T-LEDGER-SRC-NOT-EXECUTED'],
      runChecks: false,
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(built.manifest.requiredTests.find((test) => test.id === 'T-LEDGER-SRC-NOT-EXECUTED')?.executed).toBe(
      false
    );
    expect(built.manifest.status).toBe('failed');
  });

  it('T-LEDGER-FILTERED-NOT-PROVEN / T-LEDGER-EXACT-PASS-PROVEN: live Vitest proves only executed matches', () => {
    const repoRoot = makeTempRoot('live-filter');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'exact.test.ts'),
      `it('T-LEDGER-EXACT-PASS-PROVEN live', () => {});\n`,
      'utf8'
    );
    writeFileSync(
      path.join(repoRoot, 'filtered.test.ts'),
      `it('T-LEDGER-FILTERED-NOT-PROVEN live', () => {});\n`,
      'utf8'
    );
    const run = expectOk(
      runLiveVitest({
        repoRoot,
        workstreamId: 'ws_filter',
        files: ['exact.test.ts'],
        requiredIds: ['T-LEDGER-EXACT-PASS-PROVEN', 'T-LEDGER-FILTERED-NOT-PROVEN'],
      })
    );
    expect(run.record.executedTests.map((test) => test.title)).toEqual([
      'T-LEDGER-EXACT-PASS-PROVEN live',
    ]);
    const proof = provenVitestCaseIds({
      records: [run.record],
      requiredIds: ['T-LEDGER-EXACT-PASS-PROVEN', 'T-LEDGER-FILTERED-NOT-PROVEN'],
    });
    expect(proof.ok).toBe(true);
    expect(proof.provenIds).toEqual(['T-LEDGER-EXACT-PASS-PROVEN']);
  });

  it('T-LEDGER-SKIP-NOT-PROVEN / T-LEDGER-TODO-NOT-PROVEN / T-LEDGER-FAIL-NOT-PROVEN: non-pass statuses are not proof', () => {
    const repoRoot = makeTempRoot('live-status');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'status.test.ts'),
      `it.skip('T-LEDGER-SKIP-NOT-PROVEN skipped', () => {});
it.todo('T-LEDGER-TODO-NOT-PROVEN todo');
it('T-LEDGER-FAIL-NOT-PROVEN fails', () => { throw new Error('boom'); });
`,
      'utf8'
    );
    const run = expectOk(
      runLiveVitest({
      repoRoot,
      workstreamId: 'ws_status',
      files: ['status.test.ts'],
      requiredIds: [
        'T-LEDGER-SKIP-NOT-PROVEN',
        'T-LEDGER-TODO-NOT-PROVEN',
        'T-LEDGER-FAIL-NOT-PROVEN',
      ],
    })
    );
    const proof = provenVitestCaseIds({
      records: [run.record],
      requiredIds: [
        'T-LEDGER-SKIP-NOT-PROVEN',
        'T-LEDGER-TODO-NOT-PROVEN',
        'T-LEDGER-FAIL-NOT-PROVEN',
      ],
    });
    expect(proof.ok).toBe(true);
    expect(proof.provenIds).toEqual([]);
  });

  it('T-LEDGER-SIMILAR-TITLE-NO-CROSS: similar titles do not cross-map', () => {
    expect(titleContainsExactRequiredId('T-LEDGER-SIMILAR-TITLE-NO-CROSSING', 'T-LEDGER-SIMILAR-TITLE-NO-CROSS')).toBe(
      false
    );
    const repoRoot = makeTempRoot('similar');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'similar.test.ts'),
      `it('T-LEDGER-SIMILAR-TITLE-NO-CROSSING similar', () => {});\n`,
      'utf8'
    );
    const run = expectOk(
      runLiveVitest({
      repoRoot,
      workstreamId: 'ws_similar',
      files: ['similar.test.ts'],
      requiredIds: ['T-LEDGER-SIMILAR-TITLE-NO-CROSS'],
    })
    );
    const proof = provenVitestCaseIds({
      records: [run.record],
      requiredIds: ['T-LEDGER-SIMILAR-TITLE-NO-CROSS'],
    });
    expect(proof.provenIds).toEqual([]);
  });

  it('T-LEDGER-DUPLICATE-ID-FAIL-CLOSED: duplicate required IDs fail closed', () => {
    const repoRoot = makeTempRoot('dup');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'dup.test.ts'),
      `it('T-LEDGER-DUPLICATE-ID-FAIL-CLOSED first', () => {});
it('T-LEDGER-DUPLICATE-ID-FAIL-CLOSED second', () => {});
`,
      'utf8'
    );
    const run = runLiveVitest({
      repoRoot,
      workstreamId: 'ws_dup',
      files: ['dup.test.ts'],
      requiredIds: ['T-LEDGER-DUPLICATE-ID-FAIL-CLOSED'],
    });
    expect(run.ok).toBe(false);
    if (run.ok) {
      throw new Error(
        `duplicate ID should fail closed: ${JSON.stringify(run.record.executedTests)}`
      );
    }
    expect(run.message).toMatch(/multiple assertions|fail closed/i);
  });

  it('T-LEDGER-CHANGED-NOT-SUITE: changed-files ledgers cannot prove the canonical suite', () => {
    const repoRoot = makeTempRoot('changed-not-suite');
    initGitRepo(repoRoot);
    const manifest: CanonicalWorkflowSuiteManifest = {
      schemaVersion: '1',
      id: 'fixture-suite',
      files: ['a.test.ts'],
    };
    const persisted = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_changed',
      titles: [{ title: 'ok', file: 'a.test.ts' }],
      commandType: 'changed_files',
      requiredIds: [],
      expectedSuiteManifestHash: hashCanonicalWorkflowSuiteManifest(manifest),
    })
    );
    const proof = proveCanonicalWorkflowSuite({
      record: persisted.record,
      reporterSuccess: true,
      manifest,
    });
    expect(proof.ok).toBe(false);
  });

  it('T-LEDGER-PARTIAL-SUITE-NOT-PROVEN / T-LEDGER-FULL-SUITE-PROVEN / T-LEDGER-ZERO-TESTS-NOT-SUITE', () => {
    const repoRoot = makeTempRoot('suite');
    initGitRepo(repoRoot);
    writeFileSync(
      path.join(repoRoot, 'a.test.ts'),
      `it('suite a', () => {});\n`,
      'utf8'
    );
    writeFileSync(
      path.join(repoRoot, 'b.test.ts'),
      `it('suite b', () => {});\n`,
      'utf8'
    );
    const manifest: CanonicalWorkflowSuiteManifest = {
      schemaVersion: '1',
      id: 'fixture-suite',
      files: ['a.test.ts', 'b.test.ts'],
    };
    const expectedHash = hashCanonicalWorkflowSuiteManifest(manifest);

    const partial = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_suite',
      titles: [{ title: 'suite a', file: 'a.test.ts' }],
      commandType: 'vitest_suite',
      requiredIds: [],
      expectedSuiteManifestHash: expectedHash,
    })
    );
    expect(
      proveCanonicalWorkflowSuite({
        record: partial.record,
        reporterSuccess: true,
        manifest,
      }).ok
    ).toBe(false);

    const full = expectOk(
      runLiveVitest({
      repoRoot,
      workstreamId: 'ws_suite',
      files: ['a.test.ts', 'b.test.ts'],
      commandType: 'vitest_suite',
      requiredIds: [],
      expectedSuiteManifestHash: expectedHash,
    })
    );
    const suiteProof = proveCanonicalWorkflowSuite({
      record: full.record,
      reporterSuccess: full.reporterSuccess,
      manifest,
    });
    expect(suiteProof.ok, JSON.stringify({
      files: full.record.executedTests.map((test) => test.file),
      hash: full.record.expectedSuiteManifestHash,
      expectedHash,
      reporterSuccess: full.reporterSuccess,
      commandType: full.record.commandType,
      exitCode: full.record.exitCode,
      message: suiteProof.ok ? null : suiteProof.message,
    })).toBe(true);

    const zero = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_suite',
      titles: [],
      commandType: 'vitest_suite',
      requiredIds: [],
      expectedSuiteManifestHash: expectedHash,
    })
    );
    expect(
      proveCanonicalWorkflowSuite({
        record: zero.record,
        reporterSuccess: true,
        manifest,
      }).ok
    ).toBe(false);
  });

  it('T-FIXDELTA-NO-LEDGER / T-FIXDELTA-UNRELATED-TESTS / T-FIXDELTA-VALID-LEDGER', () => {
    const repoRoot = makeTempRoot('fixdelta');
    const head = initGitRepo(repoRoot);
    const noLedger = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_fix',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['A'],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(noLedger.manifest.status).toBe('failed');

    const unrelated = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_fix',
      titles: [{ title: 'OTHER-ID unrelated' }],
      requiredIds: ['OTHER-ID'],
    })
    );
    const unrelatedManifest = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_fix',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['A'],
      verificationLedgerRefs: [unrelated.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(unrelatedManifest.manifest.status).toBe('failed');

    const valid = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_fix',
      titles: [{ title: 'A proven' }],
      requiredIds: ['A'],
    })
    );
    const validManifest = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_fix',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['A'],
      verificationLedgerRefs: [valid.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(validManifest.manifest.status).toBe('passed');
    expect(validManifest.manifest.blockerEvidence?.[0]?.provenRequiredTestIds).toEqual(['A']);
  });

  it('T-FIXDELTA-WRONG-FINGERPRINT / T-FIXDELTA-STALE-AFTER-CHANGE / T-FIXDELTA-TAMPER-HASH', () => {
    const repoRoot = makeTempRoot('stale');
    initGitRepo(repoRoot);
    const persisted = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_stale',
      titles: [{ title: 'A proven' }],
      requiredIds: ['A'],
    })
    );

    const wrong = readAndValidateVerificationLedger({
      repoRoot,
      workstreamId: 'ws_stale',
      relativePath: persisted.reference.relativePath,
      expectedFingerprint: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      expectedHeadCommit: git(repoRoot, ['rev-parse', 'HEAD']),
    });
    expect(wrong.ok).toBe(false);

    commitFile(repoRoot, 'changed.ts', 'stale after change');
    const stale = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_stale',
      kind: 'fix-delta',
      baseCommit: git(repoRoot, ['rev-parse', 'HEAD']),
      runChecks: false,
      closedBlockerIds: ['A'],
      verificationLedgerRefs: [persisted.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(stale.manifest.status).toBe('failed');

    const ledgerPath = path.join(repoRoot, persisted.reference.relativePath);
    const parsed = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { contentHash: string; runId: string };
    parsed.runId = 'tampered';
    writeFileSync(ledgerPath, JSON.stringify(parsed));
    const tampered = readAndValidateVerificationLedger({
      repoRoot,
      workstreamId: 'ws_stale',
      relativePath: persisted.reference.relativePath,
      expectedFingerprint: persisted.record.productTreeFingerprint,
      expectedHeadCommit: persisted.record.headCommit,
    });
    expect(tampered.ok).toBe(false);
  });

  it('T-DRIFT-GIT-THROW / T-DRIFT-GIT-NONZERO / T-DRIFT-GIT-MALFORMED / T-DRIFT-GIT-SUCCESS', () => {
    const throwing: GitCommandRunner = () => {
      throw new Error('spawn failed');
    };
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, throwing).status).toBe('error');
    expect(() => isCommitAncestor('.', FAKE_A, FAKE_B, throwing)).toThrow(/spawn failed/);
    const thrown = rejectUnreviewedHeadDrift('.', FAKE_A, FAKE_B, throwing);
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) expect(thrown.kind).toBe('git-error');

    const nonzero: GitCommandRunner = () => ({
      status: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    });
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, nonzero).status).toBe('error');
    const nonzeroDrift = rejectUnreviewedHeadDrift('.', FAKE_A, FAKE_B, nonzero);
    expect(nonzeroDrift.ok).toBe(false);
    if (!nonzeroDrift.ok) expect(nonzeroDrift.kind).toBe('git-error');

    const malformed: GitCommandRunner = () => ({
      status: 1,
      stdout: '',
      stderr: 'fatal: Not a valid object name',
    });
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, malformed).status).toBe('error');

    const ancestor: GitCommandRunner = () => ({ status: 0, stdout: '', stderr: '' });
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, ancestor).status).toBe('ancestor');
    const notAncestor: GitCommandRunner = () => ({ status: 1, stdout: '', stderr: '' });
    expect(inspectCommitAncestry('.', FAKE_A, FAKE_B, notAncestor).status).toBe('not_ancestor');
    const missingHead = rejectUnreviewedHeadDrift('.', FAKE_A, null);
    expect(missingHead.ok).toBe(false);
    if (!missingHead.ok) expect(missingHead.kind).toBe('git-error');

    const repoRoot = makeTempRoot('drift-success');
    const first = initGitRepo(repoRoot);
    const second = commitFile(repoRoot, 'extra.ts', 'extra');
    expect(inspectCommitAncestry(repoRoot, first, second).status).toBe('ancestor');
    expect(inspectCommitAncestry(repoRoot, second, first).status).toBe('not_ancestor');
    const same = rejectUnreviewedHeadDrift(repoRoot, second, second);
    expect(same.ok).toBe(true);
    const extras = rejectUnreviewedHeadDrift(repoRoot, first, second);
    expect(extras.ok).toBe(false);
    if (!extras.ok) expect(extras.kind).toBe('unreviewed-implementation');
    const unrelated = rejectUnreviewedHeadDrift(repoRoot, second, first);
    expect(unrelated.ok).toBe(true);
  });

  it('T-LEDGER-FORGED-PROJECTION: forged executedTests that still hash cannot prove a required ID', () => {
    const repoRoot = makeTempRoot('forged-projection');
    initGitRepo(repoRoot);
    const persisted = expectOk(
      persistSyntheticLedger({
        repoRoot,
        workstreamId: 'ws_forged',
        titles: [{ title: 'UNRELATED-ID only' }],
        requiredIds: ['UNRELATED-ID'],
      })
    );
    const ledgerPath = path.join(repoRoot, persisted.reference.relativePath);
    const parsed = JSON.parse(readFileSync(ledgerPath, 'utf8')) as {
      contentHash: string;
      executedTests: Array<Record<string, unknown>>;
      mappedRequiredIds: string[];
    };
    const { contentHash: _ignored, ...body } = parsed as typeof parsed & Record<string, unknown>;
    const forgedBody = {
      ...body,
      mappedRequiredIds: ['A'],
      executedTests: [
        {
          canonicalId: 'A',
          file: 'tests/unit/fixture.test.ts',
          fullName: 'A forged',
          title: 'A forged',
          status: 'passed',
        },
      ],
    };
    const forgedHash = hashVerificationLedgerBody(
      forgedBody as Parameters<typeof hashVerificationLedgerBody>[0]
    );
    const forgedPath = path.join(
      repoRoot,
      'docs_private',
      'automation',
      'workstreams',
      'ws_forged',
      `verification-ledger-${forgedHash}.json`
    );
    writeFileSync(forgedPath, JSON.stringify({ ...forgedBody, contentHash: forgedHash }));
    const validated = readAndValidateVerificationLedger({
      repoRoot,
      workstreamId: 'ws_forged',
      relativePath: path.relative(repoRoot, forgedPath).replace(/\\/g, '/'),
      expectedFingerprint: persisted.record.productTreeFingerprint,
      expectedHeadCommit: persisted.record.headCommit,
    });
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.message).toMatch(/reporter projection/i);
    }
  });

  it('T-TYPECHECK-NAME-ONLY-NOT-PROVEN / T-LINT-NAME-ONLY-NOT-PROVEN: name-only commands without exact argv do not prove', () => {
    const repoRoot = makeTempRoot('exact-argv');
    const head = initGitRepo(repoRoot);
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_exact',
      kind: 'preflight',
      baseCommit: head,
      requiredTestIds: ['T-TYPECHECK', 'T-LINT'],
      runChecks: false,
      commandResults: [
        { name: 'typecheck', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
        { name: 'oxlint-changed', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
        { name: 'eslint-changed', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    expect(built.manifest.requiredTests.find((test) => test.id === 'T-TYPECHECK')?.executed).toBe(
      false
    );
    expect(built.manifest.requiredTests.find((test) => test.id === 'T-LINT')?.executed).toBe(false);
    expect(built.manifest.status).toBe('failed');
  });

  it('T-DRIFT-DESCENDANT-MISSING-NOT-ISOLATION / T-DRIFT-PREDECESSOR-MISSING-ISOLATION: missing descendant is not isolation', () => {
    const descendantMissing: GitCommandRunner = () => ({
      status: 128,
      stdout: '',
      stderr: `fatal: Not a valid commit name ${FAKE_B}`,
    });
    const isolated = requireCommitNotAncestor('.', FAKE_A, FAKE_B, 'not isolated', descendantMissing);
    expect(isolated.ok).toBe(false);

    const predecessorMissing: GitCommandRunner = () => ({
      status: 128,
      stdout: '',
      stderr: `fatal: Not a valid commit name ${FAKE_A}`,
    });
    const ok = requireCommitNotAncestor('.', FAKE_A, FAKE_B, 'not isolated', predecessorMissing);
    expect(ok.ok).toBe(true);
  });

  it('mapped blocker IDs require the registered ledger tests, not the blocker token', () => {
    expect(BLOCKER_REQUIRED_TEST_IDS['FD-LEDGER-PROVER-001']?.length).toBeGreaterThan(1);
    const repoRoot = makeTempRoot('mapped');
    const head = initGitRepo(repoRoot);
    const onlyBlockerToken = expectOk(
      persistSyntheticLedger({
      repoRoot,
      workstreamId: 'ws_mapped',
      titles: [{ title: 'FD-LEDGER-PROVER-001 token' }],
      requiredIds: ['FD-LEDGER-PROVER-001'],
    })
    );
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_mapped',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['FD-LEDGER-PROVER-001'],
      verificationLedgerRefs: [onlyBlockerToken.reference],
      commandResults: [{ name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' }],
    });
    expect(built.manifest.status).toBe('failed');
  });
});
