import { createHash } from 'crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import type {
  WorkflowProtocolRecord,
  WorkflowProtocolReviewAttempt,
  WorkflowRehomeProvenance,
  WorkflowRouteDisposition,
  WorkflowRouteDispositionTarget,
  WorkflowRouteGitEvidence,
} from './types';
import { pathHasSymlinkComponent } from './workflow-plan-contract';

export const WORKFLOW_NON_RELEASE_PHASES = [
  'removed_from_release',
  'reverted',
  'superseded',
  'rehomed',
] as const;

const SHA_RE = /^[0-9a-f]{7,64}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,120}$/;

export function lineageFailedPremiumReviewCount(record: {
  failedPremiumReviewCount: number;
  inheritedFailedReviewCount: number;
}): number {
  return Math.max(record.failedPremiumReviewCount, record.inheritedFailedReviewCount);
}

export function lineageBudgetExhausted(record: WorkflowProtocolRecord): boolean {
  return lineageFailedPremiumReviewCount(record) >= 2;
}

export function lineageFirstConsumed(record: WorkflowProtocolRecord): boolean {
  return (
    record.inheritedFailedReviewCount >= 1 ||
    record.failedPremiumReviewCount >= 1 ||
    record.reviewAttempts.some((attempt) => attempt.pass === 'first')
  );
}

export function isApprovalValidReviewEvidence(
  attempt: WorkflowProtocolReviewAttempt,
  record: WorkflowProtocolRecord
): boolean {
  if (attempt.result !== 'passed') return false;
  if (lineageBudgetExhausted(record) && attempt.pass !== 'delta') return false;
  return attempt.pass === 'first' || attempt.pass === 'closure' || attempt.pass === 'delta';
}

export function isNonReleaseDispositionPhase(
  phase: WorkflowProtocolRecord['phase']
): boolean {
  return (WORKFLOW_NON_RELEASE_PHASES as readonly string[]).includes(phase);
}

function isProtocolRecord(value: unknown): value is WorkflowProtocolRecord {
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

export function readForeignProtocolRecord(
  repoRoot: string,
  workstreamId: string
): WorkflowProtocolRecord | null {
  const protocolPath = path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    workstreamId,
    'protocol.json'
  );
  if (!existsSync(protocolPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(protocolPath, 'utf8')) as unknown;
    return isProtocolRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type LegalReviewCandidateResolution =
  | {
      ok: true;
      headCommit: string;
      pass: 'first' | 'closure';
      token: string;
      legalAttempts: WorkflowProtocolReviewAttempt[];
    }
  | { ok: false; message: string };

function collectLineageReviewAttempts(
  repoRoot: string,
  record: WorkflowProtocolRecord,
  seen: Set<string>
): WorkflowProtocolReviewAttempt[] | { error: string } {
  if (seen.has(record.workstreamId)) {
    return { error: 'cyclic split lineage while resolving review candidates' };
  }
  seen.add(record.workstreamId);
  const parentIds = record.sourceWorkstreamIds ?? [];
  if (parentIds.length > 1) {
    return { error: 'ambiguous split lineage while resolving review candidates' };
  }
  let prefix: WorkflowProtocolReviewAttempt[] = [];
  const parentId = parentIds[0];
  if (parentId) {
    const parent = readForeignProtocolRecord(repoRoot, parentId);
    if (!parent) {
      return { error: `split parent protocol missing: ${parentId}` };
    }
    const nested = collectLineageReviewAttempts(repoRoot, parent, seen);
    if ('error' in nested) return nested;
    prefix = nested;
  }
  return [...prefix, ...record.reviewAttempts];
}

function classifyLegalPremiumAttempts(
  attempts: WorkflowProtocolReviewAttempt[]
): { ok: true; legal: WorkflowProtocolReviewAttempt[] } | { ok: false; message: string } {
  const tokens = new Set<string>();
  const legal: WorkflowProtocolReviewAttempt[] = [];
  for (const attempt of attempts) {
    if (!attempt.token || tokens.has(attempt.token)) {
      return { ok: false, message: 'review history has missing or duplicate review tokens' };
    }
    tokens.add(attempt.token);
    if (attempt.pass === 'delta') continue;
    if (attempt.pass !== 'first' && attempt.pass !== 'closure') {
      return { ok: false, message: 'review history contains an unrecognised pass' };
    }
    if (attempt.result !== 'passed' && attempt.result !== 'failed') {
      return {
        ok: false,
        message: 'review history is incomplete; latest legal review candidate cannot be determined',
      };
    }
    if (legal.length >= 2) {
      continue;
    }
    if (attempt.pass === 'first') {
      if (legal.length !== 0) {
        return { ok: false, message: 'review history has an out-of-order or duplicate first attempt' };
      }
      legal.push(attempt);
      continue;
    }
    if (legal.length !== 1 || legal[0]?.pass !== 'first') {
      return { ok: false, message: 'review history has an out-of-order closure attempt' };
    }
    legal.push(attempt);
  }
  if (legal.length === 0) {
    return { ok: false, message: 'latest legal review attempt cannot be determined' };
  }
  return { ok: true, legal };
}

export function resolveLatestLegalReviewCandidateHead(
  repoRoot: string,
  record: WorkflowProtocolRecord
): LegalReviewCandidateResolution {
  const attempts = collectLineageReviewAttempts(repoRoot, record, new Set());
  if ('error' in attempts) return { ok: false, message: attempts.error };
  const classified = classifyLegalPremiumAttempts(attempts);
  if (!classified.ok) return classified;
  const latest = classified.legal[classified.legal.length - 1];
  if (!latest || (latest.pass !== 'first' && latest.pass !== 'closure')) {
    return { ok: false, message: 'latest legal review attempt cannot be determined' };
  }
  if (!latest.headCommit) {
    return { ok: false, message: 'legal review attempt is missing its candidate HEAD' };
  }
  const candidate = resolveCommitObject(repoRoot, latest.headCommit);
  if (!candidate) {
    return { ok: false, message: 'latest legal review candidate HEAD does not exist as a git commit object' };
  }
  const baseline = resolveCommitObject(repoRoot, record.baseCommit);
  if (!baseline) {
    return { ok: false, message: 'source baseline does not exist as a git commit object' };
  }
  if (candidate !== baseline) {
    const owned = requireCommitAncestor(
      repoRoot,
      baseline,
      candidate,
      'latest legal review candidate HEAD is outside owned ancestry'
    );
    if (!owned.ok) return owned;
  }
  if (classified.legal.length === 2) {
    const firstHead = classified.legal[0]?.headCommit
      ? resolveCommitObject(repoRoot, classified.legal[0].headCommit)
      : null;
    if (!firstHead) {
      return { ok: false, message: 'first-review candidate HEAD does not exist as a git commit object' };
    }
    if (candidate !== firstHead) {
      const descendant = requireCommitAncestor(
        repoRoot,
        firstHead,
        candidate,
        'closure candidate is not a descendant of the first-review candidate'
      );
      if (!descendant.ok) return descendant;
    }
  }
  return {
    ok: true,
    headCommit: candidate,
    pass: latest.pass,
    token: latest.token,
    legalAttempts: classified.legal,
  };
}

export type HeadDriftRejection =
  | { ok: true }
  | { ok: false; kind: 'git-error' | 'unreviewed-implementation'; message: string };

export function rejectUnreviewedHeadDrift(
  repoRoot: string,
  candidateHead: string,
  currentHead: string | null,
  git: GitCommandRunner = defaultGitCommandRunner
): HeadDriftRejection {
  if (!currentHead) {
    return {
      ok: false,
      kind: 'git-error',
      message: 'unable to read current HEAD for drift inspection',
    };
  }
  if (!SHA_RE.test(currentHead) || !SHA_RE.test(candidateHead)) {
    return { ok: false, kind: 'git-error', message: 'malformed commit identity for drift inspection' };
  }
  if (candidateHead === currentHead) return { ok: true };
  const ancestry = inspectCommitAncestry(repoRoot, candidateHead, currentHead, git);
  if (ancestry.status === 'error') {
    return { ok: false, kind: 'git-error', message: ancestry.message };
  }
  if (ancestry.status === 'not_ancestor') return { ok: true };
  const extras = listOrderedImplementationCommits(repoRoot, candidateHead, currentHead, git);
  if (typeof extras === 'object' && 'error' in extras) {
    return { ok: false, kind: 'git-error', message: extras.error };
  }
  if (extras.length > 0) {
    return {
      ok: false,
      kind: 'unreviewed-implementation',
      message:
        'unreviewed implementation after the latest legal review candidate; refuse to enlarge the routed range',
    };
  }
  return { ok: true };
}

export interface GitCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type GitCommandRunner = (repoRoot: string, args: string[]) => GitCommandResult;

export function defaultGitCommandRunner(repoRoot: string, args: string[]): GitCommandResult {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

function runGit(
  repoRoot: string,
  args: string[],
  git: GitCommandRunner = defaultGitCommandRunner
): { status: number; stdout: string; error?: string } {
  try {
    const result = git(repoRoot, args);
    if (result.error) {
      return { status: 1, stdout: '', error: result.error.message };
    }
    return {
      status: result.status ?? 1,
      stdout: (result.stdout ?? '').replace(/(?:\r?\n)+\s*$/u, ''),
      error: undefined,
    };
  } catch (error) {
    return {
      status: 1,
      stdout: '',
      error: error instanceof Error ? error.message : 'git command threw',
    };
  }
}

export type AncestryInspection =
  | { status: 'ancestor' }
  | { status: 'not_ancestor' }
  | { status: 'error'; message: string };

export function inspectCommitAncestry(
  repoRoot: string,
  maybeAncestor: string,
  descendant: string,
  git: GitCommandRunner = defaultGitCommandRunner
): AncestryInspection {
  if (!SHA_RE.test(maybeAncestor) || !SHA_RE.test(descendant)) {
    return { status: 'error', message: 'malformed commit identity for ancestry inspection' };
  }
  let result: GitCommandResult;
  try {
    result = git(repoRoot, ['merge-base', '--is-ancestor', maybeAncestor, descendant]);
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'git ancestry inspection threw',
    };
  }
  if (result.error) {
    return { status: 'error', message: result.error.message };
  }
  if (result.status === 0) return { status: 'ancestor' };
  const stderr = (result.stderr ?? '').trim();
  if (result.status === 1 && !/fatal:/iu.test(stderr)) {
    return { status: 'not_ancestor' };
  }
  if (result.status === null) {
    return { status: 'error', message: 'git ancestry inspection returned no status' };
  }
  return {
    status: 'error',
    message: stderr || `git merge-base --is-ancestor failed (status ${String(result.status)})`,
  };
}

export function requireCommitAncestor(
  repoRoot: string,
  maybeAncestor: string,
  descendant: string,
  failMessage: string,
  git?: GitCommandRunner
): { ok: true } | { ok: false; message: string } {
  const inspection = inspectCommitAncestry(repoRoot, maybeAncestor, descendant, git);
  if (inspection.status === 'ancestor') return { ok: true };
  if (inspection.status === 'error') return { ok: false, message: inspection.message };
  return { ok: false, message: failMessage };
}

export function requireCommitNotAncestor(
  repoRoot: string,
  maybeAncestor: string,
  descendant: string,
  failMessage: string,
  git?: GitCommandRunner
): { ok: true } | { ok: false; message: string } {
  const inspection = inspectCommitAncestry(repoRoot, maybeAncestor, descendant, git);
  if (inspection.status === 'not_ancestor') return { ok: true };
  if (inspection.status === 'ancestor') return { ok: false, message: failMessage };
  if (inspection.status === 'error') {
    const mentionsPredecessor =
      inspection.message.includes(maybeAncestor) ||
      (maybeAncestor.length >= 7 && inspection.message.includes(maybeAncestor.slice(0, 7)));
    const missingObject = /not a valid (?:object|commit) name|bad object|unknown revision/iu.test(
      inspection.message
    );
    if (mentionsPredecessor && missingObject) return { ok: true };
    return { ok: false, message: inspection.message };
  }
  return { ok: false, message: failMessage };
}

export function filterAncestorCommits(
  repoRoot: string,
  commits: string[],
  descendant: string,
  git?: GitCommandRunner
): { ok: true; ancestors: string[] } | { ok: false; message: string } {
  const ancestors: string[] = [];
  for (const commit of commits) {
    const inspection = inspectCommitAncestry(repoRoot, commit, descendant, git);
    if (inspection.status === 'error') return { ok: false, message: inspection.message };
    if (inspection.status === 'ancestor') ancestors.push(commit);
  }
  return { ok: true, ancestors };
}

export function gitHeadCommit(
  repoRoot: string,
  git: GitCommandRunner = defaultGitCommandRunner
): string | null {
  const result = runGit(repoRoot, ['rev-parse', 'HEAD'], git);
  if (result.error || result.status !== 0) return null;
  return SHA_RE.test(result.stdout) ? result.stdout : null;
}

export function gitBranchName(
  repoRoot: string,
  git: GitCommandRunner = defaultGitCommandRunner
): string | null {
  const result = runGit(repoRoot, ['branch', '--show-current'], git);
  if (result.error || result.status !== 0) return null;
  return result.stdout ? result.stdout : null;
}

export function isCommitAncestor(
  repoRoot: string,
  maybeAncestor: string,
  descendant: string,
  git?: GitCommandRunner
): boolean {
  const inspection = inspectCommitAncestry(repoRoot, maybeAncestor, descendant, git);
  if (inspection.status === 'error') {
    throw new Error(inspection.message);
  }
  return inspection.status === 'ancestor';
}

export function resolveCanonicalExistingPath(candidate: string): {
  ok: true;
  canonical: string;
} | { ok: false; message: string } {
  if (!candidate.trim()) return { ok: false, message: 'path required' };
  if (candidate.includes('\0') || candidate.includes('\n')) {
    return { ok: false, message: 'path contains illegal characters' };
  }
  const absolute = path.resolve(candidate);
  if (pathHasSymlinkComponent(absolute)) {
    return { ok: false, message: `refusing symlink path ${absolute}` };
  }
  if (!existsSync(absolute)) {
    return { ok: false, message: `path does not exist: ${absolute}` };
  }
  return { ok: true, canonical: absolute.replace(/\\/g, '/') };
}

function requireSha(value: string | undefined, label: string): string | { error: string } {
  const trimmed = value?.trim() ?? '';
  if (!SHA_RE.test(trimmed)) return { error: `${label} must be a git commit hash` };
  return trimmed;
}

export function parsePredecessorReleaseContext(value: string):
  | { ok: true; repoPath: string; branchName: string }
  | { ok: false; message: string } {
  const trimmed = value.trim();
  const hashAt = trimmed.lastIndexOf('#');
  if (hashAt <= 0 || hashAt === trimmed.length - 1) {
    return { ok: false, message: 'predecessorReleaseContext must be path#branch' };
  }
  return {
    ok: true,
    repoPath: trimmed.slice(0, hashAt),
    branchName: trimmed.slice(hashAt + 1),
  };
}

export const REHOME_EVIDENCE_CANON_VERSION = 'tee-v24-rehome-evidence-v2' as const;

function isWorkflowAutomationPath(relative: string): boolean {
  const normalized = relative.replace(/\\/g, '/');
  return (
    normalized === 'docs_private/automation' ||
    normalized.startsWith('docs_private/automation/')
  );
}

export function canonicalizeEvidence(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalizeEvidence(entry));
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    if (input[key] === undefined) continue;
    output[key] = canonicalizeEvidence(input[key]);
  }
  return output;
}

export function hashCanonicalEvidence(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeEvidence(value)))
    .digest('hex');
}

function hashLegacyEvidence(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function resolveCommitObject(repoRoot: string, sha: string): string | null {
  if (!SHA_RE.test(sha)) return null;
  const result = runGit(repoRoot, ['rev-parse', '--verify', `${sha}^{commit}`]);
  return result.status === 0 && SHA_RE.test(result.stdout) ? result.stdout : null;
}

export function gitCommitExists(repoRoot: string, sha: string): boolean {
  return resolveCommitObject(repoRoot, sha) !== null;
}

export function resolveBranchCommit(
  repoRoot: string,
  branchName: string
): { ok: true; sha: string } | { ok: false; message: string } {
  if (!BRANCH_RE.test(branchName)) {
    return { ok: false, message: `predecessor branch name is invalid: ${branchName}` };
  }
  const result = runGit(repoRoot, ['rev-parse', '--verify', `refs/heads/${branchName}`]);
  if (result.status !== 0 || !SHA_RE.test(result.stdout)) {
    return { ok: false, message: `predecessor branch does not exist: ${branchName}` };
  }
  const sha = resolveCommitObject(repoRoot, result.stdout);
  if (!sha) {
    return { ok: false, message: `predecessor branch ${branchName} does not resolve to a commit` };
  }
  return { ok: true, sha };
}

export function requireOrderedCommitObjects(
  repoRoot: string,
  values: string[] | undefined
): string[] | { error: string } {
  if (!values || values.length === 0) {
    return { error: 'disposition requires implementation commit evidence' };
  }
  const resolved: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value !== value.trim() || !SHA_RE.test(value)) {
      return { error: `implementation commit is not a canonical git commit hash: ${String(value)}` };
    }
    const full = resolveCommitObject(repoRoot, value);
    if (!full) {
      return { error: `implementation commit is not a git commit object: ${value}` };
    }
    resolved.push(full);
  }
  return resolved;
}

export function requireGitDerivedImplementationCommits(params: {
  repoRoot: string;
  baselineCommit: string;
  headCommit: string;
  claimed?: string[];
}): string[] | { error: string } {
  const derived = listOrderedImplementationCommits(
    params.repoRoot,
    params.baselineCommit,
    params.headCommit
  );
  if (typeof derived === 'object' && 'error' in derived) return derived;
  if (derived.length === 0) {
    return { error: 'disposition requires implementation commit evidence' };
  }
  const claimed = requireOrderedCommitObjects(params.repoRoot, params.claimed);
  if (typeof claimed === 'object' && 'error' in claimed) return claimed;
  if (new Set(claimed).size !== claimed.length) {
    return { error: 'implementation commits must not contain duplicates' };
  }
  if (claimed.length !== derived.length || claimed.some((sha, index) => sha !== derived[index])) {
    return { error: 'implementation commits do not match the git-derived base..HEAD range' };
  }
  return derived;
}

export function listOrderedImplementationCommits(
  repoRoot: string,
  baselineCommit: string,
  headCommit: string,
  git?: GitCommandRunner
): string[] | { error: string } {
  const baseline = resolveCommitObject(repoRoot, baselineCommit);
  const head = resolveCommitObject(repoRoot, headCommit);
  if (!baseline) return { error: 'source baseline does not exist as a git commit object' };
  if (!head) return { error: 'source HEAD does not exist as a git commit object' };
  const result = runGit(repoRoot, ['rev-list', '--reverse', `${baseline}..${head}`], git);
  if (result.status !== 0 || result.error) {
    return { error: result.error ?? 'unable to derive source implementation commits from git' };
  }
  const commits = result.stdout ? result.stdout.split(/\n/u).filter(Boolean) : [];
  if (commits.length === 0) return [];
  return requireOrderedCommitObjects(repoRoot, commits);
}

const GIT_BINARY_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function gitSpawnBuffer(repoRoot: string, args: string[]): { status: number; stdout: Buffer; error?: string } {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: GIT_BINARY_MAX_BUFFER_BYTES,
    shell: false,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    error: result.error?.message,
  };
}

const GIT_CAT_FILE_BATCH_CHUNK = 16;

function parseLsTreeEntries(stdout: Buffer): Array<{ sha: string; path: string }> {
  const entries: Array<{ sha: string; path: string }> = [];
  let offset = 0;
  while (offset < stdout.length) {
    const nul = stdout.indexOf(0, offset);
    const end = nul === -1 ? stdout.length : nul;
    const record = stdout.subarray(offset, end).toString('utf8');
    offset = nul === -1 ? stdout.length : nul + 1;
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const meta = record.slice(0, tab);
    const relative = record.slice(tab + 1).replace(/\\/g, '/');
    const parts = meta.split(' ');
    const sha = parts[2];
    const type = parts[1];
    if (type !== 'blob' || !sha || !relative || isWorkflowAutomationPath(relative)) continue;
    entries.push({ sha, path: relative });
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function parseCatFileBatch(stdout: Buffer, expectedCount: number): Buffer[] | { error: string } {
  const blobs: Buffer[] = [];
  let offset = 0;
  while (blobs.length < expectedCount) {
    const nl = stdout.indexOf(0x0a, offset);
    if (nl === -1) return { error: 'truncated git cat-file batch header' };
    const header = stdout.subarray(offset, nl).toString('utf8');
    const parts = header.split(' ');
    if (parts[1] === 'missing' || parts.length < 3) {
      return { error: `git object missing from cat-file batch: ${header}` };
    }
    const size = Number(parts[2]);
    if (!Number.isInteger(size) || size < 0) return { error: `invalid git cat-file size: ${header}` };
    const start = nl + 1;
    const end = start + size;
    if (end > stdout.length) return { error: 'truncated git cat-file batch content' };
    blobs.push(stdout.subarray(start, end));
    if (end < stdout.length && stdout[end] === 0x0a) {
      offset = end + 1;
    } else if (end === stdout.length && blobs.length === expectedCount) {
      offset = end;
    } else {
      return { error: 'git cat-file batch framing mismatch' };
    }
  }
  return blobs;
}

function gitCatFileBatch(repoRoot: string, shas: string[]): Buffer[] | { error: string } {
  if (shas.length === 0) return [];
  const dir = mkdtempSync(path.join(tmpdir(), 'tee-git-batch-'));
  const listPath = path.join(dir, 'shas.txt');
  writeFileSync(listPath, `${shas.join('\n')}\n`);
  let fd: number | undefined;
  try {
    fd = openSync(listPath, 'r');
    const result = spawnSync('git', ['cat-file', '--batch'], {
      cwd: repoRoot,
      encoding: 'buffer',
      maxBuffer: GIT_BINARY_MAX_BUFFER_BYTES,
      shell: false,
      windowsHide: true,
      stdio: [fd, 'pipe', 'pipe'],
    });
    if ((result.status ?? 1) !== 0) {
      return { error: result.error?.message ?? 'git cat-file --batch failed' };
    }
    return parseCatFileBatch(result.stdout ?? Buffer.alloc(0), shas.length);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(listPath);
    } catch {
      /* ignore */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function computeGitProductTreeFingerprint(
  repoRoot: string,
  commitSha: string
): string | { error: string } {
  // Hash git blob bytes, not the checked-out working tree, so CRLF/smudge
  // checkout differences cannot substitute for object identity.
  const commit = resolveCommitObject(repoRoot, commitSha);
  if (!commit) return { error: 'fingerprint commit does not exist as a git commit object' };
  const listed = gitSpawnBuffer(repoRoot, ['ls-tree', '-r', '-z', commit]);
  if (listed.status !== 0) {
    return { error: listed.error ?? 'unable to list git tree for fingerprint' };
  }
  const files = parseLsTreeEntries(listed.stdout);
  const hash = createHash('sha256');
  for (let index = 0; index < files.length; index += GIT_CAT_FILE_BATCH_CHUNK) {
    const chunk = files.slice(index, index + GIT_CAT_FILE_BATCH_CHUNK);
    const blobs = gitCatFileBatch(
      repoRoot,
      chunk.map((entry) => entry.sha)
    );
    if ('error' in blobs) return blobs;
    for (let blobIndex = 0; blobIndex < chunk.length; blobIndex += 1) {
      hash.update(chunk[blobIndex].path);
      hash.update('\0');
      hash.update(blobs[blobIndex]);
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

export function computeWorkingTreeProductFingerprint(
  repoRoot: string,
  git?: GitCommandRunner
): string | { error: string } {
  const tracked = runGit(repoRoot, ['ls-files', '-z'], git);
  const others = runGit(repoRoot, ['ls-files', '-z', '--others', '--exclude-standard'], git);
  if (tracked.status !== 0 || others.status !== 0 || tracked.error || others.error) {
    return { error: tracked.error ?? others.error ?? 'unable to list successor working tree for fingerprint' };
  }
  const files = [...tracked.stdout.split('\0'), ...others.stdout.split('\0')]
    .map((entry) => entry.replace(/\\/g, '/'))
    .filter((entry) => entry && !isWorkflowAutomationPath(entry));
  const unique = [...new Set(files)].sort();
  const hash = createHash('sha256');
  for (const relative of unique) {
    const absolute = path.join(repoRoot, relative);
    if (!existsSync(absolute)) continue;
    const content = readFileSync(absolute);
    hash.update(relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function computeGitPatchSha256(
  repoRoot: string,
  fromCommit: string,
  toCommit: string
): string | { error: string } {
  const from = resolveCommitObject(repoRoot, fromCommit);
  const to = resolveCommitObject(repoRoot, toCommit);
  if (!from) return { error: 'source baseline does not exist as a git commit object' };
  if (!to) return { error: 'source HEAD does not exist as a git commit object' };
  const result = spawnSync(
    'git',
    [
      'diff',
      '--binary',
      '--no-ext-diff',
      from,
      to,
      '--',
      '.',
      ':(exclude)docs_private/automation',
      ':(exclude)docs_private/automation/**',
    ],
    {
      cwd: repoRoot,
      encoding: 'buffer',
      maxBuffer: GIT_BINARY_MAX_BUFFER_BYTES,
      shell: false,
      windowsHide: true,
    }
  );
  if ((result.status ?? 1) !== 0 && result.status !== 1) {
    return { error: 'unable to derive source patch from git' };
  }
  return createHash('sha256')
    .update(result.stdout ?? Buffer.alloc(0))
    .digest('hex');
}

function gitParentCount(repoRoot: string, sha: string): number {
  const result = runGit(repoRoot, ['rev-list', '--parents', '-n', '1', sha]);
  if (result.status !== 0 || !result.stdout) return 0;
  return Math.max(0, result.stdout.split(/\s+/u).length - 1);
}

function gitDiffText(repoRoot: string, a: string, b: string): string | null {
  const result = spawnSync('git', ['diff', '--no-ext-diff', '--text', a, b], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0 && result.status !== 1) return null;
  return result.stdout ?? '';
}

export function revertInvertsImplementation(
  repoRoot: string,
  implementationCommit: string,
  revertCommit: string
): boolean {
  if (!gitCommitExists(repoRoot, implementationCommit) || !gitCommitExists(repoRoot, revertCommit)) {
    return false;
  }
  if (gitParentCount(repoRoot, implementationCommit) !== 1) return false;
  if (gitParentCount(repoRoot, revertCommit) !== 1) return false;
  const forward = gitDiffText(repoRoot, `${implementationCommit}^`, implementationCommit);
  const undone = gitDiffText(repoRoot, revertCommit, `${revertCommit}^`);
  return Boolean(forward && undone && forward === undone);
}

function routeEvidenceHashPayload(params: {
  target: WorkflowRouteDispositionTarget;
  baseline: string;
  releaseHead: string;
  implementationCommits: string[];
  latestLegalReviewCandidateHead?: string;
  revertCommit?: string | null;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorHead?: string;
}): unknown {
  if (params.target === 'removed_from_release') {
    return {
      target: params.target,
      baseline: params.baseline,
      releaseHead: params.releaseHead,
      implementationCommits: params.implementationCommits,
      latestLegalReviewCandidateHead: params.latestLegalReviewCandidateHead,
    };
  }
  if (params.target === 'reverted') {
    return {
      target: params.target,
      baseline: params.baseline,
      releaseHead: params.releaseHead,
      implementationCommits: params.implementationCommits,
      latestLegalReviewCandidateHead: params.latestLegalReviewCandidateHead,
      revertCommit: params.revertCommit,
    };
  }
  if (params.target === 'superseded') {
    return {
      target: params.target,
      baseline: params.baseline,
      releaseHead: params.releaseHead,
      implementationCommits: params.implementationCommits,
      latestLegalReviewCandidateHead: params.latestLegalReviewCandidateHead,
      supersedeCommit: params.supersedeCommit,
      revertCommit: params.revertCommit ?? null,
    };
  }
  return {
    canonVersion: REHOME_EVIDENCE_CANON_VERSION,
    target: params.target,
    baseline: params.baseline,
    releaseHead: params.releaseHead,
    implementationCommits: params.implementationCommits,
    latestLegalReviewCandidateHead: params.latestLegalReviewCandidateHead,
    successorRepo: params.successorRepo,
    successorBranch: params.successorBranch,
    successorBaseline: params.successorBaseline,
    predecessorHead: params.predecessorHead,
  };
}

export function computeRouteEvidenceHash(params: Parameters<typeof routeEvidenceHashPayload>[0]): string {
  const payload = routeEvidenceHashPayload(params);
  if (params.target === 'rehomed') {
    return hashCanonicalEvidence(payload);
  }
  return hashLegacyEvidence(payload);
}

function readForeignLineageBudget(
  repoRoot: string,
  workstreamId: string
): { failedPremiumReviewCount: number; inheritedFailedReviewCount: number } | null {
  const protocolPath = path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    workstreamId,
    'protocol.json'
  );
  if (!existsSync(protocolPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(protocolPath, 'utf8')) as Partial<WorkflowProtocolRecord>;
    if (
      typeof parsed.failedPremiumReviewCount !== 'number' ||
      typeof parsed.inheritedFailedReviewCount !== 'number'
    ) {
      return null;
    }
    return {
      failedPremiumReviewCount: parsed.failedPremiumReviewCount,
      inheritedFailedReviewCount: parsed.inheritedFailedReviewCount,
    };
  } catch {
    return null;
  }
}

export function provePredecessorExhaustion(params: {
  predecessorReleaseContext: string;
  predecessorDescendantWorkstreamId: string;
  predecessorHeadCommit: string;
}): { ok: true } | { ok: false; message: string } {
  const context = parsePredecessorReleaseContext(params.predecessorReleaseContext);
  if (!context.ok) return context;
  const repo = resolveCanonicalExistingPath(context.repoPath);
  if (!repo.ok) {
    return { ok: false, message: `predecessor release context is not a readable Git repo: ${repo.message}` };
  }
  if (!gitCommitExists(repo.canonical, params.predecessorHeadCommit)) {
    return { ok: false, message: 'predecessor HEAD does not exist in the predecessor release context' };
  }
  const descendant = readForeignLineageBudget(repo.canonical, params.predecessorDescendantWorkstreamId);
  if (!descendant) {
    return {
      ok: false,
      message:
        'predecessor descendant protocol is missing; new ID or path labels cannot prove exhaustion',
    };
  }
  if (lineageFailedPremiumReviewCount(descendant) < 2) {
    return { ok: false, message: 'predecessor lineage is not review-exhausted' };
  }
  return { ok: true };
}

export function planRequiresBoundRehome(record: WorkflowProtocolRecord): boolean {
  return Boolean(record.rehomeProvenance);
}

export function buildBoundRehomeProvenance(params: {
  repoRoot: string;
  record: WorkflowProtocolRecord;
  declared: WorkflowRehomeProvenance;
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
  nowIso: string;
}): { ok: true; provenance: WorkflowRehomeProvenance } | { ok: false; message: string } {
  if ((params.record.sourceWorkstreamIds ?? []).length > 0) {
    return { ok: false, message: 'split child cannot qualify as an independent re-home successor' };
  }
  const currentHead = gitHeadCommit(params.repoRoot);
  const currentBranch = gitBranchName(params.repoRoot);
  if (!currentHead || !currentBranch) {
    return { ok: false, message: 'rehome-bind requires a named branch and readable HEAD' };
  }
  if (currentBranch !== params.successorBranchName || currentBranch !== params.declared.successorBranchName) {
    return {
      ok: false,
      message: `successor branch ${currentBranch} does not match declared ${params.declared.successorBranchName}`,
    };
  }
  if (params.successorBaselineCommit !== params.declared.successorBaselineCommit) {
    return { ok: false, message: 'successor baseline does not match declared re-home baseline' };
  }
  if (!resolveCommitObject(params.repoRoot, params.successorBaselineCommit)) {
    return { ok: false, message: 'successor baseline does not exist as a git commit object' };
  }
  const successorBaselineOk = requireCommitAncestor(
    params.repoRoot,
    params.successorBaselineCommit,
    currentHead,
    'successor baseline is not an ancestor of current HEAD'
  );
  if (!successorBaselineOk.ok) return successorBaselineOk;
  const predecessorIsolated = requireCommitNotAncestor(
    params.repoRoot,
    params.predecessorHeadCommit,
    currentHead,
    'predecessor HEAD is an ancestor of the successor; independent Git context required'
  );
  if (!predecessorIsolated.ok) return predecessorIsolated;
  if (params.predecessorHeadCommit !== params.declared.predecessorHeadCommit) {
    return { ok: false, message: 'predecessor HEAD does not match declared provenance' };
  }
  if (params.predecessorRootWorkstreamId !== params.declared.predecessorRootWorkstreamId) {
    return { ok: false, message: 'predecessor root does not match declared provenance' };
  }
  if (params.predecessorDescendantWorkstreamId !== params.declared.predecessorDescendantWorkstreamId) {
    return { ok: false, message: 'predecessor descendant does not match declared provenance' };
  }
  if (params.predecessorReleaseContext !== params.declared.predecessorReleaseContext) {
    return { ok: false, message: 'predecessor release context does not match declared provenance' };
  }
  if (
    params.declared.sourceReleaseContext &&
    params.sourceReleaseContext !== params.declared.sourceReleaseContext
  ) {
    return { ok: false, message: 'source release context does not match declared provenance' };
  }
  if (params.declared.sourceHeadCommit && params.sourceHeadCommit !== params.declared.sourceHeadCommit) {
    return { ok: false, message: 'source HEAD does not match declared provenance' };
  }
  if (
    params.declared.sourceBaselineCommit &&
    params.sourceBaselineCommit !== params.declared.sourceBaselineCommit
  ) {
    return { ok: false, message: 'source baseline does not match declared provenance' };
  }
  const sourceReviewWorkstreamId = params.declared.sourceReviewWorkstreamId?.trim() || '';
  if (!sourceReviewWorkstreamId) {
    return {
      ok: false,
      message: 'rehome-bind requires plan-bound sourceReviewWorkstreamId',
    };
  }
  if (
    params.sourceReviewWorkstreamId &&
    params.sourceReviewWorkstreamId.trim() !== sourceReviewWorkstreamId
  ) {
    return { ok: false, message: 'sourceReviewWorkstreamId does not match declared provenance' };
  }

  const predecessorContext = parsePredecessorReleaseContext(params.predecessorReleaseContext);
  if (!predecessorContext.ok) return predecessorContext;
  const predecessorRepo = resolveCanonicalExistingPath(predecessorContext.repoPath);
  if (!predecessorRepo.ok) {
    return {
      ok: false,
      message: `predecessor release context is not a readable Git repo: ${predecessorRepo.message}`,
    };
  }
  const predecessorResolved = resolveBranchCommit(
    predecessorRepo.canonical,
    predecessorContext.branchName
  );
  if (!predecessorResolved.ok) return predecessorResolved;
  if (predecessorResolved.sha !== params.predecessorHeadCommit) {
    return {
      ok: false,
      message: `predecessor branch ${predecessorContext.branchName} resolves to ${predecessorResolved.sha}, not ${params.predecessorHeadCommit}`,
    };
  }
  if (!resolveCommitObject(predecessorRepo.canonical, params.predecessorHeadCommit)) {
    return { ok: false, message: 'predecessor HEAD does not exist as a git commit object' };
  }

  const sourceContext = parsePredecessorReleaseContext(params.sourceReleaseContext);
  if (!sourceContext.ok) {
    return { ok: false, message: 'sourceReleaseContext must be path#branch' };
  }
  const sourceRepo = resolveCanonicalExistingPath(sourceContext.repoPath);
  if (!sourceRepo.ok) {
    return { ok: false, message: `source release context is not a readable Git repo: ${sourceRepo.message}` };
  }
  const sourceResolved = resolveBranchCommit(sourceRepo.canonical, sourceContext.branchName);
  if (!sourceResolved.ok) {
    return { ok: false, message: `source branch does not exist: ${sourceContext.branchName}` };
  }
  const sourceProtocol = readForeignProtocolRecord(sourceRepo.canonical, sourceReviewWorkstreamId);
  if (!sourceProtocol) {
    return {
      ok: false,
      message: `source review protocol ${sourceReviewWorkstreamId} is missing or unreadable`,
    };
  }
  const candidate = resolveLatestLegalReviewCandidateHead(sourceRepo.canonical, sourceProtocol);
  if (!candidate.ok) return candidate;
  if (params.sourceHeadCommit !== candidate.headCommit) {
    return {
      ok: false,
      message:
        'source HEAD does not match the latest legal review-attempt candidate; operator cannot nominate a different HEAD',
    };
  }
  if (sourceResolved.sha !== candidate.headCommit) {
    return {
      ok: false,
      message:
        'source branch HEAD has drifted from the latest legal review candidate; refuse to enlarge the sourced range',
    };
  }
  const sourceResolvedAgain = resolveBranchCommit(sourceRepo.canonical, sourceContext.branchName);
  if (!sourceResolvedAgain.ok) return sourceResolvedAgain;
  if (sourceResolvedAgain.sha !== sourceResolved.sha) {
    return { ok: false, message: 'source branch HEAD moved during rehome-bind' };
  }
  if (!resolveCommitObject(sourceRepo.canonical, params.sourceBaselineCommit)) {
    return { ok: false, message: 'source baseline does not exist as a git commit object' };
  }
  if (params.sourceBaselineCommit !== sourceProtocol.baseCommit) {
    return { ok: false, message: 'source baseline does not match the source protocol baseCommit' };
  }
  const sourceOwned = requireCommitAncestor(
    sourceRepo.canonical,
    params.sourceBaselineCommit,
    candidate.headCommit,
    'source baseline is not an ancestor of source HEAD'
  );
  if (!sourceOwned.ok) return sourceOwned;

  const implementationCommits = listOrderedImplementationCommits(
    sourceRepo.canonical,
    params.sourceBaselineCommit,
    candidate.headCommit
  );
  if (typeof implementationCommits === 'object' && 'error' in implementationCommits) {
    return { ok: false, message: implementationCommits.error };
  }
  if (implementationCommits.length === 0) {
    return { ok: false, message: 'source implementation commit range is empty' };
  }

  const patchSha = computeGitPatchSha256(
    sourceRepo.canonical,
    params.sourceBaselineCommit,
    params.sourceHeadCommit
  );
  if (typeof patchSha === 'object') return { ok: false, message: patchSha.error };
  const sourceFingerprint = computeGitProductTreeFingerprint(
    sourceRepo.canonical,
    params.sourceHeadCommit
  );
  if (typeof sourceFingerprint === 'object') return { ok: false, message: sourceFingerprint.error };
  if (!SHA256_RE.test(params.sourcePatchSha256) || !SHA256_RE.test(params.declared.sourcePatchSha256)) {
    return { ok: false, message: 'source patch hash must be a sha256 hex digest' };
  }
  if (
    !SHA256_RE.test(params.sourceProductTreeFingerprint) ||
    !SHA256_RE.test(params.declared.sourceProductTreeFingerprint)
  ) {
    return { ok: false, message: 'source fingerprint must be a sha256 hex digest' };
  }
  if (params.sourcePatchSha256 !== params.declared.sourcePatchSha256) {
    return { ok: false, message: 'source patch hash does not match declared provenance' };
  }
  if (params.sourceProductTreeFingerprint !== params.declared.sourceProductTreeFingerprint) {
    return { ok: false, message: 'source fingerprint does not match declared provenance' };
  }
  if (patchSha !== params.sourcePatchSha256) {
    return { ok: false, message: 'source patch hash does not match git-derived patch evidence' };
  }
  if (sourceFingerprint !== params.sourceProductTreeFingerprint) {
    return { ok: false, message: 'source fingerprint does not match git-derived tree evidence' };
  }

  const extraSuccessorCommits = listOrderedImplementationCommits(
    params.repoRoot,
    params.successorBaselineCommit,
    currentHead
  );
  if (typeof extraSuccessorCommits === 'object' && 'error' in extraSuccessorCommits) {
    return { ok: false, message: extraSuccessorCommits.error };
  }
  if (extraSuccessorCommits.length === 0) {
    const successorFingerprint = computeWorkingTreeProductFingerprint(params.repoRoot);
    if (typeof successorFingerprint === 'object') {
      return { ok: false, message: successorFingerprint.error };
    }
    if (successorFingerprint !== sourceFingerprint) {
      return {
        ok: false,
        message: 'successor product tree does not match source fingerprint',
      };
    }
  }

  const exhaustion = provePredecessorExhaustion({
    predecessorReleaseContext: params.predecessorReleaseContext,
    predecessorDescendantWorkstreamId: params.predecessorDescendantWorkstreamId,
    predecessorHeadCommit: params.predecessorHeadCommit,
  });
  if (!exhaustion.ok) return exhaustion;
  const worktree = resolveCanonicalExistingPath(params.repoRoot);
  if (!worktree.ok) return worktree;

  const evidenceBody = {
    canonVersion: REHOME_EVIDENCE_CANON_VERSION,
    currentHead,
    currentBranch,
    successorBaseline: params.successorBaselineCommit,
    predecessorHead: params.predecessorHeadCommit,
    predecessorBranchResolvedSha: predecessorResolved.sha,
    sourceHeadCommit: candidate.headCommit,
    sourceBaselineCommit: params.sourceBaselineCommit,
    sourceReviewWorkstreamId,
    sourcePatchSha256: patchSha,
    sourceProductTreeFingerprint: sourceFingerprint,
    implementationCommits,
    latestLegalReviewCandidateHead: candidate.headCommit,
    mergeBaseCheck: 'predecessor_head_not_ancestor' as const,
    predecessorExhausted: true as const,
  };
  const sourceResolvedPersist = resolveBranchCommit(sourceRepo.canonical, sourceContext.branchName);
  if (!sourceResolvedPersist.ok) return sourceResolvedPersist;
  if (sourceResolvedPersist.sha !== candidate.headCommit) {
    return {
      ok: false,
      message:
        'source branch HEAD moved before rehome evidence persistence; refuse to enlarge the sourced range',
    };
  }
  return {
    ok: true,
    provenance: {
      ...params.declared,
      status: 'bound',
      predecessorHeadIsAncestor: false,
      predecessorPassedReview: false,
      successorWorktreeCanonicalPath: worktree.canonical,
      sourceReleaseContext: params.sourceReleaseContext,
      sourceHeadCommit: candidate.headCommit,
      sourceBaselineCommit: params.sourceBaselineCommit,
      sourceReviewWorkstreamId,
      sourceImplementationCommits: implementationCommits,
      predecessorBranchResolvedSha: predecessorResolved.sha,
      sourcePatchSha256: patchSha,
      sourceProductTreeFingerprint: sourceFingerprint,
      boundAt: params.nowIso,
      evidence: {
        ...evidenceBody,
        evidenceHash: hashCanonicalEvidence(evidenceBody),
      },
    },
  };
}

export function buildRouteDisposition(params: {
  repoRoot: string;
  record: WorkflowProtocolRecord;
  target: WorkflowRouteDispositionTarget;
  reason: string;
  implementationCommits?: string[];
  revertCommit?: string;
  supersedeCommit?: string;
  successorRepo?: string;
  successorBranch?: string;
  successorBaseline?: string;
  predecessorHead?: string;
  nowIso: string;
}): { ok: true; disposition: WorkflowRouteDisposition } | { ok: false; message: string } {
  if (params.record.phase !== 'routing_required') {
    return { ok: false, message: `route requires routing_required (have ${params.record.phase})` };
  }
  if (lineageBudgetExhausted(params.record) === false) {
    return { ok: false, message: 'route is only valid after premium review budget exhaustion' };
  }
  const reason = params.reason.trim();
  if (!reason) return { ok: false, message: 'route requires a reason' };

  const releaseHead = gitHeadCommit(params.repoRoot);
  if (!releaseHead) return { ok: false, message: 'unable to read release HEAD for route evidence' };
  const candidate = resolveLatestLegalReviewCandidateHead(params.repoRoot, params.record);
  if (!candidate.ok) return candidate;
  const drift = rejectUnreviewedHeadDrift(params.repoRoot, candidate.headCommit, releaseHead);
  // Extra commits after the candidate are expected for revert/supersede/remove.
  // Git-list failures still fail closed for every target.
  if (!drift.ok && (drift.kind === 'git-error' || params.target === 'rehomed')) {
    return drift;
  }
  const implementationCommits = requireGitDerivedImplementationCommits({
    repoRoot: params.repoRoot,
    baselineCommit: params.record.baseCommit,
    headCommit: candidate.headCommit,
    claimed: params.implementationCommits,
  });
  if (typeof implementationCommits === 'object' && 'error' in implementationCommits) {
    return { ok: false, message: implementationCommits.error };
  }
  const baseline = params.record.baseCommit;

  let gitEvidence: WorkflowRouteGitEvidence;
  if (params.target === 'removed_from_release') {
    const stillPresent = filterAncestorCommits(params.repoRoot, implementationCommits, releaseHead);
    if (!stillPresent.ok) return stillPresent;
    if (stillPresent.ancestors.length > 0) {
      return {
        ok: false,
        message: `implementation still present in release history: ${stillPresent.ancestors.join(', ')}`,
      };
    }
    gitEvidence = {
      kind: 'absent_from_release_range',
      baselineCommit: baseline,
      releaseHeadCommit: releaseHead,
      implementationCommits,
      latestLegalReviewCandidateHead: candidate.headCommit,
      evidenceHash: computeRouteEvidenceHash({
        target: params.target,
        baseline,
        releaseHead,
        implementationCommits,
        latestLegalReviewCandidateHead: candidate.headCommit,
      }),
    };
  } else if (params.target === 'reverted') {
    const revertCommit = requireSha(params.revertCommit, 'revertCommit');
    if (typeof revertCommit === 'object') return { ok: false, message: revertCommit.error };
    const revertInHistory = requireCommitAncestor(
      params.repoRoot,
      revertCommit,
      releaseHead,
      'revert commit is not in the current release history'
    );
    if (!revertInHistory.ok) return revertInHistory;
    const notInverted = implementationCommits.filter(
      (commit) => !revertInvertsImplementation(params.repoRoot, commit, revertCommit)
    );
    if (notInverted.length > 0) {
      return {
        ok: false,
        message: `revert commit does not invert implementation: ${notInverted.join(', ')}`,
      };
    }
    gitEvidence = {
      kind: 'full_revert',
      baselineCommit: baseline,
      releaseHeadCommit: releaseHead,
      implementationCommits,
      revertCommit,
      latestLegalReviewCandidateHead: candidate.headCommit,
      evidenceHash: computeRouteEvidenceHash({
        target: params.target,
        baseline,
        releaseHead,
        implementationCommits,
        latestLegalReviewCandidateHead: candidate.headCommit,
        revertCommit,
      }),
    };
  } else if (params.target === 'superseded') {
    const supersedeCommit = requireSha(params.supersedeCommit, 'supersedeCommit');
    if (typeof supersedeCommit === 'object') return { ok: false, message: supersedeCommit.error };
    const supersedeInHistory = requireCommitAncestor(
      params.repoRoot,
      supersedeCommit,
      releaseHead,
      'supersede commit is not in the current release history'
    );
    if (!supersedeInHistory.ok) return supersedeInHistory;
    if (implementationCommits.includes(supersedeCommit)) {
      return { ok: false, message: 'supersede commit cannot be one of the failed implementation commits' };
    }
    const stillIndependent = filterAncestorCommits(params.repoRoot, implementationCommits, releaseHead);
    if (!stillIndependent.ok) return stillIndependent;
    if (stillIndependent.ancestors.length > 0) {
      const revertCommit = requireSha(params.revertCommit, 'revertCommit');
      if (typeof revertCommit === 'object') {
        return {
          ok: false,
          message:
            'safe supersede requires Git proof the failed implementation is no longer independently shipped',
        };
      }
      const notInverted = stillIndependent.ancestors.filter(
        (commit) => !revertInvertsImplementation(params.repoRoot, commit, revertCommit)
      );
      if (notInverted.length > 0) {
        return {
          ok: false,
          message: `supersede revert does not invert remaining implementation: ${notInverted.join(', ')}`,
        };
      }
    }
    gitEvidence = {
      kind: 'safe_supersede',
      baselineCommit: baseline,
      releaseHeadCommit: releaseHead,
      implementationCommits,
      supersedeCommit,
      revertCommit: params.revertCommit,
      latestLegalReviewCandidateHead: candidate.headCommit,
      evidenceHash: computeRouteEvidenceHash({
        target: params.target,
        baseline,
        releaseHead,
        implementationCommits,
        latestLegalReviewCandidateHead: candidate.headCommit,
        supersedeCommit,
        revertCommit: params.revertCommit ?? null,
      }),
    };
  } else {
    const predecessorHead = requireSha(params.predecessorHead, 'predecessorHead');
    const successorBaseline = requireSha(params.successorBaseline, 'successorBaseline');
    if (typeof predecessorHead === 'object') return { ok: false, message: predecessorHead.error };
    if (typeof successorBaseline === 'object') return { ok: false, message: successorBaseline.error };
    if (!params.successorRepo || !params.successorBranch) {
      return { ok: false, message: 'rehome route requires successor repo, branch, and baseline' };
    }
    const successorRepo = resolveCanonicalExistingPath(params.successorRepo);
    if (!successorRepo.ok) return successorRepo;
    if (!BRANCH_RE.test(params.successorBranch)) {
      return { ok: false, message: 'successor branch name is invalid' };
    }
    const successorHead = gitHeadCommit(successorRepo.canonical);
    const successorBranch = gitBranchName(successorRepo.canonical);
    if (!successorHead || !successorBranch) {
      return { ok: false, message: 'unable to read successor HEAD/branch' };
    }
    if (successorBranch !== params.successorBranch) {
      return {
        ok: false,
        message: `successor worktree is on ${successorBranch}, not ${params.successorBranch}`,
      };
    }
    const successorOwned = requireCommitAncestor(
      successorRepo.canonical,
      successorBaseline,
      successorHead,
      'successor baseline is not an ancestor of successor HEAD'
    );
    if (!successorOwned.ok) return successorOwned;
    const successorIsolated = requireCommitNotAncestor(
      successorRepo.canonical,
      predecessorHead,
      successorHead,
      'successor ancestry contains the blocked predecessor HEAD'
    );
    if (!successorIsolated.ok) return successorIsolated;
    gitEvidence = {
      kind: 'isolated_successor',
      baselineCommit: baseline,
      releaseHeadCommit: releaseHead,
      implementationCommits,
      successorBranch: params.successorBranch,
      successorBaseline,
      successorRepoCanonicalPath: successorRepo.canonical,
      predecessorHead,
      predecessorHeadIsAncestor: false,
      latestLegalReviewCandidateHead: candidate.headCommit,
      canonVersion: REHOME_EVIDENCE_CANON_VERSION,
      evidenceHash: computeRouteEvidenceHash({
        target: params.target,
        baseline,
        releaseHead,
        implementationCommits,
        latestLegalReviewCandidateHead: candidate.headCommit,
        successorRepo: successorRepo.canonical,
        successorBranch: params.successorBranch,
        successorBaseline,
        predecessorHead,
      }),
    };
  }

  return {
    ok: true,
    disposition: {
      schemaVersion: '1',
      command: 'route',
      recordedAt: params.nowIso,
      target: params.target,
      reason,
      gitEvidence,
    },
  };
}

export function revalidateRouteDisposition(params: {
  repoRoot: string;
  record: WorkflowProtocolRecord;
}): { ok: true } | { ok: false; message: string } {
  const disposition = params.record.routeDisposition;
  if (!disposition || disposition.schemaVersion !== '1') {
    return { ok: false, message: 'non-release disposition is missing or unrecognised' };
  }
  if (!disposition.gitEvidence?.evidenceHash || !disposition.gitEvidence.kind) {
    return { ok: false, message: 'disposition Git evidence is incomplete' };
  }
  if (
    disposition.target === 'rehomed' &&
    disposition.gitEvidence.canonVersion !== REHOME_EVIDENCE_CANON_VERSION
  ) {
    return { ok: false, message: 'rehome disposition evidence is incomplete or unversioned' };
  }
  if (
    disposition.target === 'rehomed' &&
    (!disposition.gitEvidence.implementationCommits ||
      disposition.gitEvidence.implementationCommits.length === 0)
  ) {
    return { ok: false, message: 'rehome disposition omits implementation commit evidence' };
  }
  const expectedHash = computeRouteEvidenceHash({
    target: disposition.target,
    baseline: disposition.gitEvidence.baselineCommit,
    releaseHead: disposition.gitEvidence.releaseHeadCommit,
    implementationCommits: disposition.gitEvidence.implementationCommits,
    latestLegalReviewCandidateHead: disposition.gitEvidence.latestLegalReviewCandidateHead,
    revertCommit: disposition.gitEvidence.revertCommit,
    supersedeCommit: disposition.gitEvidence.supersedeCommit,
    successorRepo: disposition.gitEvidence.successorRepoCanonicalPath,
    successorBranch: disposition.gitEvidence.successorBranch,
    successorBaseline: disposition.gitEvidence.successorBaseline,
    predecessorHead: disposition.gitEvidence.predecessorHead,
  });
  if (expectedHash !== disposition.gitEvidence.evidenceHash) {
    return { ok: false, message: 'disposition evidence hash does not match recorded Git evidence' };
  }
  const rebuilt = buildRouteDisposition({
    repoRoot: params.repoRoot,
    record: { ...params.record, phase: 'routing_required' },
    target: disposition.target,
    reason: disposition.reason,
    implementationCommits: disposition.gitEvidence.implementationCommits,
    revertCommit: disposition.gitEvidence.revertCommit,
    supersedeCommit: disposition.gitEvidence.supersedeCommit,
    successorRepo: disposition.gitEvidence.successorRepoCanonicalPath,
    successorBranch: disposition.gitEvidence.successorBranch,
    successorBaseline: disposition.gitEvidence.successorBaseline,
    predecessorHead: disposition.gitEvidence.predecessorHead,
    nowIso: disposition.recordedAt,
  });
  if (!rebuilt.ok) {
    return { ok: false, message: `disposition no longer holds: ${rebuilt.message}` };
  }
  if (
    rebuilt.disposition.gitEvidence.latestLegalReviewCandidateHead !==
    disposition.gitEvidence.latestLegalReviewCandidateHead
  ) {
    return {
      ok: false,
      message: 'latest legal review candidate HEAD does not match git-derived evidence',
    };
  }
  const releaseHead = gitHeadCommit(params.repoRoot);
  if (!releaseHead) return { ok: false, message: 'unable to revalidate disposition HEAD' };
  if (disposition.target === 'rehomed') {
    const stillPresent = filterAncestorCommits(
      params.repoRoot,
      disposition.gitEvidence.implementationCommits ?? [],
      releaseHead
    );
    if (!stillPresent.ok) return stillPresent;
    if (stillPresent.ancestors.length > 0) {
      return {
        ok: false,
        message:
          'rehomed does not unblock a release context that still contains the failed implementation',
      };
    }
  }
  return { ok: true };
}

export function revalidateBoundRehomeProvenance(params: {
  repoRoot: string;
  provenance: WorkflowRehomeProvenance;
}): { ok: true } | { ok: false; message: string } {
  if (params.provenance.schemaVersion !== '1' || params.provenance.status !== 'bound') {
    return { ok: false, message: 'rehome provenance is not bound' };
  }
  if (params.provenance.predecessorPassedReview !== false) {
    return { ok: false, message: 'rehome provenance illegally claims predecessor passed review' };
  }
  const evidence = params.provenance.evidence;
  if (!evidence || evidence.canonVersion !== REHOME_EVIDENCE_CANON_VERSION) {
    return { ok: false, message: 'rehome evidence is incomplete or unversioned' };
  }
  if (
    !SHA256_RE.test(params.provenance.sourcePatchSha256) ||
    !SHA256_RE.test(params.provenance.sourceProductTreeFingerprint) ||
    evidence.sourcePatchSha256 !== params.provenance.sourcePatchSha256 ||
    evidence.sourceProductTreeFingerprint !== params.provenance.sourceProductTreeFingerprint
  ) {
    return { ok: false, message: 'rehome source hashes are not bound git evidence' };
  }
  if (
    !evidence.implementationCommits ||
    evidence.implementationCommits.length === 0 ||
    !params.provenance.sourceImplementationCommits ||
    params.provenance.sourceImplementationCommits.length !== evidence.implementationCommits.length ||
    params.provenance.sourceImplementationCommits.some(
      (commit, index) => commit !== evidence.implementationCommits[index]
    )
  ) {
    return { ok: false, message: 'rehome implementation commits are missing or do not match bound evidence' };
  }
  if (
    !evidence.predecessorBranchResolvedSha ||
    evidence.predecessorBranchResolvedSha !== params.provenance.predecessorHeadCommit ||
    evidence.predecessorHead !== params.provenance.predecessorHeadCommit
  ) {
    return { ok: false, message: 'bound predecessor SHA does not match declared predecessor HEAD' };
  }
  if (evidence.predecessorExhausted !== true) {
    return { ok: false, message: 'bound rehome evidence does not record predecessor exhaustion' };
  }
  if (!evidence.sourceReviewWorkstreamId || !evidence.latestLegalReviewCandidateHead) {
    return { ok: false, message: 'bound rehome evidence omits the source review candidate identity' };
  }
  if (evidence.latestLegalReviewCandidateHead !== evidence.sourceHeadCommit) {
    return {
      ok: false,
      message: 'bound source HEAD does not match the latest legal review-attempt candidate',
    };
  }
  const currentHead = gitHeadCommit(params.repoRoot);
  if (!currentHead) return { ok: false, message: 'unable to revalidate successor HEAD' };
  if (!resolveCommitObject(params.repoRoot, params.provenance.successorBaselineCommit)) {
    return { ok: false, message: 'successor baseline is not a git commit object' };
  }
  const predecessorStillIsolated = requireCommitNotAncestor(
    params.repoRoot,
    params.provenance.predecessorHeadCommit,
    currentHead,
    'predecessor HEAD became an ancestor of the successor'
  );
  if (!predecessorStillIsolated.ok) return predecessorStillIsolated;
  const successorStillOwned = requireCommitAncestor(
    params.repoRoot,
    params.provenance.successorBaselineCommit,
    currentHead,
    'successor baseline is no longer an ancestor of HEAD'
  );
  if (!successorStillOwned.ok) return successorStillOwned;
  const expectedHash = hashCanonicalEvidence({
    canonVersion: REHOME_EVIDENCE_CANON_VERSION,
    currentHead: evidence.currentHead,
    currentBranch: evidence.currentBranch,
    successorBaseline: evidence.successorBaseline,
    predecessorHead: evidence.predecessorHead,
    predecessorBranchResolvedSha: evidence.predecessorBranchResolvedSha,
    sourceHeadCommit: evidence.sourceHeadCommit,
    sourceBaselineCommit: evidence.sourceBaselineCommit,
    sourceReviewWorkstreamId: evidence.sourceReviewWorkstreamId,
    sourcePatchSha256: evidence.sourcePatchSha256,
    sourceProductTreeFingerprint: evidence.sourceProductTreeFingerprint,
    implementationCommits: evidence.implementationCommits,
    latestLegalReviewCandidateHead: evidence.latestLegalReviewCandidateHead,
    mergeBaseCheck: 'predecessor_head_not_ancestor',
    predecessorExhausted: true,
  });
  if (expectedHash !== evidence.evidenceHash) {
    return { ok: false, message: 'rehome evidence hash does not match bound provenance' };
  }
  return { ok: true };
}
