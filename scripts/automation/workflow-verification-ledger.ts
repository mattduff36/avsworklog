import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { writeJsonAtomic } from './workflow-events';
import { pathHasSymlinkComponent } from './workflow-plan-contract';
import {
  computeWorkingTreeProductFingerprint,
  gitHeadCommit,
  type GitCommandRunner,
} from './workflow-v24-disposition';

export const VERIFICATION_LEDGER_SCHEMA_VERSION = '1' as const;
export const VERIFICATION_LEDGER_COMMAND_TYPES = [
  'vitest_case',
  'vitest_suite',
  'changed_files',
] as const;
export type VerificationLedgerCommandType = (typeof VERIFICATION_LEDGER_COMMAND_TYPES)[number];

export type RequiredTestProofKind = 'vitest_case' | 'vitest_suite' | 'exact_command';
export type VerificationTestStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'todo'
  | 'pending'
  | 'unknown';

const REQUIRED_ID_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SHA_RE = /^[0-9a-f]{7,64}$/i;

export const EXACT_COMMAND_REQUIRED_TEST_IDS = {
  TYPECHECK: 'T-TYPECHECK',
  LINT: 'T-LINT',
} as const;

export const CANONICAL_SUITE_REQUIRED_TEST_ID = 'T-EXISTING-WORKFLOW-TESTS';

const EXACT_COMMAND_ID_SET = new Set<string>(Object.values(EXACT_COMMAND_REQUIRED_TEST_IDS));

export const BLOCKER_REQUIRED_TEST_IDS: Readonly<Record<string, readonly string[]>> = {
  'FD-GIT': ['T-SUCCESSOR-RANGE-001'],
  'FD-VERIFY': ['T-SUCCESSOR-VERIFY-001'],
  'FD-LEDGER-PROVER-001': [
    'T-LEDGER-SRC-NOT-EXECUTED',
    'T-LEDGER-FILTERED-NOT-PROVEN',
    'T-LEDGER-SKIP-NOT-PROVEN',
    'T-LEDGER-TODO-NOT-PROVEN',
    'T-LEDGER-FAIL-NOT-PROVEN',
    'T-LEDGER-EXACT-PASS-PROVEN',
    'T-LEDGER-SIMILAR-TITLE-NO-CROSS',
    'T-LEDGER-DUPLICATE-ID-FAIL-CLOSED',
    'T-LEDGER-FORGED-PROJECTION',
  ],
  'FD-LEDGER-002': [
    'T-LEDGER-CHANGED-NOT-SUITE',
    'T-LEDGER-PARTIAL-SUITE-NOT-PROVEN',
    'T-LEDGER-FULL-SUITE-PROVEN',
    'T-LEDGER-ZERO-TESTS-NOT-SUITE',
    'T-TYPECHECK-NAME-ONLY-NOT-PROVEN',
    'T-LINT-NAME-ONLY-NOT-PROVEN',
  ],
  'FD-FIXDELTA-001': [
    'T-FIXDELTA-NO-LEDGER',
    'T-FIXDELTA-UNRELATED-TESTS',
    'T-FIXDELTA-VALID-LEDGER',
    'T-FIXDELTA-WRONG-FINGERPRINT',
    'T-FIXDELTA-STALE-AFTER-CHANGE',
    'T-FIXDELTA-TAMPER-HASH',
  ],
  'FD-DRIFT-001': [
    'T-DRIFT-GIT-THROW',
    'T-DRIFT-GIT-NONZERO',
    'T-DRIFT-GIT-MALFORMED',
    'T-DRIFT-GIT-SUCCESS',
    'T-DRIFT-DESCENDANT-MISSING-NOT-ISOLATION',
    'T-DRIFT-PREDECESSOR-MISSING-ISOLATION',
    'T-DRIFT-ANCESTOR-REJECTS-ISOLATION',
    'T-DRIFT-NON-ANCESTOR-ISOLATION-OK',
    'T-DRIFT-COLLIDING-PREFIX-MISSING-DESCENDANT',
    'T-DRIFT-COLLIDING-PREFIX-MISSING-PREDECESSOR',
    'T-DRIFT-BOTH-MISSING-SAME-PREFIX',
    'T-DRIFT-MALFORMED-SAME-PREFIX',
    'T-DRIFT-AMBIGUOUS-SHA',
    'T-DRIFT-NON-COMMIT-OBJECT',
    'T-DRIFT-MERGE-BASE-EXIT-2',
    'T-DRIFT-SPAWN-FAILURE',
    'T-DRIFT-TIMEOUT',
    'T-DRIFT-UNEXPECTED-SIGNAL',
    'T-DRIFT-STDERR-CONTAINS-SHA-STILL-ERROR',
    'T-DRIFT-STDERR-EMPTY-STILL-ERROR',
    'T-DRIFT-EXIT-1-BOTH-VERIFIED',
    'T-DRIFT-FULL-SHA-IN-EVIDENCE',
    'T-DRIFT-ABBREV-DISPLAY-DOES-NOT-DECIDE',
  ],
};

export interface CanonicalWorkflowSuiteManifest {
  schemaVersion: '1';
  id: string;
  files: string[];
}

export interface VerificationLedgerExecutedTest {
  canonicalId: string | null;
  file: string;
  fullName: string;
  title: string;
  status: VerificationTestStatus;
}

export interface VerificationLedgerRecord {
  schemaVersion: '1';
  runId: string;
  commandId: string;
  commandType: VerificationLedgerCommandType;
  command: string;
  args: string[];
  cwd: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  headCommit: string;
  productTreeFingerprint: string;
  runnerName: string;
  runnerVersion: string;
  reporterOutputHash: string;
  expectedSuiteManifestHash?: string;
  mappedRequiredIds: string[];
  executedTests: VerificationLedgerExecutedTest[];
  contentHash: string;
}

export interface VerificationLedgerReference {
  relativePath: string;
  contentHash: string;
  commandType: VerificationLedgerCommandType;
  reporterRelativePath: string;
  reporterOutputHash: string;
}

export interface ProvenRequiredTests {
  ok: true;
  provenIds: string[];
  suiteProven: boolean;
  mappingError?: undefined;
}

export interface ProvenRequiredTestsFailure {
  ok: false;
  message: string;
  provenIds: string[];
  suiteProven: boolean;
}

type JsonObject = Record<string, unknown>;

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function posixRelative(repoRoot: string, absolutePath: string): string | { error: string } {
  const repo = path.resolve(repoRoot);
  const absolute = path.resolve(absolutePath);
  const relative = path.relative(repo, absolute).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { error: `path is outside the repository: ${absolutePath}` };
  }
  return relative;
}

export function requiredTestProofKind(id: string): RequiredTestProofKind {
  if (id === CANONICAL_SUITE_REQUIRED_TEST_ID) return 'vitest_suite';
  if (EXACT_COMMAND_ID_SET.has(id)) return 'exact_command';
  return 'vitest_case';
}

export function titleContainsExactRequiredId(text: string, id: string): boolean {
  if (!REQUIRED_ID_TOKEN_RE.test(id)) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'u').test(text);
}

export function loadCanonicalWorkflowSuiteManifest(): CanonicalWorkflowSuiteManifest {
  const manifestPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'workflow-suite-manifest.json'
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('canonical workflow suite manifest is unreadable');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('canonical workflow suite manifest is malformed');
  }
  const suiteManifestJson = parsed as { schemaVersion?: unknown; id?: unknown; files?: unknown };
  const files = Array.isArray(suiteManifestJson.files)
    ? suiteManifestJson.files.map((file) => String(file).replace(/\\/g, '/'))
    : [];
  const unique = [...new Set(files)].sort();
  if (unique.length === 0 || unique.length !== files.length) {
    throw new Error('canonical workflow suite manifest must enumerate unique files');
  }
  if (suiteManifestJson.schemaVersion !== '1' || typeof suiteManifestJson.id !== 'string') {
    throw new Error('canonical workflow suite manifest is malformed');
  }
  return {
    schemaVersion: '1',
    id: suiteManifestJson.id,
    files: unique,
  };
}

export function hashCanonicalWorkflowSuiteManifest(
  manifest: CanonicalWorkflowSuiteManifest = loadCanonicalWorkflowSuiteManifest()
): string {
  return sha256Hex(
    canonicalJson({
      schemaVersion: manifest.schemaVersion,
      id: manifest.id,
      files: [...manifest.files].sort(),
    })
  );
}

function workstreamEvidenceDirectory(repoRoot: string, workstreamId: string): string {
  return path.join(repoRoot, 'docs_private', 'automation', 'workstreams', workstreamId);
}

export function assertTrustedWorkstreamEvidencePath(params: {
  repoRoot: string;
  workstreamId: string;
  candidatePath: string;
}): { ok: true; absolutePath: string; relativePath: string } | { ok: false; message: string } {
  if (!params.workstreamId || /[^A-Za-z0-9_-]/u.test(params.workstreamId)) {
    return { ok: false, message: 'workstreamId is not a valid evidence directory name' };
  }
  const repoRoot = path.resolve(params.repoRoot);
  const absolute = path.resolve(
    path.isAbsolute(params.candidatePath)
      ? params.candidatePath
      : path.join(repoRoot, params.candidatePath)
  );
  if (pathHasSymlinkComponent(absolute) || pathHasSymlinkComponent(path.dirname(absolute))) {
    return { ok: false, message: 'verification evidence path must not contain symlinks' };
  }
  const relative = posixRelative(repoRoot, absolute);
  if (typeof relative === 'object') return { ok: false, message: relative.error };
  const expectedPrefix = `docs_private/automation/workstreams/${params.workstreamId}/`;
  if (!relative.startsWith(expectedPrefix) || relative.includes('..')) {
    return {
      ok: false,
      message: 'verification evidence must stay under the workstream automation directory',
    };
  }
  const base = path.basename(relative);
  if (!/^(verification-ledger|verification-reporter)-[0-9a-f]{64}\.json$/u.test(base)) {
    return { ok: false, message: 'verification evidence filename is not content-addressed' };
  }
  return { ok: true, absolutePath: absolute, relativePath: relative };
}

function parseStatus(value: unknown): VerificationTestStatus {
  if (value === 'passed' || value === 'failed' || value === 'skipped' || value === 'todo') {
    return value;
  }
  if (value === 'pending' || value === 'disabled') return 'pending';
  return 'unknown';
}

export function parseVitestJsonReporter(raw: Buffer): {
  ok: true;
  success: boolean;
  startTime: number | null;
  tests: Array<{
    file: string;
    fullName: string;
    title: string;
    status: VerificationTestStatus;
  }>;
} | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, message: 'vitest JSON reporter output is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'vitest JSON reporter output is not an object' };
  }
  const report = parsed as JsonObject;
  if (typeof report.success !== 'boolean') {
    return { ok: false, message: 'vitest JSON reporter is missing success' };
  }
  if (!Array.isArray(report.testResults)) {
    return { ok: false, message: 'vitest JSON reporter is missing testResults' };
  }
  const tests: Array<{
    file: string;
    fullName: string;
    title: string;
    status: VerificationTestStatus;
  }> = [];
  for (const fileEntry of report.testResults) {
    if (!fileEntry || typeof fileEntry !== 'object' || Array.isArray(fileEntry)) {
      return { ok: false, message: 'vitest JSON reporter file entry is malformed' };
    }
    const file = fileEntry as JsonObject;
    if (typeof file.name !== 'string' || !file.name) {
      return { ok: false, message: 'vitest JSON reporter file name is missing' };
    }
    if (!Array.isArray(file.assertionResults)) {
      return { ok: false, message: `vitest JSON reporter assertions missing for ${file.name}` };
    }
    for (const assertion of file.assertionResults) {
      if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) {
        return { ok: false, message: `vitest JSON reporter assertion is malformed in ${file.name}` };
      }
      const row = assertion as JsonObject;
      if (typeof row.title !== 'string' || typeof row.fullName !== 'string') {
        return { ok: false, message: `vitest JSON reporter assertion identity is missing in ${file.name}` };
      }
      const status = parseStatus(row.status);
      if (status === 'unknown') {
        return {
          ok: false,
          message: `unrecognised vitest assertion status in ${file.name}: ${String(row.status)}`,
        };
      }
      tests.push({
        file: file.name.replace(/\\/g, '/'),
        fullName: row.fullName,
        title: row.title,
        status,
      });
    }
  }
  return {
    ok: true,
    success: report.success,
    startTime: typeof report.startTime === 'number' ? report.startTime : null,
    tests,
  };
}

function remapReporterTests(
  repoRoot: string,
  tests: Array<{ file: string; fullName: string; title: string; status: VerificationTestStatus }>
):
  | { ok: true; tests: Array<{ file: string; fullName: string; title: string; status: VerificationTestStatus }> }
  | { ok: false; message: string } {
  const remapped: Array<{
    file: string;
    fullName: string;
    title: string;
    status: VerificationTestStatus;
  }> = [];
  for (const test of tests) {
    const absolute = path.isAbsolute(test.file) ? test.file : path.join(repoRoot, test.file);
    const relative = posixRelative(repoRoot, absolute);
    if (typeof relative === 'object') return { ok: false, message: relative.error };
    if (relative.includes('\\') || path.isAbsolute(relative) || relative.startsWith('..')) {
      return { ok: false, message: `executed test file is not repo-relative: ${relative}` };
    }
    remapped.push({ ...test, file: relative });
  }
  return { ok: true, tests: remapped };
}

export function projectExecutedTestsFromReporter(params: {
  repoRoot: string;
  reporterRaw: Buffer;
  requiredIds: string[];
}):
  | { ok: true; executedTests: VerificationLedgerExecutedTest[]; reporterSuccess: boolean }
  | { ok: false; message: string } {
  const parsed = parseVitestJsonReporter(params.reporterRaw);
  if (!parsed.ok) return parsed;
  const remapped = remapReporterTests(params.repoRoot, parsed.tests);
  if (!remapped.ok) return remapped;
  const mapped = mapCanonicalIds({ tests: remapped.tests, requiredIds: params.requiredIds });
  if (!mapped.ok) return mapped;
  return {
    ok: true,
    executedTests: mapped.executedTests,
    reporterSuccess: parsed.success,
  };
}

function mapCanonicalIds(params: {
  tests: Array<{ file: string; fullName: string; title: string; status: VerificationTestStatus }>;
  requiredIds: string[];
}):
  | { ok: true; executedTests: VerificationLedgerExecutedTest[] }
  | { ok: false; message: string } {
  const requiredCaseIds = params.requiredIds.filter(
    (id) => requiredTestProofKind(id) === 'vitest_case'
  );
  const matchesById = new Map<string, number[]>();
  for (const id of requiredCaseIds) {
    matchesById.set(id, []);
  }
  const executedTests: VerificationLedgerExecutedTest[] = params.tests.map((test, index) => {
    const matchedIds = requiredCaseIds.filter(
      (id) =>
        titleContainsExactRequiredId(test.fullName, id) ||
        titleContainsExactRequiredId(test.title, id)
    );
    for (const id of matchedIds) {
      matchesById.get(id)?.push(index);
    }
    return {
      canonicalId: matchedIds.length === 1 ? matchedIds[0]! : null,
      file: test.file,
      fullName: test.fullName,
      title: test.title,
      status: test.status,
    };
  });
  for (const [id, indexes] of matchesById) {
    if (indexes.length > 1) {
      return {
        ok: false,
        message: `required test ID ${id} maps to multiple assertions; fail closed`,
      };
    }
    if (indexes.length === 1) {
      executedTests[indexes[0]!]!.canonicalId = id;
    }
  }
  return { ok: true, executedTests };
}

function captureCandidateIdentity(
  repoRoot: string,
  git?: GitCommandRunner
): { ok: true; headCommit: string; productTreeFingerprint: string } | { ok: false; message: string } {
  const headCommit = gitHeadCommit(repoRoot, git);
  if (!headCommit || !SHA_RE.test(headCommit)) {
    return { ok: false, message: 'unable to read git HEAD for verification ledger binding' };
  }
  const fingerprint = computeWorkingTreeProductFingerprint(repoRoot, git);
  if (typeof fingerprint === 'object') {
    return { ok: false, message: fingerprint.error };
  }
  return { ok: true, headCommit, productTreeFingerprint: fingerprint };
}

function ledgerBody(record: Omit<VerificationLedgerRecord, 'contentHash'>): string {
  return canonicalJson(record);
}

export function hashVerificationLedgerBody(
  record: Omit<VerificationLedgerRecord, 'contentHash'>
): string {
  return sha256Hex(ledgerBody(record));
}

export function persistVerificationLedgerFromReporterFile(params: {
  repoRoot: string;
  workstreamId: string;
  commandId: string;
  commandType: VerificationLedgerCommandType;
  command: string;
  args: string[];
  cwd: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  runnerName: string;
  runnerVersion: string;
  reporterAbsolutePath: string;
  requiredIds?: string[];
  expectedSuiteManifestHash?: string;
  persist?: boolean;
  git?: GitCommandRunner;
  beforeIdentity: { headCommit: string; productTreeFingerprint: string };
  afterIdentity: { headCommit: string; productTreeFingerprint: string };
}):
  | {
      ok: true;
      record: VerificationLedgerRecord;
      reference: VerificationLedgerReference;
    }
  | { ok: false; message: string } {
  if (params.beforeIdentity.headCommit !== params.afterIdentity.headCommit) {
    return { ok: false, message: 'git HEAD moved during verification; ledger is unbound' };
  }
  if (params.beforeIdentity.productTreeFingerprint !== params.afterIdentity.productTreeFingerprint) {
    return {
      ok: false,
      message: 'product tree fingerprint moved during verification; ledger is unbound',
    };
  }
  if (
    !SHA_RE.test(params.beforeIdentity.headCommit) ||
    !SHA256_RE.test(params.beforeIdentity.productTreeFingerprint)
  ) {
    return { ok: false, message: 'verification identity is malformed' };
  }
  if (!existsSync(params.reporterAbsolutePath)) {
    return { ok: false, message: 'vitest JSON reporter output is missing' };
  }
  const raw = readFileSync(params.reporterAbsolutePath);
  const mappedRequiredIds = [...(params.requiredIds ?? [])].sort();
  const projected = projectExecutedTestsFromReporter({
    repoRoot: params.repoRoot,
    reporterRaw: raw,
    requiredIds: mappedRequiredIds,
  });
  if (!projected.ok) return projected;
  const reporterOutputHash = sha256Hex(raw);
  const runId = randomBytes(8).toString('hex');
  const draft: Omit<VerificationLedgerRecord, 'contentHash'> = {
    schemaVersion: VERIFICATION_LEDGER_SCHEMA_VERSION,
    runId,
    commandId: params.commandId,
    commandType: params.commandType,
    command: params.command,
    args: [...params.args],
    cwd: params.cwd,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    exitCode: params.exitCode,
    headCommit: params.beforeIdentity.headCommit,
    productTreeFingerprint: params.beforeIdentity.productTreeFingerprint,
    runnerName: params.runnerName,
    runnerVersion: params.runnerVersion,
    reporterOutputHash,
    expectedSuiteManifestHash: params.expectedSuiteManifestHash,
    mappedRequiredIds,
    executedTests: projected.executedTests,
  };
  const contentHash = hashVerificationLedgerBody(draft);
  const record: VerificationLedgerRecord = { ...draft, contentHash };
  const relativeLedger = `docs_private/automation/workstreams/${params.workstreamId}/verification-ledger-${contentHash}.json`;
  const relativeReporter = `docs_private/automation/workstreams/${params.workstreamId}/verification-reporter-${reporterOutputHash}.json`;
  const ledgerPath = assertTrustedWorkstreamEvidencePath({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    candidatePath: relativeLedger,
  });
  const reporterPath = assertTrustedWorkstreamEvidencePath({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    candidatePath: relativeReporter,
  });
  if (!ledgerPath.ok) return ledgerPath;
  if (!reporterPath.ok) return reporterPath;
  if (params.persist !== false) {
    mkdirSync(workstreamEvidenceDirectory(params.repoRoot, params.workstreamId), {
      recursive: true,
    });
    writeFileSync(reporterPath.absolutePath, raw);
    writeJsonAtomic(ledgerPath.absolutePath, record);
  }
  return {
    ok: true,
    record,
    reference: {
      relativePath: ledgerPath.relativePath,
      contentHash,
      commandType: params.commandType,
      reporterRelativePath: reporterPath.relativePath,
      reporterOutputHash,
    },
  };
}

export function readAndValidateVerificationLedger(params: {
  repoRoot: string;
  workstreamId: string;
  relativePath: string;
  expectedFingerprint: string;
  expectedHeadCommit: string;
}):
  | { ok: true; record: VerificationLedgerRecord; reporterRaw: Buffer }
  | { ok: false; message: string } {
  const ledgerPath = assertTrustedWorkstreamEvidencePath({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    candidatePath: params.relativePath,
  });
  if (!ledgerPath.ok) return ledgerPath;
  if (!existsSync(ledgerPath.absolutePath)) {
    return { ok: false, message: `verification ledger missing: ${params.relativePath}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(ledgerPath.absolutePath, 'utf8'));
  } catch {
    return { ok: false, message: 'verification ledger is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'verification ledger is malformed' };
  }
  const row = parsed as JsonObject;
  if (row.schemaVersion !== VERIFICATION_LEDGER_SCHEMA_VERSION) {
    return { ok: false, message: 'verification ledger schemaVersion is unsupported' };
  }
  if (typeof row.contentHash !== 'string' || !SHA256_RE.test(row.contentHash)) {
    return { ok: false, message: 'verification ledger contentHash is missing' };
  }
  const expectedName = `verification-ledger-${row.contentHash}.json`;
  if (path.basename(ledgerPath.relativePath) !== expectedName) {
    return { ok: false, message: 'verification ledger filename does not match contentHash' };
  }
  const { contentHash: _ignored, ...body } = row;
  const recomputed = hashVerificationLedgerBody(
    body as Omit<VerificationLedgerRecord, 'contentHash'>
  );
  if (recomputed !== row.contentHash) {
    return { ok: false, message: 'verification ledger contentHash does not match canonical body' };
  }
  if (typeof row.reporterOutputHash !== 'string' || !SHA256_RE.test(row.reporterOutputHash)) {
    return { ok: false, message: 'verification ledger reporterOutputHash is missing' };
  }
  const reporterRelative = `docs_private/automation/workstreams/${params.workstreamId}/verification-reporter-${row.reporterOutputHash}.json`;
  const reporterPath = assertTrustedWorkstreamEvidencePath({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    candidatePath: reporterRelative,
  });
  if (!reporterPath.ok) return reporterPath;
  if (!existsSync(reporterPath.absolutePath)) {
    return { ok: false, message: 'verification reporter projection is missing' };
  }
  const reporterRaw = readFileSync(reporterPath.absolutePath);
  if (sha256Hex(reporterRaw) !== row.reporterOutputHash) {
    return { ok: false, message: 'verification reporter projection hash mismatch' };
  }
  if (row.headCommit !== params.expectedHeadCommit) {
    return { ok: false, message: 'verification ledger HEAD does not match the candidate tree' };
  }
  if (row.productTreeFingerprint !== params.expectedFingerprint) {
    return {
      ok: false,
      message: 'verification ledger product fingerprint does not match the candidate tree',
    };
  }
  if (typeof row.exitCode !== 'number') {
    return { ok: false, message: 'verification ledger exitCode is missing' };
  }
  if (!Array.isArray(row.executedTests)) {
    return { ok: false, message: 'verification ledger executedTests is missing' };
  }
  if (!Array.isArray(row.mappedRequiredIds) || row.mappedRequiredIds.some((id) => typeof id !== 'string')) {
    return { ok: false, message: 'verification ledger mappedRequiredIds is missing' };
  }
  const projected = projectExecutedTestsFromReporter({
    repoRoot: params.repoRoot,
    reporterRaw,
    requiredIds: row.mappedRequiredIds as string[],
  });
  if (!projected.ok) return projected;
  if (canonicalJson(projected.executedTests) !== canonicalJson(row.executedTests)) {
    return {
      ok: false,
      message: 'verification ledger executedTests does not match the reporter projection',
    };
  }
  return { ok: true, record: parsed as VerificationLedgerRecord, reporterRaw };
}

export function proveCanonicalWorkflowSuite(params: {
  record: VerificationLedgerRecord;
  reporterSuccess: boolean;
  manifest?: CanonicalWorkflowSuiteManifest;
}): { ok: true } | { ok: false; message: string } {
  const manifest = params.manifest ?? loadCanonicalWorkflowSuiteManifest();
  const expectedHash = hashCanonicalWorkflowSuiteManifest(manifest);
  if (params.record.expectedSuiteManifestHash !== expectedHash) {
    return { ok: false, message: 'canonical suite manifest hash is missing or mismatched' };
  }
  if (params.record.commandType !== 'vitest_suite') {
    return { ok: false, message: 'canonical suite proof requires commandType vitest_suite' };
  }
  if (params.record.exitCode !== 0 || params.reporterSuccess !== true) {
    return { ok: false, message: 'canonical suite run did not succeed' };
  }
  if (params.record.executedTests.length === 0) {
    return { ok: false, message: 'canonical suite selected zero tests' };
  }
  const actualFiles = [...new Set(params.record.executedTests.map((test) => test.file))].sort();
  const expectedFiles = [...manifest.files].sort();
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    return {
      ok: false,
      message: 'executed file set does not equal the canonical workflow suite manifest',
    };
  }
  for (const file of expectedFiles) {
    const assertions = params.record.executedTests.filter((test) => test.file === file);
    if (assertions.length === 0) {
      return { ok: false, message: `canonical suite file produced no assertions: ${file}` };
    }
    if (!assertions.some((test) => test.status === 'passed')) {
      return { ok: false, message: `canonical suite file has no passed assertion: ${file}` };
    }
    if (assertions.some((test) => test.status === 'failed' || test.status === 'unknown')) {
      return { ok: false, message: `canonical suite file is not fully successful: ${file}` };
    }
  }
  return { ok: true };
}

export function provenVitestCaseIds(params: {
  records: VerificationLedgerRecord[];
  requiredIds: string[];
}): ProvenRequiredTests | ProvenRequiredTestsFailure {
  const requiredCaseIds = params.requiredIds.filter(
    (id) => requiredTestProofKind(id) === 'vitest_case'
  );
  const proven = new Set<string>();
  for (const id of requiredCaseIds) {
    const matches: VerificationLedgerExecutedTest[] = [];
    for (const record of params.records) {
      for (const test of record.executedTests) {
        const identity = `${test.fullName}\n${test.title}`;
        if (titleContainsExactRequiredId(identity, id) || test.canonicalId === id) {
          matches.push(test);
        }
      }
    }
    const uniqueAssertions = [
      ...new Map(matches.map((test) => [`${test.file}::${test.fullName}`, test])).values(),
    ];
    if (uniqueAssertions.length > 1) {
      return {
        ok: false,
        message: `required test ID ${id} maps to multiple assertions; fail closed`,
        provenIds: [...proven].sort(),
        suiteProven: false,
      };
    }
    const only = uniqueAssertions[0];
    if (only && only.status === 'passed') {
      proven.add(id);
    }
  }
  return { ok: true, provenIds: [...proven].sort(), suiteProven: false };
}

export function requiredTestIdsForBlocker(blockerId: string): string[] {
  const mapped = BLOCKER_REQUIRED_TEST_IDS[blockerId];
  if (mapped && mapped.length > 0) return [...mapped];
  return [blockerId];
}

export function installedVitestVersion(repoRoot: string): string | { error: string } {
  const packagePath = path.join(repoRoot, 'node_modules', 'vitest', 'package.json');
  if (!existsSync(packagePath)) {
    return { error: 'installed vitest package.json is missing' };
  }
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
    if (typeof parsed.version !== 'string' || !parsed.version) {
      return { error: 'installed vitest version is missing' };
    }
    return parsed.version;
  } catch {
    return { error: 'installed vitest package.json is unreadable' };
  }
}

export function resolveVitestExecutable(repoRoot: string): string | { error: string } {
  const candidates = [
    path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
    path.join(repoRoot, 'node_modules', 'vitest', 'dist', 'cli.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return { error: 'installed vitest CLI is missing' };
}

export function captureVerificationIdentity(
  repoRoot: string,
  git?: GitCommandRunner
): { ok: true; headCommit: string; productTreeFingerprint: string } | { ok: false; message: string } {
  return captureCandidateIdentity(repoRoot, git);
}

export function runVitestJsonAndPersistLedger(params: {
  repoRoot: string;
  workstreamId: string;
  commandId: string;
  commandType: VerificationLedgerCommandType;
  files: string[];
  extraArgs?: string[];
  requiredIds?: string[];
  expectedSuiteManifestHash?: string;
  persist?: boolean;
  git?: GitCommandRunner;
  spawn?: typeof spawnSync;
  vitestInstallRoot?: string;
}):
  | {
      ok: true;
      record: VerificationLedgerRecord;
      reference: VerificationLedgerReference;
      reporterSuccess: boolean;
    }
  | { ok: false; message: string } {
  const before = captureCandidateIdentity(params.repoRoot, params.git);
  if (!before.ok) return before;
  const installRoot = params.vitestInstallRoot ?? params.repoRoot;
  const vitestPath = resolveVitestExecutable(installRoot);
  if (typeof vitestPath === 'object') return { ok: false, message: vitestPath.error };
  const runnerVersion = installedVitestVersion(installRoot);
  if (typeof runnerVersion === 'object') return { ok: false, message: runnerVersion.error };
  const runToken = randomBytes(8).toString('hex');
  const outputDir =
    params.persist === false
      ? mkdtempSync(path.join(tmpdir(), 'avs-verification-ledger-'))
      : workstreamEvidenceDirectory(params.repoRoot, params.workstreamId);
  if (params.persist !== false) {
    mkdirSync(outputDir, { recursive: true });
  }
  const reporterTemp = path.join(outputDir, `verification-reporter-temp-${runToken}.json`);
  const args = [
    vitestPath,
    'run',
    ...params.files,
    '--reporter=json',
    `--outputFile=${reporterTemp}`,
    '--passWithNoTests=false',
    ...(params.commandType === 'vitest_suite' ? ['--maxWorkers=1'] : []),
    ...(params.extraArgs ?? []),
  ];
  const startedAt = new Date().toISOString();
  const spawn = params.spawn ?? spawnSync;
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key === 'VITEST' || key.startsWith('VITEST_') || key.startsWith('VITE_TEST')) {
      delete childEnv[key];
    }
  }
  const result = spawn(process.execPath, args, {
    cwd: params.repoRoot,
    encoding: 'utf8',
    shell: false,
    env: childEnv,
    windowsHide: true,
  });
  const completedAt = new Date().toISOString();
  const after = captureCandidateIdentity(params.repoRoot, params.git);
  if (!after.ok) return after;
  if (result.error) {
    return { ok: false, message: `vitest spawn failed: ${result.error.message}` };
  }
  const persisted = persistVerificationLedgerFromReporterFile({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
    commandId: params.commandId,
    commandType: params.commandType,
    command: process.execPath,
    args,
    cwd: params.repoRoot,
    startedAt,
    completedAt,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    runnerName: 'vitest',
    runnerVersion,
    reporterAbsolutePath: reporterTemp,
    requiredIds: params.requiredIds,
    expectedSuiteManifestHash: params.expectedSuiteManifestHash,
    persist: params.persist,
    git: params.git,
    beforeIdentity: before,
    afterIdentity: after,
  });
  const reporterRaw = existsSync(reporterTemp) ? readFileSync(reporterTemp) : null;
  if (existsSync(reporterTemp)) {
    try {
      unlinkSync(reporterTemp);
    } catch {
      /* the hashed reporter copy is the durable artifact */
    }
  }
  if (!persisted.ok) return persisted;
  const parsed = parseVitestJsonReporter(
    params.persist === false
      ? reporterRaw ?? Buffer.alloc(0)
      : readFileSync(path.join(params.repoRoot, persisted.reference.reporterRelativePath))
  );
  return {
    ...persisted,
    reporterSuccess: parsed.ok ? parsed.success : false,
  };
}
