export interface ReleaseVersionState {
  mmyy: string;
  major: number;
  minor: number;
  lastProcessedSha: string;
}

export interface ParsedCommit {
  raw: string;
  type: string;
  scope: string | null;
  subject: string;
  isBreaking: boolean;
}

export type VersionBumpKind = 'major' | 'minor' | 'month_reset' | 'none';

const CONVENTIONAL_COMMIT_PATTERN =
  /^([a-z]+)(!)?(?:\(([^)]+)\))?:\s*(.+)$/iu;

const MAJOR_TYPES = new Set(['feat']);
const MINOR_TYPES = new Set(['fix', 'chore', 'docs', 'test', 'refactor', 'perf', 'style']);
const SKIP_VERSION_MARKER = '[skip version]';

export function getCurrentMmyy(date: Date, timeZone = 'Europe/London'): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(date);

  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const year = parts.find((part) => part.type === 'year')?.value ?? '00';
  return `${month}${year}`;
}

export function formatReleaseVersion(state: Pick<ReleaseVersionState, 'mmyy' | 'major' | 'minor'>): string {
  return `${state.mmyy}.${state.major}.${state.minor}`;
}

export function parseConventionalCommit(message: string): ParsedCommit | null {
  const firstLine = message.split(/\r?\n/u)[0]?.trim() ?? '';
  if (!firstLine || firstLine.includes(SKIP_VERSION_MARKER)) {
    return null;
  }

  const match = CONVENTIONAL_COMMIT_PATTERN.exec(firstLine);
  if (!match) {
    return null;
  }

  const [, rawType, breaking, rawScope, rawSubject] = match;
  const type = (rawType ?? '').toLowerCase();
  const subject = (rawSubject ?? '').trim();
  if (!type || !subject) {
    return null;
  }

  return {
    raw: firstLine,
    type,
    scope: rawScope?.trim() || null,
    subject,
    isBreaking: Boolean(breaking),
  };
}

export function shouldSkipVersionBumpCommit(message: string): boolean {
  return message.toLowerCase().includes(SKIP_VERSION_MARKER);
}

export function isMajorEligibleCommit(commit: ParsedCommit): boolean {
  return commit.isBreaking || MAJOR_TYPES.has(commit.type);
}

export function isMinorEligibleCommit(commit: ParsedCommit): boolean {
  return MINOR_TYPES.has(commit.type);
}

export function parseCommitsFromMessages(messages: string[]): ParsedCommit[] {
  return messages
    .map((message) => parseConventionalCommit(message))
    .filter((commit): commit is ParsedCommit => commit !== null);
}

export function selectPrimaryCommitMessage(commits: ParsedCommit[]): string | null {
  if (commits.length === 0) {
    return null;
  }

  const majorCommit = commits.find((commit) => isMajorEligibleCommit(commit));
  if (majorCommit) {
    return majorCommit.raw;
  }

  const minorCommits = commits.filter((commit) => isMinorEligibleCommit(commit));
  if (minorCommits.length > 0) {
    return minorCommits[minorCommits.length - 1].raw;
  }

  return commits[commits.length - 1].raw;
}

export function determineBumpKind(commits: ParsedCommit[]): VersionBumpKind {
  if (commits.length === 0) {
    return 'none';
  }

  if (commits.some((commit) => isMajorEligibleCommit(commit))) {
    return 'major';
  }

  if (commits.some((commit) => isMinorEligibleCommit(commit))) {
    return 'minor';
  }

  return 'none';
}

export function computeNextVersionState(
  current: ReleaseVersionState,
  commits: ParsedCommit[],
  now: Date,
  timeZone = 'Europe/London'
): { next: ReleaseVersionState; bumpKind: VersionBumpKind } {
  const currentMmyy = getCurrentMmyy(now, timeZone);
  const bumpKindFromCommits = determineBumpKind(commits);

  if (current.mmyy !== currentMmyy) {
    return {
      next: {
        mmyy: currentMmyy,
        major: 0,
        minor: 0,
        lastProcessedSha: current.lastProcessedSha,
      },
      bumpKind: 'month_reset',
    };
  }

  if (bumpKindFromCommits === 'none') {
    return {
      next: current,
      bumpKind: 'none',
    };
  }

  if (bumpKindFromCommits === 'major') {
    return {
      next: {
        mmyy: current.mmyy,
        major: current.major + 1,
        minor: 0,
        lastProcessedSha: current.lastProcessedSha,
      },
      bumpKind: 'major',
    };
  }

  return {
    next: {
      mmyy: current.mmyy,
      major: current.major,
      minor: current.minor + 1,
      lastProcessedSha: current.lastProcessedSha,
    },
    bumpKind: 'minor',
  };
}

function humanizeCommitSubject(commit: ParsedCommit): string {
  const subject = commit.subject.trim();
  if (!subject) {
    return commit.raw;
  }

  const normalized = subject.charAt(0).toUpperCase() + subject.slice(1);
  return normalized.endsWith('.') ? normalized : `${normalized}.`;
}

export function buildWhatChangedSummary(commits: ParsedCommit[]): string {
  if (commits.length === 0) {
    return 'No conventional commit details were available for this release.';
  }

  return commits.map(humanizeCommitSubject).join(' ');
}

export function formatReleaseLogEntry(options: {
  version: string;
  primaryCommitMessage: string;
  whatChanged: string;
  commitMessages: string[];
}): string {
  const commitBullets = options.commitMessages.map((message) => `- \`${message}\``).join('\n');

  return [
    `## ${options.version}`,
    '',
    '**GIT COMMIT MESSAGE**',
    `\`${options.primaryCommitMessage}\``,
    '',
    '**WHAT CHANGED**',
    options.whatChanged,
    '',
    '**COMMITS IN THIS RELEASE**',
    commitBullets,
    '',
  ].join('\n');
}

export const RELEASE_LOG_PATH = 'docs_private/release-log.md';
export const RELEASE_LOG_PREAMBLE =
  '# Production release log\n\nPrivate changelog for production builds. Newest entries first.\n';

export function prependReleaseLogEntry(existingContent: string, entry: string): string {
  const trimmedEntry = entry.trimEnd();
  const body = existingContent.trim();

  if (!body) {
    return `${RELEASE_LOG_PREAMBLE}\n${trimmedEntry}\n`;
  }

  if (body.startsWith('# Production release log')) {
    const withoutPreamble = body.replace(RELEASE_LOG_PREAMBLE, '').trimStart();
    return `${RELEASE_LOG_PREAMBLE}\n${trimmedEntry}\n\n${withoutPreamble}\n`;
  }

  return `${RELEASE_LOG_PREAMBLE}\n${trimmedEntry}\n\n${body}\n`;
}
