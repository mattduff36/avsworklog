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

export type ReleaseHistoryUpdateKind = 'major' | 'minor';

export interface ParsedReleaseLogEntry {
  version: string;
  primaryCommitMessage: string | null;
  whatChanged: string;
  commitMessages: string[];
  pushedAt: string | null;
}

export interface ReleaseHistoryEntry {
  version: string;
  updateKind: ReleaseHistoryUpdateKind;
  title: string;
  description: string;
  pushedAt: string | null;
}

const CONVENTIONAL_COMMIT_PATTERN =
  /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/iu;

const MAJOR_TYPES = new Set(['feat']);
const MINOR_TYPES = new Set(['fix', 'chore', 'docs', 'test', 'refactor', 'perf', 'style']);
const SKIP_VERSION_MARKER = '[skip version]';
const RELEASE_VERSION_HEADING_PATTERN = /^##\s+(\d{4}\.\d+\.\d+)\s*$/gmu;
const RELEASE_LOG_LABELS = new Set([
  '**GIT COMMIT MESSAGE**',
  '**PUSHED AT**',
  '**WHAT CHANGED**',
  '**COMMITS IN THIS RELEASE**',
]);
const FRIENDLY_SCOPE_LABELS: Record<string, string> = {
  actions: 'Actions',
  admin: 'Admin settings',
  analytics: 'Usage tracking',
  api: 'Background services',
  app: 'App',
  auth: 'Sign in',
  components: 'App screens',
  customers: 'Customers',
  db: 'Data storage',
  errors: 'Error reporting',
  faq: 'Help articles',
  fleet: 'Fleet',
  help: 'Help and FAQ',
  inspections: 'Inspections',
  inventory: 'Inventory',
  layout: 'Navigation',
  logging: 'Error logging',
  maintenance: 'Maintenance',
  mobile: 'Mobile app',
  pdf: 'PDF documents',
  repo: 'App maintenance',
  tests: 'App reliability',
  timesheets: 'Timesheets',
  workshop: 'Workshop tasks',
};

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

  const [, rawType, rawScope, breaking, rawSubject] = match;
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

export function selectReleasePrimaryCommitMessage(
  commits: ParsedCommit[],
  bumpKind: VersionBumpKind,
  state: Pick<ReleaseVersionState, 'mmyy'>
): string | null {
  return (
    selectPrimaryCommitMessage(commits) ??
    (bumpKind === 'month_reset' ? `chore(release): reset release version for ${state.mmyy}` : null)
  );
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
  pushedAt?: string | null;
}): string {
  const commitBullets = options.commitMessages.map((message) => `- \`${message}\``).join('\n');
  const pushedAtLines = options.pushedAt ? ['', '**PUSHED AT**', options.pushedAt] : [];

  return [
    `## ${options.version}`,
    '',
    '**GIT COMMIT MESSAGE**',
    `\`${options.primaryCommitMessage}\``,
    ...pushedAtLines,
    '',
    '**WHAT CHANGED**',
    options.whatChanged,
    '',
    '**COMMITS IN THIS RELEASE**',
    commitBullets,
    '',
  ].join('\n');
}

function stripInlineCode(value: string): string {
  return value.trim().replace(/^`|`$/gu, '').trim();
}

function getSectionValue(lines: string[], label: string): string {
  const index = lines.findIndex((line) => line.trim() === label);
  if (index === -1) {
    return '';
  }

  const values: string[] = [];
  for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]?.trim() ?? '';
    if (RELEASE_LOG_LABELS.has(line)) {
      break;
    }

    if (!line && values.length > 0) {
      break;
    }

    if (line) {
      values.push(line);
    }
  }

  return values.join(' ').trim();
}

function getCommitMessagesFromSection(lines: string[]): string[] {
  const index = lines.findIndex((line) => line.trim() === '**COMMITS IN THIS RELEASE**');
  if (index === -1) {
    return [];
  }

  const messages: string[] = [];
  for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]?.trim() ?? '';
    if (!line) {
      if (messages.length > 0) break;
      continue;
    }

    if (RELEASE_LOG_LABELS.has(line)) {
      break;
    }

    if (line.startsWith('- ')) {
      messages.push(stripInlineCode(line.slice(2)));
    }
  }

  return messages;
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function getFriendlyScopeLabel(scope: string | null): string {
  if (!scope) {
    return 'App';
  }

  const normalized = scope.toLowerCase();
  if (FRIENDLY_SCOPE_LABELS[normalized]) {
    return FRIENDLY_SCOPE_LABELS[normalized];
  }

  return normalized
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => sentenceCase(part))
    .join(' ');
}

function getReleaseHistoryUpdateKind(version: string): ReleaseHistoryUpdateKind {
  const [, major = '0', minor = '0'] = version.split('.');
  return Number(minor) === 0 && Number(major) > 0 ? 'major' : 'minor';
}

function buildReleaseHistoryTitle(entry: ParsedReleaseLogEntry): string {
  const primaryCommit = entry.primaryCommitMessage ? parseConventionalCommit(entry.primaryCommitMessage) : null;
  const scopeLabel = getFriendlyScopeLabel(primaryCommit?.scope ?? null);

  if (primaryCommit?.type === 'fix') {
    return `${scopeLabel} improvements`;
  }

  if (primaryCommit?.type === 'feat') {
    return `${scopeLabel} update`;
  }

  if (primaryCommit?.type === 'docs') {
    return `${scopeLabel} guidance update`;
  }

  if (primaryCommit?.type === 'test') {
    return 'App reliability update';
  }

  return `${scopeLabel} maintenance update`;
}

function buildFriendlyReleaseDescription(entry: ParsedReleaseLogEntry): string {
  const rawDescription = entry.whatChanged || buildWhatChangedSummary(parseCommitsFromMessages(entry.commitMessages));
  const friendlyDescription = rawDescription
    .replace(/\bAPI routes?\b/giu, 'background services')
    .replace(/\bAPI\b/gu, 'background services')
    .replace(/\bdatabase migrations?\b/giu, 'data storage updates')
    .replace(/\brepository files?\b/giu, 'general app maintenance')
    .replace(/\bPDF\b/giu, 'PDF document')
    .replace(/\btransient\b/giu, 'temporary')
    .replace(/\binsert races\b/giu, 'timing issues')
    .replace(/\blookup failures\b/giu, 'lookup problems');

  return ensureSentence(sentenceCase(friendlyDescription));
}

export function parseReleaseLogEntries(content: string): ParsedReleaseLogEntry[] {
  const headings = Array.from(content.matchAll(RELEASE_VERSION_HEADING_PATTERN));
  return headings.map((heading, index) => {
    const nextHeading = headings[index + 1];
    const blockStart = (heading.index ?? 0) + heading[0].length;
    const blockEnd = nextHeading?.index ?? content.length;
    const lines = content.slice(blockStart, blockEnd).split(/\r?\n/u);

    return {
      version: heading[1] ?? '',
      primaryCommitMessage: stripInlineCode(getSectionValue(lines, '**GIT COMMIT MESSAGE**')) || null,
      whatChanged: getSectionValue(lines, '**WHAT CHANGED**'),
      commitMessages: getCommitMessagesFromSection(lines),
      pushedAt: getSectionValue(lines, '**PUSHED AT**') || null,
    };
  });
}

export function buildReleaseHistoryEntries(
  releaseLogContent: string,
  timestampLookup: Record<string, string | null | undefined> = {}
): ReleaseHistoryEntry[] {
  return parseReleaseLogEntries(releaseLogContent).map((entry) => ({
    version: entry.version,
    updateKind: getReleaseHistoryUpdateKind(entry.version),
    title: buildReleaseHistoryTitle(entry),
    description: buildFriendlyReleaseDescription(entry),
    pushedAt: entry.pushedAt ?? timestampLookup[entry.version] ?? null,
  }));
}

export const RELEASE_LOG_PATH = 'docs_private/release-log.md';
export const RELEASE_HISTORY_PATH = 'lib/config/release-history.json';
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
