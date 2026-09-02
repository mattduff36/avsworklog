import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { writeJsonAtomic } from './workflow-events';
import { computeWorkingTreeProductFingerprint } from './workflow-v24-disposition';
import {
  CANONICAL_SUITE_REQUIRED_TEST_ID,
  EXACT_COMMAND_REQUIRED_TEST_IDS,
  hashCanonicalWorkflowSuiteManifest,
  loadCanonicalWorkflowSuiteManifest,
  parseVitestJsonReporter,
  proveCanonicalWorkflowSuite,
  provenVitestCaseIds,
  readAndValidateVerificationLedger,
  requiredTestIdsForBlocker,
  requiredTestProofKind,
  runVitestJsonAndPersistLedger,
  type VerificationLedgerRecord,
  type VerificationLedgerReference,
} from './workflow-verification-ledger';

export type EvidenceManifestKind = 'preflight' | 'fix-delta';
export type EvidenceCommandStatus = 'passed' | 'failed' | 'skipped' | 'unknown';

export interface EvidenceCommandResult {
  name: string;
  status: EvidenceCommandStatus;
  exitCode: number | null;
  durationMs: number;
  summary: string;
  command?: string;
  files?: string[];
}

export interface EvidenceTestMapping {
  id: string;
  status: 'completed' | 'unresolved' | 'missing';
  behavioral: boolean;
  /** True only when a targeted test run executed this ID successfully. */
  executed: boolean;
  evidenceLabel: string;
}

export interface WorkflowEvidenceManifest {
  schemaVersion: '1';
  kind: EvidenceManifestKind;
  workstreamId: string;
  status: 'passed' | 'failed' | 'unknown';
  createdAt: string;
  baseCommit: string;
  headCommit: string;
  dirtyTreeHash: string;
  inputFingerprint: string;
  contentHash: string;
  bodyHash?: string;
  changedFiles: string[];
  baseHeadEvidence: {
    baseCommit: string;
    headCommit: string;
    changedFileCount: number;
    changedFilesSample: string[];
  };
  commands: EvidenceCommandResult[];
  requiredTests: EvidenceTestMapping[];
  liveVerification?: {
    profile: string;
    status: EvidenceCommandStatus;
    summary: string;
  };
  closedBlockerIds?: string[];
  blockerEvidence?: Array<{
    blockerId: string;
    evidenceLabel: string;
    commandName?: string;
    provenRequiredTestIds?: string[];
    ledgerContentHash?: string;
  }>;
  verificationLedgers?: VerificationLedgerReference[];
  productTreeFingerprint?: string;
  privacy: {
    redacted: true;
  };
}

const HEAD_SHA_RE = /^[0-9a-f]{7,64}$/i;

function runGitOrThrow(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (status ${String(result.status ?? 'null')})`);
  }
  // Do not trimStart: porcelain status lines can begin with a leading space
  // (e.g. " M path"). Trimming would shift slice offsets and corrupt paths.
  return (result.stdout ?? '').replace(/(?:\r?\n)+\s*$/u, '');
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function hashFile(filePath: string): string {
  if (!existsSync(filePath)) return 'missing';
  return hashText(readFileSync(filePath, 'utf8'));
}

function listDirtyPaths(repoRoot: string): string[] {
  const output = runGitOrThrow(repoRoot, ['status', '--porcelain', '-uall', '-z']);
  if (!output) return [];
  const paths: string[] = [];
  const records = output.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    // Porcelain -z entries are "XY path\0". Rename/copy adds a second path record.
    if (record.length < 3) continue;
    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    if (!firstPath) continue;
    if (status.includes('R') || status.includes('C')) {
      index += 1;
      const renamedPath = records[index];
      if (renamedPath) paths.push(renamedPath);
      continue;
    }
    paths.push(firstPath);
  }
  return [...new Set(paths)].sort();
}

function isWorkflowAutomationPath(relative: string): boolean {
  const normalized = relative.replace(/\\/g, '/');
  return (
    normalized === 'docs_private/automation' ||
    normalized.startsWith('docs_private/automation/')
  );
}

export function getCurrentTreeFingerprint(repoRoot: string): {
  headCommit: string;
  dirtyTreeHash: string;
  inputFingerprint: string;
  changedFiles: string[];
} {
  const headCommit = runGitOrThrow(repoRoot, ['rev-parse', 'HEAD']);
  if (!HEAD_SHA_RE.test(headCommit)) {
    throw new Error('unable to read a well-formed git HEAD for evidence fingerprint');
  }
  const changedFiles = listDirtyPaths(repoRoot).filter(
    (relative) => !isWorkflowAutomationPath(relative)
  );
  return {
    headCommit,
    dirtyTreeHash: hashText(changedFiles.join('\n')),
    inputFingerprint: fingerprintInputs(repoRoot, changedFiles),
    changedFiles,
  };
}

export function listBaseToHeadChangedFiles(
  repoRoot: string,
  baseCommit: string,
  headCommit: string
): string[] {
  if (!baseCommit || !headCommit || baseCommit === 'unknown' || headCommit === 'unknown') {
    throw new Error('unable to list base..HEAD changed files without valid commits');
  }
  const result = spawnSync(
    'git',
    ['diff', '--name-only', `${baseCommit}...${headCommit}`],
    { cwd: repoRoot, encoding: 'utf8', shell: false, windowsHide: true }
  );
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim();
    throw new Error(
      detail
        ? `unable to list base..HEAD changed files: ${detail}`
        : 'unable to list base..HEAD changed files'
    );
  }
  const output = (result.stdout ?? '').replace(/(?:\r?\n)+\s*$/u, '');
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function fingerprintInputs(repoRoot: string, dirtyPaths: string[]): string {
  const parts = [
    `lock:${hashFile(path.join(repoRoot, 'package-lock.json'))}`,
    `pkg:${hashFile(path.join(repoRoot, 'package.json'))}`,
    `tsconfig:${hashFile(path.join(repoRoot, 'tsconfig.json'))}`,
    `vitest:${hashFile(path.join(repoRoot, 'vitest.config.ts'))}`,
    `node:${process.version}`,
  ];
  for (const relative of dirtyPaths) {
    const absolute = path.join(repoRoot, relative);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      parts.push(`${relative}:absent`);
      continue;
    }
    parts.push(`${relative}:${hashFile(absolute)}`);
  }
  const migrationsDir = path.join(repoRoot, 'supabase');
  if (existsSync(migrationsDir)) {
    const migrationFiles = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of migrationFiles) {
      parts.push(`migration:${name}:${hashFile(path.join(migrationsDir, name))}`);
    }
  }
  return hashText(parts.join('\n'));
}

function resolveCommandExecutable(command: string): string {
  if (process.platform !== 'win32') return command;
  if (command === 'npm') return 'npm.cmd';
  if (command === 'npx') return 'npx.cmd';
  return command;
}

function quoteWindowsArg(value: string): string {
  if (!/[\s|&<>^()"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function runCommand(
  repoRoot: string,
  name: string,
  command: string,
  args: string[]
): EvidenceCommandResult {
  const started = Date.now();
  const executable = resolveCommandExecutable(command);
  // Prefer shell:false so patterns containing `|` (vitest -t id1|id2) are not
  // interpreted as Windows shell pipes. Fall back to a quoted shell command if needed.
  let result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });
  if (result.error && process.platform === 'win32') {
    const cmdline = [executable, ...args.map(quoteWindowsArg)].join(' ');
    result = spawnSync(cmdline, {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: true,
      env: process.env,
    });
  }
  const durationMs = Date.now() - started;
  const exitCode = typeof result.status === 'number' ? result.status : null;
  return {
    name,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    durationMs,
    summary: exitCode === 0 ? 'ok' : (result.stderr || result.stdout || 'failed').trim(),
    command: [command, ...args].join(' '),
  };
}

export type EvidenceCommandRunner = typeof runCommand;

function isLintableFile(relativePath: string): boolean {
  return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/u.test(relativePath);
}

function listRepoTestFiles(repoRoot: string): string[] {
  const testRoots = [
    path.join(repoRoot, 'tests'),
    path.join(repoRoot, 'testsuite'),
  ].filter((dir) => existsSync(dir));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(test|spec)\.(ts|tsx|js|mjs)$/u.test(entry.name)) continue;
      files.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
    }
  };
  for (const root of testRoots) walk(root);
  return files.sort();
}

function isRepoUnitTestFile(relative: string): boolean {
  const normalized = relative.replace(/\\/g, '/');
  return (
    /\.(test|spec)\.(ts|tsx|js|mjs)$/u.test(normalized) &&
    (normalized.startsWith('tests/unit/') || normalized.startsWith('tests/regression/'))
  );
}

function discoverBehavioralTestIds(
  repoRoot: string,
  ids: string[],
  executedIds: Set<string>
): EvidenceTestMapping[] {
  const fileContents = listRepoTestFiles(repoRoot).flatMap((relative) => {
    try {
      return [readFileSync(path.join(repoRoot, relative), 'utf8')];
    } catch {
      return [];
    }
  });
  const corpus = fileContents.join('\n');

  return ids.map((id) => {
    const present = corpus.includes(id);
    const kind = requiredTestProofKind(id);
    const behavioral =
      kind !== 'exact_command' &&
      present &&
      new RegExp(
        `(?:it|test|describe)\\(\\s*['\`"][^'\`"]*${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`,
        'u'
      ).test(corpus);
    const executed = executedIds.has(id);
    const completed =
      executed && (kind === 'exact_command' || kind === 'vitest_suite' || behavioral);
    return {
      id,
      status: completed ? 'completed' : present || kind === 'exact_command' || kind === 'vitest_suite' ? 'unresolved' : 'missing',
      behavioral: kind === 'exact_command' || kind === 'vitest_suite' ? true : behavioral,
      executed,
      evidenceLabel:
        completed
          ? `proven:${kind}:${id}`
          : kind === 'exact_command' || kind === 'vitest_suite'
            ? `unproven:${kind}:${id}`
            : behavioral
              ? `behavioral-unexecuted:${id}`
              : present
                ? `source-only:${id}`
                : `missing:${id}`,
    };
  });
}

function exactTypecheckCommand(command: EvidenceCommandResult): boolean {
  return (
    command.name === 'typecheck' &&
    command.status === 'passed' &&
    command.exitCode === 0 &&
    command.command === 'npm run typecheck'
  );
}

function exactLintCommand(command: EvidenceCommandResult, kind: 'oxlint' | 'eslint'): boolean {
  const expectedName = kind === 'oxlint' ? 'oxlint-changed' : 'eslint-changed';
  const expectedPrefix = kind === 'oxlint' ? 'npx oxlint --' : 'npx eslint --';
  if (command.name !== expectedName) return false;
  if (typeof command.command !== 'string' || !command.command.startsWith(expectedPrefix)) return false;
  if (command.status === 'skipped') {
    return command.exitCode === null && command.summary === 'no changed lintable files';
  }
  return command.status === 'passed' && command.exitCode === 0;
}

function exactCommandProvenIds(commands: EvidenceCommandResult[], requiredIds: string[]): string[] {
  const proven: string[] = [];
  if (requiredIds.includes(EXACT_COMMAND_REQUIRED_TEST_IDS.TYPECHECK)) {
    if (commands.some(exactTypecheckCommand)) {
      proven.push(EXACT_COMMAND_REQUIRED_TEST_IDS.TYPECHECK);
    }
  }
  if (requiredIds.includes(EXACT_COMMAND_REQUIRED_TEST_IDS.LINT)) {
    const oxlint = commands.find((command) => command.name === 'oxlint-changed');
    const eslint = commands.find((command) => command.name === 'eslint-changed');
    if (oxlint && eslint && exactLintCommand(oxlint, 'oxlint') && exactLintCommand(eslint, 'eslint')) {
      proven.push(EXACT_COMMAND_REQUIRED_TEST_IDS.LINT);
    }
  }
  return proven;
}

export function buildEvidenceManifest(params: {
  repoRoot: string;
  workstreamId: string;
  kind: EvidenceManifestKind;
  baseCommit: string;
  requiredTestIds?: string[];
  runChecks?: boolean;
  runRequiredTests?: boolean;
  persistLedgers?: boolean;
  vitestInstallRoot?: string;
  liveVerification?: WorkflowEvidenceManifest['liveVerification'];
  closedBlockerIds?: string[];
  blockerEvidence?: WorkflowEvidenceManifest['blockerEvidence'];
  commandResults?: EvidenceCommandResult[];
  verificationLedgerRefs?: VerificationLedgerReference[];
  commandRunner?: EvidenceCommandRunner;
}): { manifest: WorkflowEvidenceManifest; relativePath: string; absolutePath: string } {
  const tree = getCurrentTreeFingerprint(params.repoRoot);
  const headCommit = tree.headCommit;
  const dirtyFiles = tree.changedFiles;
  const baseHeadFiles = listBaseToHeadChangedFiles(
    params.repoRoot,
    params.baseCommit,
    headCommit
  );
  const changedFiles = [...new Set([...baseHeadFiles, ...dirtyFiles])].sort();
  const dirtyTreeHash = tree.dirtyTreeHash;
  const inputFingerprint = tree.inputFingerprint;
  const productTree = computeWorkingTreeProductFingerprint(params.repoRoot);
  if (typeof productTree === 'object') {
    throw new Error(productTree.error);
  }
  const requiredIds = params.requiredTestIds ?? [];
  const executedIds = new Set<string>();
  const commands: EvidenceCommandResult[] = [...(params.commandResults ?? [])];
  const ledgerRefs: VerificationLedgerReference[] = [...(params.verificationLedgerRefs ?? [])];
  const execute = params.commandRunner ?? runCommand;
  if (params.runChecks) {
    commands.push(execute(params.repoRoot, 'typecheck', 'npm', ['run', 'typecheck']));
    const lintableFiles = changedFiles.filter(
      (relativePath) =>
        isLintableFile(relativePath) && existsSync(path.join(params.repoRoot, relativePath))
    );
    if (lintableFiles.length === 0) {
      commands.push(
        {
          name: 'oxlint-changed',
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          summary: 'no changed lintable files',
          command: 'npx oxlint --',
          files: [],
        },
        {
          name: 'eslint-changed',
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          summary: 'no changed lintable files',
          command: 'npx eslint --',
          files: [],
        }
      );
    } else {
      const oxlint = execute(params.repoRoot, 'oxlint-changed', 'npx', [
        'oxlint',
        '--',
        ...lintableFiles,
      ]);
      oxlint.files = lintableFiles;
      commands.push(oxlint);
      const eslint = execute(params.repoRoot, 'eslint-changed', 'npx', [
        'eslint',
        '--',
        ...lintableFiles,
      ]);
      eslint.files = lintableFiles;
      commands.push(eslint);
    }
  }

  const persistLedgers = params.persistLedgers !== false;
  let ledgerError: string | null = null;
  const needsVitestProof = requiredIds.some((id) => {
    const kind = requiredTestProofKind(id);
    return kind === 'vitest_case' || kind === 'vitest_suite';
  });
  if (params.runRequiredTests && needsVitestProof) {
    const suiteManifest = loadCanonicalWorkflowSuiteManifest();
    const suiteRun = runVitestJsonAndPersistLedger({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      commandId: 'canonical-workflow-suite',
      commandType: 'vitest_suite',
      files: suiteManifest.files,
      requiredIds,
      expectedSuiteManifestHash: hashCanonicalWorkflowSuiteManifest(suiteManifest),
      persist: persistLedgers,
      vitestInstallRoot: params.vitestInstallRoot,
    });
    if (!suiteRun.ok) {
      ledgerError = suiteRun.message;
      commands.push({
        name: 'canonical-workflow-suite',
        status: 'failed',
        exitCode: 1,
        durationMs: 0,
        summary: suiteRun.message,
      });
    } else {
      ledgerRefs.push(suiteRun.reference);
      commands.push({
        name: 'canonical-workflow-suite',
        status: suiteRun.record.exitCode === 0 && suiteRun.reporterSuccess ? 'passed' : 'failed',
        exitCode: suiteRun.record.exitCode,
        durationMs: 0,
        summary: 'vitest json reporter ledger',
        command: [suiteRun.record.command, ...suiteRun.record.args].join(' '),
        files: suiteManifest.files,
      });
    }
  }

  const changedUnitTestFiles = [
    ...new Set(changedFiles.filter((relative) => isRepoUnitTestFile(relative))),
  ]
    .filter((relative) => existsSync(path.join(params.repoRoot, relative)))
    .sort();
  if (params.runRequiredTests && changedUnitTestFiles.length > 0) {
    const changedRun = runVitestJsonAndPersistLedger({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      commandId: 'changed-test-files',
      commandType: 'changed_files',
      files: changedUnitTestFiles,
      requiredIds,
      persist: persistLedgers,
      vitestInstallRoot: params.vitestInstallRoot,
    });
    if (!changedRun.ok) {
      ledgerError = ledgerError ?? changedRun.message;
      commands.push({
        name: 'changed-test-files',
        status: 'failed',
        exitCode: 1,
        durationMs: 0,
        summary: changedRun.message,
        files: changedUnitTestFiles,
      });
    } else {
      ledgerRefs.push(changedRun.reference);
      commands.push({
        name: 'changed-test-files',
        status: changedRun.record.exitCode === 0 && changedRun.reporterSuccess ? 'passed' : 'failed',
        exitCode: changedRun.record.exitCode,
        durationMs: 0,
        summary: 'changed-files vitest ledger; does not prove canonical suite',
        command: [changedRun.record.command, ...changedRun.record.args].join(' '),
        files: changedUnitTestFiles,
      });
    }
  }

  const validatedRecords: VerificationLedgerRecord[] = [];
  for (const reference of ledgerRefs) {
    const validated = readAndValidateVerificationLedger({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      relativePath: reference.relativePath,
      expectedFingerprint: productTree,
      expectedHeadCommit: headCommit,
    });
    if (!validated.ok) {
      ledgerError = validated.message;
      continue;
    }
    validatedRecords.push(validated.record);
  }

  const claimedBlockers = params.closedBlockerIds ?? [];
  const uniqueBlockers = [...new Set(claimedBlockers)];
  const idsToProve = [
    ...requiredIds,
    ...uniqueBlockers.flatMap((blockerId) => requiredTestIdsForBlocker(blockerId)),
  ];
  const caseProof = provenVitestCaseIds({
    records: validatedRecords,
    requiredIds: idsToProve,
  });
  if (!caseProof.ok) {
    ledgerError = caseProof.message;
  } else {
    for (const id of caseProof.provenIds) executedIds.add(id);
  }

  const suiteRecord = validatedRecords.find((record) => record.commandType === 'vitest_suite');
  if (requiredIds.includes(CANONICAL_SUITE_REQUIRED_TEST_ID)) {
    if (!suiteRecord) {
      ledgerError = ledgerError ?? 'canonical workflow suite ledger is missing';
    } else {
      const reporter = readAndValidateVerificationLedger({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
        relativePath:
          ledgerRefs.find((reference) => reference.contentHash === suiteRecord.contentHash)
            ?.relativePath ?? '',
        expectedFingerprint: productTree,
        expectedHeadCommit: headCommit,
      });
      let suiteProof: { ok: true } | { ok: false; message: string };
      if (!reporter.ok) {
        suiteProof = reporter;
      } else {
        const reporterParsed = parseVitestJsonReporter(reporter.reporterRaw);
        suiteProof = reporterParsed.ok
          ? proveCanonicalWorkflowSuite({
              record: suiteRecord,
              reporterSuccess: reporterParsed.success,
            })
          : reporterParsed;
      }
      if (suiteProof.ok) {
        executedIds.add(CANONICAL_SUITE_REQUIRED_TEST_ID);
      } else if ('message' in suiteProof) {
        ledgerError = ledgerError ?? suiteProof.message;
      }
    }
  }

  for (const id of exactCommandProvenIds(commands, requiredIds)) {
    executedIds.add(id);
  }

  if (claimedBlockers.length !== uniqueBlockers.length) {
    ledgerError = ledgerError ?? 'duplicate closed blocker IDs';
  }
  const derivedBlockerEvidence =
    params.kind === 'fix-delta'
      ? uniqueBlockers.map((blockerId) => {
          const expectedIds = requiredTestIdsForBlocker(blockerId);
          const provenRequiredTestIds = expectedIds.filter((id) => executedIds.has(id));
          const matchingLedger = validatedRecords.find((record) =>
            record.executedTests.some(
              (test) =>
                test.status === 'passed' &&
                expectedIds.some((id) => test.canonicalId === id)
            )
          );
          return {
            blockerId,
            evidenceLabel:
              provenRequiredTestIds.length === expectedIds.length
                ? `ledger-proven:${provenRequiredTestIds.join(',')}`
                : `ledger-unproven:${blockerId}`,
            commandName: 'verification-ledger',
            provenRequiredTestIds,
            ledgerContentHash: matchingLedger?.contentHash,
          };
        })
      : params.blockerEvidence;

  if (params.kind === 'fix-delta') {
    const incomplete = (derivedBlockerEvidence ?? []).filter((row) => {
      const expectedIds = requiredTestIdsForBlocker(row.blockerId);
      return expectedIds.some((id) => !(row.provenRequiredTestIds ?? []).includes(id));
    });
    if (incomplete.length > 0) {
      ledgerError =
        ledgerError ??
        `fix-delta blockers lack proven ledger tests: ${incomplete.map((row) => row.blockerId).join(', ')}`;
    }
    commands.push({
      name: 'verification-ledger',
      status: ledgerError ? 'failed' : 'passed',
      exitCode: ledgerError ? 1 : 0,
      durationMs: 0,
      summary: ledgerError ?? 'validated verification ledgers',
    });
  }

  const requiredTests = discoverBehavioralTestIds(params.repoRoot, requiredIds, executedIds);

  const checksPassed =
    commands.length > 0 &&
    commands.every((command) => command.status === 'passed' || command.status === 'skipped');
  const testsReady =
    requiredTests.length === 0 ||
    requiredTests.every((test) => test.status === 'completed' && test.executed);
  const liveOk =
    !params.liveVerification ||
    params.liveVerification.status === 'passed' ||
    params.liveVerification.status === 'skipped';
  const fixEvidenceReady =
    params.kind !== 'fix-delta' ||
    ((uniqueBlockers.length > 0) &&
      (derivedBlockerEvidence?.length ?? 0) > 0 &&
      !ledgerError);

  let status: WorkflowEvidenceManifest['status'] = 'passed';
  if (!checksPassed || !testsReady || !liveOk || !fixEvidenceReady || ledgerError) {
    status = 'failed';
  }
  if (commands.some((command) => command.status === 'unknown')) status = 'unknown';

  const draft: Omit<WorkflowEvidenceManifest, 'contentHash' | 'bodyHash'> = {
    schemaVersion: '1',
    kind: params.kind,
    workstreamId: params.workstreamId,
    status,
    createdAt: new Date().toISOString(),
    baseCommit: params.baseCommit,
    headCommit,
    dirtyTreeHash,
    inputFingerprint,
    productTreeFingerprint: productTree,
    changedFiles: changedFiles.slice(0, 500),
    baseHeadEvidence: {
      baseCommit: params.baseCommit,
      headCommit,
      changedFileCount: baseHeadFiles.length,
      changedFilesSample: baseHeadFiles.slice(0, 50),
    },
    commands,
    requiredTests,
    liveVerification: params.liveVerification,
    closedBlockerIds: params.kind === 'fix-delta' ? uniqueBlockers : params.closedBlockerIds,
    blockerEvidence: derivedBlockerEvidence,
    verificationLedgers: ledgerRefs,
    privacy: { redacted: true },
  };

  const bodyHash = hashText(JSON.stringify(draft));
  const manifest: WorkflowEvidenceManifest = {
    ...draft,
    contentHash: bodyHash,
    bodyHash,
  };

  const directory = path.join(
    params.repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    params.workstreamId
  );
  mkdirSync(directory, { recursive: true });
  const fileName = `${params.kind}-${manifest.contentHash}.json`;
  const absolutePath = path.join(directory, fileName);
  writeJsonAtomic(absolutePath, manifest);
  return {
    manifest,
    absolutePath,
    relativePath: path.relative(params.repoRoot, absolutePath).replace(/\\/g, '/'),
  };
}

export function recomputeManifestProvenIds(params: {
  repoRoot: string;
  workstreamId: string;
  parsed: Record<string, unknown>;
}): { ok: true; executedIds: Set<string> } | { ok: false; message: string } {
  const productTree = computeWorkingTreeProductFingerprint(params.repoRoot);
  if (typeof productTree === 'object') return { ok: false, message: productTree.error };
  const tree = getCurrentTreeFingerprint(params.repoRoot);
  if (typeof params.parsed.productTreeFingerprint === 'string' &&
      params.parsed.productTreeFingerprint !== productTree) {
    return { ok: false, message: 'manifest productTreeFingerprint is stale vs current tree' };
  }
  const refs = Array.isArray(params.parsed.verificationLedgers)
    ? params.parsed.verificationLedgers
    : [];
  const records: VerificationLedgerRecord[] = [];
  for (const entry of refs) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, message: 'verification ledger reference is malformed' };
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.relativePath !== 'string' || typeof row.contentHash !== 'string') {
      return { ok: false, message: 'verification ledger reference is incomplete' };
    }
    const validated = readAndValidateVerificationLedger({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      relativePath: row.relativePath,
      expectedFingerprint: productTree,
      expectedHeadCommit: tree.headCommit,
    });
    if (!validated.ok) return validated;
    if (validated.record.contentHash !== row.contentHash) {
      return { ok: false, message: 'verification ledger reference hash mismatch' };
    }
    records.push(validated.record);
  }
  const requiredIds = Array.isArray(params.parsed.requiredTests)
    ? params.parsed.requiredTests
        .map((entry) =>
          entry && typeof entry === 'object' ? (entry as Record<string, unknown>).id : null
        )
        .filter((id): id is string => typeof id === 'string')
    : [];
  const closed = Array.isArray(params.parsed.closedBlockerIds)
    ? params.parsed.closedBlockerIds.filter((id): id is string => typeof id === 'string')
    : [];
  const idsToProve = [...requiredIds, ...closed.flatMap((id) => requiredTestIdsForBlocker(id))];
  const caseProof = provenVitestCaseIds({ records, requiredIds: idsToProve });
  if (!caseProof.ok) return caseProof;
  const executedIds = new Set(caseProof.provenIds);
  const commands = Array.isArray(params.parsed.commands)
    ? (params.parsed.commands as EvidenceCommandResult[])
    : [];
  for (const id of exactCommandProvenIds(commands, requiredIds)) executedIds.add(id);
  if (requiredIds.includes(CANONICAL_SUITE_REQUIRED_TEST_ID)) {
    const suiteRecord = records.find((record) => record.commandType === 'vitest_suite');
    const suiteRef = refs.find(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        (entry as Record<string, unknown>).contentHash === suiteRecord?.contentHash
    ) as Record<string, unknown> | undefined;
    if (!suiteRecord || typeof suiteRef?.relativePath !== 'string') {
      return { ok: false, message: 'canonical workflow suite ledger is missing' };
    }
    const reporter = readAndValidateVerificationLedger({
      repoRoot: params.repoRoot,
      workstreamId: params.workstreamId,
      relativePath: suiteRef.relativePath,
      expectedFingerprint: productTree,
      expectedHeadCommit: tree.headCommit,
    });
    if (!reporter.ok) return reporter;
    const parsedReporter = parseVitestJsonReporter(reporter.reporterRaw);
    if (!parsedReporter.ok) return parsedReporter;
    const suiteProof = proveCanonicalWorkflowSuite({
      record: suiteRecord,
      reporterSuccess: parsedReporter.success,
    });
    if (!suiteProof.ok) return suiteProof;
    executedIds.add(CANONICAL_SUITE_REQUIRED_TEST_ID);
  }
  return { ok: true, executedIds };
}

export function readEvidenceManifest(filePath: string): WorkflowEvidenceManifest | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as WorkflowEvidenceManifest;
  } catch {
    return null;
  }
}
