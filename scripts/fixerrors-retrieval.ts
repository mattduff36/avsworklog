import * as fs from 'fs';
import { relative, resolve } from 'path';
import { parseStackTrace, type SourceFileRef } from '../lib/fixerrors/stack';
import { isFixerrorsSourcePath, type AutoRetrieval } from './fixerrors-auto';
import { fingerprintIncident, retrieveIncidents, rejectSensitiveText, sanitizeKnowledgeText, type IncidentQuery, type KnowledgeStore } from './fixerrors-knowledge';
import { type LifecycleRecord } from './fixerrors-lifecycle';
import { type IncidentDiagnostics } from '../lib/fixerrors/triage';

const ADMIN_EMAIL = 'admin@mpdee.co.uk';

export type ErrorLogEntry = {
  id: string;
  timestamp: string;
  created_at: string;
  error_message: string;
  error_stack: string | null;
  error_type: string;
  user_id: string | null;
  user_email: string | null;
  page_url: string;
  user_agent: string;
  component_name: string | null;
  additional_data: Record<string, unknown> | null;
};

const SOURCE_SEARCH_DIRECTORIES = ['app', 'components', 'lib', 'hooks', 'utils', 'services'];

const SOURCE_FILE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

const IGNORED_SOURCE_DIRECTORIES = new Set([
  '.git',
  '.next',
  'node_modules',
  'docs_private',
  'plans',
  'coverage',
  'dist',
  'build',
]);

export type ErrorPattern = {
  patternKey: string;
  errorType: string;
  component: string;
  normalizedMessage: string;
  occurrences: ErrorLogEntry[];
  sourceFiles: SourceFileRef[];
  affectedPages: string[];
  affectedUsers: string[];
  firstSeen: string;
  lastSeen: string;
};

export type ErrorClusterLane = 'fast' | 'standard' | 'guarded' | 'critical' | 'report-only';

export interface ErrorRootCauseCluster {
  id: string;
  rootCauseFamily: string;
  lane: ErrorClusterLane;
  action: 'fix' | 'investigate' | 'report-only' | 'critical-gates';
  patterns: ErrorPattern[];
  occurrences: number;
}

export function filterErrors(errors: ErrorLogEntry[]): ErrorLogEntry[] {
  return errors.filter((error) => {
    // Exclude localhost errors
    if (error.page_url && error.page_url.toLowerCase().includes('localhost')) {
      return false;
    }
    // Exclude admin account errors
    if (error.user_email === ADMIN_EMAIL) {
      return false;
    }
    return true;
  });
}

function normalizeSourceFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function sourceRefKey(ref: SourceFileRef): string {
  return `${normalizeSourceFilePath(ref.file)}:${ref.line || ''}`;
}

function addSourceRef(refs: SourceFileRef[], seen: Set<string>, ref: SourceFileRef): void {
  const normalizedRef = {
    ...ref,
    file: normalizeSourceFilePath(ref.file),
  };
  const key = sourceRefKey(normalizedRef);
  if (!seen.has(key)) {
    seen.add(key);
    refs.push(normalizedRef);
  }
}

function collectSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];

  const walk = (absoluteDirectory: string) => {
    if (!fs.existsSync(absoluteDirectory)) return;

    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (IGNORED_SOURCE_DIRECTORIES.has(entry.name)) continue;

      const absolutePath = resolve(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!SOURCE_FILE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        continue;
      }

      files.push(normalizeSourceFilePath(relative(repoRoot, absolutePath)));
    }
  };

  for (const directory of SOURCE_SEARCH_DIRECTORIES) {
    walk(resolve(repoRoot, directory));
  }

  return files;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function findExistingSourceFile(preferredFile: string, repoRoot: string): string | null {
  const normalizedPreferred = normalizeSourceFilePath(preferredFile);
  const extensionless = normalizedPreferred.replace(/\.[^.]+$/, '');

  for (const extension of SOURCE_FILE_EXTENSIONS) {
    const candidate = `${extensionless}${extension}`;
    if (fs.existsSync(resolve(repoRoot, candidate))) {
      return candidate;
    }
  }

  return null;
}

function routePathFromAppFile(file: string): string | null {
  const normalized = normalizeSourceFilePath(file);
  const match = normalized.match(/^app\/(.+)\/(?:page|layout|route)\.(?:tsx|ts|jsx|js)$/);
  if (!match) return null;

  const routeSegments = match[1]
    .split('/')
    .filter((segment) => !segment.startsWith('(') && !segment.startsWith('@'));

  return `/${routeSegments.join('/')}`.replace(/\/+/g, '/') || '/';
}

function getPagePath(pageUrl: string | null | undefined): string | null {
  if (!pageUrl) return null;
  if (pageUrl.startsWith('/')) {
    return normalizePath(`https://placeholder.local${pageUrl.split('?')[0]}`);
  }
  const path = normalizePath(pageUrl);
  return path.startsWith('/') ? path : null;
}

function getSharedRouteSegmentScore(file: string, pagePath: string | null): number {
  if (!pagePath) return 0;

  const fileSegments = new Set(normalizeSourceFilePath(file).split('/'));
  return pagePath
    .split('/')
    .filter(Boolean)
    .reduce((score, segment) => score + (fileSegments.has(segment) ? 5 : 0), 0);
}

function sourceFileRouteScore(file: string, pagePath: string | null): number {
  if (!pagePath) return 0;

  const appRoute = routePathFromAppFile(file);
  if (appRoute === pagePath) return 100;

  const normalized = normalizeSourceFilePath(file);
  const pagePathSuffix = pagePath.replace(/^\//, '');
  if (pagePathSuffix && normalized.includes(pagePathSuffix)) return 50;

  return getSharedRouteSegmentScore(file, pagePath);
}

function extractNextAppChunkSourceRefs(text: string, repoRoot: string): SourceFileRef[] {
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();
  const nextAppChunkPattern = /\/_next\/static\/chunks\/app\/(.+?)\/(page|layout|route)-[A-Za-z0-9_-]+\.js/g;
  let match: RegExpExecArray | null;

  while ((match = nextAppChunkPattern.exec(text)) !== null) {
    const routePath = safeDecodeURIComponent(match[1]);
    const sourceFile = findExistingSourceFile(`app/${routePath}/${match[2]}.tsx`, repoRoot);
    if (!sourceFile) continue;
    addSourceRef(refs, seen, { file: sourceFile });
  }

  return refs;
}

function extractNextServerAppSourceRefs(text: string, repoRoot: string): SourceFileRef[] {
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();
  // Capture optional :line:column for pattern matching only — compiled coords are not source maps.
  const nextServerAppPattern =
    /(?:\/var\/task)?\/\.next\/server\/app\/(.+?)\/(page|layout|route)\.js(?::\d+)?(?::\d+)?/g;
  let match: RegExpExecArray | null;

  while ((match = nextServerAppPattern.exec(text)) !== null) {
    const routePath = safeDecodeURIComponent(match[1]);
    const sourceFile = findExistingSourceFile(`app/${routePath}/${match[2]}.tsx`, repoRoot);
    if (!sourceFile) continue;
    addSourceRef(refs, seen, { file: sourceFile });
  }

  return refs;
}

function extractConsoleSearchTerms(message: string): string[] {
  const firstLine = message
    .replace(/^Console Error:\s*/i, '')
    .split('\n')[0]
    .trim();
  const labelMatch = firstLine.match(/^(.{8,140}?:)\s+(?:Error|TypeError|ReferenceError|SyntaxError|RangeError)\b/);
  if (!labelMatch) return [];

  return [labelMatch[1]];
}

function findLineNumberForTerm(content: string, term: string): number | undefined {
  const lineIndex = content.split(/\r?\n/).findIndex((line) => line.includes(term));
  return lineIndex >= 0 ? lineIndex + 1 : undefined;
}

function findSourceRefsByConsoleTerm(message: string, pageUrl: string, repoRoot: string): SourceFileRef[] {
  const terms = extractConsoleSearchTerms(message);
  if (terms.length === 0) return [];

  const pagePath = getPagePath(pageUrl);
  const candidates: Array<SourceFileRef & { score: number }> = [];

  for (const file of collectSourceFiles(repoRoot)) {
    const absolutePath = resolve(repoRoot, file);
    const content = fs.readFileSync(absolutePath, 'utf-8');

    for (const term of terms) {
      if (!content.includes(term)) continue;

      candidates.push({
        file,
        line: findLineNumberForTerm(content, term),
        score: sourceFileRouteScore(file, pagePath),
      });
      break;
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const bestScore = candidates[0]?.score ?? 0;
  const filtered = bestScore > 0 ? candidates.filter((candidate) => candidate.score === bestScore) : candidates;

  return filtered.slice(0, 5).map(({ score: _score, ...ref }) => ref);
}

function collectCandidateRoutePaths(pageUrl: string, componentName?: string | null): string[] {
  const paths = new Set<string>();

  const pagePath = getPagePath(pageUrl);
  if (pagePath) paths.add(pagePath);

  if (componentName) {
    const componentPath = getPagePath(componentName.trim());
    if (componentPath) paths.add(componentPath);
  }

  return Array.from(paths);
}

function inferSourceRefsFromPageRoute(
  pageUrl: string,
  repoRoot: string,
  componentName?: string | null
): SourceFileRef[] {
  const routePaths = collectCandidateRoutePaths(pageUrl, componentName);
  if (routePaths.length === 0) return [];

  const sourceFiles = collectSourceFiles(repoRoot);
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();

  for (const routePath of routePaths) {
    for (const file of sourceFiles) {
      if (routePathFromAppFile(file) !== routePath) continue;
      addSourceRef(refs, seen, { file });
    }
  }

  return refs;
}

function buildSourceSearchText(error: ErrorLogEntry): string {
  const parts = [error.error_stack || '', error.error_message || ''];
  if (error.additional_data) {
    try {
      parts.push(JSON.stringify(error.additional_data));
    } catch {
      // Ignore non-serializable diagnostic metadata.
    }
  }
  return parts.join('\n');
}

export function extractSourceFilesForError(error: ErrorLogEntry, repoRoot = process.cwd()): SourceFileRef[] {
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();
  const searchText = buildSourceSearchText(error);

  for (const ref of parseStackTrace(error.error_stack)) {
    addSourceRef(refs, seen, ref);
  }

  if (refs.length === 0) {
    for (const ref of findSourceRefsByConsoleTerm(error.error_message || '', error.page_url || '', repoRoot)) {
      addSourceRef(refs, seen, ref);
    }
  }

  if (refs.length === 0) {
    for (const ref of extractNextAppChunkSourceRefs(searchText, repoRoot)) {
      addSourceRef(refs, seen, ref);
    }
  }

  if (refs.length === 0) {
    for (const ref of extractNextServerAppSourceRefs(searchText, repoRoot)) {
      addSourceRef(refs, seen, ref);
    }
  }

  if (refs.length === 0) {
    for (const ref of inferSourceRefsFromPageRoute(
      error.page_url || '',
      repoRoot,
      error.component_name
    )) {
      addSourceRef(refs, seen, ref);
    }
  }

  return refs;
}

function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\b[0-9a-f]{24,}\b/gi, '<ID>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, '<TIMESTAMP>')
    .replace(/https?:\/\/[^\s)]+/g, '<URL>')
    .trim()
    .substring(0, 200);
}

function normalizePath(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    // Replace UUID-like segments and numeric IDs in paths
    return pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/<ID>')
      .replace(/\/\d+(?=\/|$)/g, '/<N>');
  } catch {
    return url;
  }
}

function createPatternKey(error: ErrorLogEntry): string {
  const type = error.error_type || 'Unknown';
  const component = error.component_name || 'NoComponent';
  const normalizedMsg = normalizeMessage(error.error_message || '');
  return `${type}::${component}::${normalizedMsg}`;
}

export function groupIntoPatterns(errors: ErrorLogEntry[], repoRoot = process.cwd()): ErrorPattern[] {
  const patternMap = new Map<string, ErrorPattern>();

  for (const error of errors) {
    const key = createPatternKey(error);

    if (!patternMap.has(key)) {
      patternMap.set(key, {
        patternKey: key,
        errorType: error.error_type || 'Unknown',
        component: error.component_name || 'Unknown',
        normalizedMessage: normalizeMessage(error.error_message || ''),
        occurrences: [],
        sourceFiles: [],
        affectedPages: [],
        affectedUsers: [],
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
      });
    }

    const pattern = patternMap.get(key)!;
    pattern.occurrences.push(error);

    // Track timestamps
    if (error.timestamp < pattern.firstSeen) pattern.firstSeen = error.timestamp;
    if (error.timestamp > pattern.lastSeen) pattern.lastSeen = error.timestamp;

    // Track affected pages (normalized)
    const pagePath = error.page_url ? normalizePath(error.page_url) : 'Unknown';
    if (!pattern.affectedPages.includes(pagePath)) {
      pattern.affectedPages.push(pagePath);
    }

    // Track affected users
    const userLabel = error.user_email || error.user_id || 'anonymous';
    if (!pattern.affectedUsers.includes(userLabel)) {
      pattern.affectedUsers.push(userLabel);
    }

    // Parse stack traces and infer source files from available runtime context.
    const refs = extractSourceFilesForError(error, repoRoot);
    for (const ref of refs) {
      const exists = pattern.sourceFiles.some(
        (s) => s.file === ref.file && s.line === ref.line
      );
      if (!exists) {
        pattern.sourceFiles.push(ref);
      }
    }
  }

  // Sort by occurrence count (most frequent first)
  return Array.from(patternMap.values()).sort(
    (a, b) => b.occurrences.length - a.occurrences.length
  );
}

function classifyRootCauseFamily(pattern: ErrorPattern): string {
  const text = [
    pattern.errorType,
    pattern.component,
    pattern.normalizedMessage,
    ...pattern.affectedPages,
  ]
    .join(' ')
    .toLowerCase();
  if (/\b(rls|row level|auth|jwt|permission|forbidden|unauthori[sz]ed|access control)\b/u.test(text)) {
    return 'auth-permissions-security';
  }
  if (/\b(postgres|database|sql|constraint|foreign key|supabase|schema|migration)\b/u.test(text)) {
    return 'database-persistence';
  }
  if (/\b(payment|billing|invoice total|payroll|money|charge)\b/u.test(text)) {
    return 'money-billing';
  }
  if (/\b(deadlock|race condition|concurren|transaction conflict)\b/u.test(text)) {
    return 'concurrency-transaction';
  }
  if (/\b(network|failed to fetch|econn|enotfound|third[- ]party|gateway|offline)\b/u.test(text)) {
    return 'external-network';
  }
  if (/\b(validation|invalid input|required field|user input)\b/u.test(text)) {
    return 'user-input';
  }
  const primarySource = pattern.sourceFiles[0]?.file;
  return primarySource
    ? `source:${primarySource}`
    : `component:${pattern.component.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`;
}

function classifyCluster(
  rootCauseFamily: string,
  patterns: ErrorPattern[]
): Pick<ErrorRootCauseCluster, 'lane' | 'action'> {
  if (
    rootCauseFamily === 'auth-permissions-security' ||
    rootCauseFamily === 'database-persistence' ||
    rootCauseFamily === 'money-billing' ||
    rootCauseFamily === 'concurrency-transaction'
  ) {
    return { lane: 'critical', action: 'critical-gates' };
  }
  if (rootCauseFamily === 'external-network' || rootCauseFamily === 'user-input') {
    return { lane: 'report-only', action: 'report-only' };
  }
  const sourceFiles = new Set(patterns.flatMap((pattern) => pattern.sourceFiles.map((ref) => ref.file)));
  if (patterns.length > 2 || sourceFiles.size > 2) {
    return { lane: 'guarded', action: 'investigate' };
  }
  if (patterns.length > 1 || sourceFiles.size > 1) {
    return { lane: 'standard', action: 'fix' };
  }
  return sourceFiles.size === 1
    ? { lane: 'fast', action: 'fix' }
    : { lane: 'report-only', action: 'report-only' };
}

export function clusterErrorPatterns(patterns: ErrorPattern[]): ErrorRootCauseCluster[] {
  const grouped = new Map<string, ErrorPattern[]>();
  for (const pattern of patterns) {
    const family = classifyRootCauseFamily(pattern);
    grouped.set(family, [...(grouped.get(family) ?? []), pattern]);
  }
  return [...grouped.entries()]
    .map(([rootCauseFamily, familyPatterns], index) => {
      const classification = classifyCluster(rootCauseFamily, familyPatterns);
      return {
        id: `cluster-${index + 1}`,
        rootCauseFamily,
        ...classification,
        patterns: familyPatterns,
        occurrences: familyPatterns.reduce(
          (total, pattern) => total + pattern.occurrences.length,
          0
        ),
      };
    })
    .sort((left, right) => right.occurrences - left.occurrences);
}

export function splitLifecycleClusters(clusters: ErrorRootCauseCluster[], repoRoot = process.cwd()): ErrorRootCauseCluster[] {
  const exact = new Map<string, ErrorRootCauseCluster>();
  for (const cluster of clusters) for (const pattern of cluster.patterns) for (const occurrence of pattern.occurrences) {
    const single = {
      ...pattern, occurrences: [occurrence], sourceFiles: extractSourceFilesForError(occurrence, repoRoot),
      firstSeen: occurrence.timestamp, lastSeen: occurrence.timestamp,
    };
    const scoped = { ...cluster, patterns: [single], occurrences: 1 };
    const fingerprint = fingerprintIncident(buildRetrievalCluster(scoped, { version: 1, incidents: [] }).query);
    const previous = exact.get(fingerprint);
    if (previous) {
      const matching = previous.patterns.find(entry => entry.patternKey === single.patternKey);
      if (matching) {
        matching.occurrences.push(occurrence);
        matching.firstSeen = [matching.firstSeen, occurrence.timestamp].sort()[0];
        matching.lastSeen = [matching.lastSeen, occurrence.timestamp].sort().at(-1)!;
        for (const ref of single.sourceFiles) if (!matching.sourceFiles.some(source => source.file === ref.file && source.line === ref.line)) {
          matching.sourceFiles.push(ref);
        }
      } else previous.patterns.push(single);
      previous.occurrences++;
    } else exact.set(fingerprint, { ...scoped, id: `cluster-${exact.size + 1}` });
  }
  return [...exact.values()];
}

export function safeRetrievalText(value: string): string {
    const sanitized = sanitizeKnowledgeText(value);
    try { rejectSensitiveText(sanitized, 'retrieval'); return sanitized; }
    catch { return '[redacted]'; }
  }

function isDiagnosticObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The console logger serialises the HTTP error and its errorContextId argument
// separately. Only inspect their known top-level fields, never payloads or prose.
function retainedRequestFields(entry?: ErrorLogEntry): Pick<IncidentQuery, 'httpStatus' | 'errorContextId'> {
  const data = entry?.additional_data;
  const statuses = new Set<number>();
  const contexts = new Set<string>();
  const addStatus = (value: unknown) => {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) statuses.add(value);
  };
  const addContext = (value: unknown) => {
    if (typeof value === 'string' && /^[a-z][\w.-]{2,95}$/iu.test(value)) contexts.add(value);
  };
  addStatus(data?.status);
  addContext(data?.errorContextId);
  const args = data?.args;
  const prefix = /^\[?console[. ](?:error|warn(?:ing)?)\]?\s*:\s*/iu.exec(entry?.error_message ?? '');
  if (entry && prefix && Array.isArray(args) && args.length >= 2 && args.length <= 16 &&
      typeof args[0] === 'string' && args[0].length >= 4 && args[0].length <= 200 &&
      entry.error_message.startsWith(args[0], prefix[0].length)) {
    for (const arg of args.slice(1)) {
      if (!isDiagnosticObject(arg)) continue;
      // A context marker and a serialised Error are the recognised envelopes.
      // Do not harvest a similarly named field from arbitrary application data.
      if (Object.hasOwn(arg, 'errorContextId')) addContext(arg.errorContextId);
      if (Object.hasOwn(arg, 'cause') || arg.name === 'Error' ||
          (typeof arg.message === 'string' && typeof arg.stack === 'string')) addStatus(arg.status);
    }
  }
  return {
    httpStatus: statuses.size === 1 ? [...statuses][0] : null,
    errorContextId: contexts.size === 1 ? safeRetrievalText([...contexts][0]) : null,
  };
}

export function buildRetrievalCluster(cluster: ErrorRootCauseCluster, knowledge: KnowledgeStore): AutoRetrieval['clusters'][number] {
    const pattern = cluster.patterns[0];
    const occurrences = cluster.patterns.flatMap(item => item.occurrences);
    const occurrence = occurrences[0];
    const requestFields = occurrences.map(retainedRequestFields);
    const first = requestFields[0];
    const additional = occurrence?.additional_data;
    let route = 'NoPage';
    try { route = occurrence?.page_url ? new URL(occurrence.page_url).pathname : 'NoPage'; }
    catch { route = 'NoPage'; }
    const query: IncidentQuery = {
      httpStatus: first && requestFields.every(entry => entry.httpStatus === first.httpStatus) ? first.httpStatus : null,
      errorContextId: first && requestFields.every(entry => entry.errorContextId === first.errorContextId) ? first.errorContextId : null,
      route: safeRetrievalText(route),
      component: safeRetrievalText(pattern?.component ?? 'NoComponent'),
      sourceFile: pattern?.sourceFiles.map(source => source.file).find(isFixerrorsSourcePath) ?? null,
      normalizedMessage: safeRetrievalText(pattern?.normalizedMessage ?? ''),
      rootCauseFamily: safeRetrievalText(cluster.rootCauseFamily),
    };
    const files = [...new Set(cluster.patterns.flatMap(entry => entry.sourceFiles.map(source => source.file).filter(isFixerrorsSourcePath)))];
    const operation: IncidentDiagnostics['operation'] = files.includes('app/api/me/usage-events/route.ts')
      ? 'usage-analytics' : files.includes('app/api/messages/notifications/count/route.ts') ? 'notification-count'
        : files.some(file => /(?:^|\/)timesheets?\//u.test(file)) ? 'timesheet-submit'
          : files.some(file => /(?:^|\/)quotes\//u.test(file)) ? 'quotes' : 'unknown';
    const classes = new Set<IncidentDiagnostics['classes'][number]>();
    for (const [index, entry] of occurrences.entries()) {
      const status = requestFields[index].httpStatus;
      let known = status === 401 || status === 403;
      if (known) classes.add('authentication');
      // Only fixed structured signals escalate. Ordinary 401/403, prose and
      // console.error never establish an outage or security compromise.
      const impact = entry.additional_data?.impact;
      const serious = ['security-compromise', 'data-corruption', 'service-outage'] as const;
      for (const value of serious) {
        if (impact === value) { classes.add(value); known = true; }
      }
      if (['XX001', 'XX002'].includes(String(entry.additional_data?.databaseCode))) {
        classes.add('data-corruption'); known = true;
      }
      if (/validation|invalid input|required field/iu.test(entry.error_message)) { classes.add('validation'); known = true; }
      if (/failed to fetch|fetch failed|network|econnreset|etimedout|enotfound|socket hang up/iu.test(entry.error_message)) {
        classes.add('network'); known = true;
      }
      if (/unauthorized|forbidden|permission denied/iu.test(entry.error_message)) { classes.add('authentication'); known = true; }
      if (/^(?:TypeError|ReferenceError|RangeError)$/u.test(entry.error_type)) { classes.add('runtime'); known = true; }
      if (!known) classes.add('unknown');
    }
    const stages = ['origin-check', 'authentication', 'record-usage', 'validation', 'submit'] as const;
    const stage = stages.find(value => occurrences.every(entry => entry.additional_data?.stage === value));
    const code = occurrences.every(entry => entry.additional_data?.databaseCode === additional?.databaseCode)
      ? additional?.databaseCode : undefined;
    const day = (value: string | undefined) => value && /^\d{4}-\d{2}-\d{2}T/u.test(value) &&
      Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : undefined;
    const frames = cluster.patterns.flatMap(entry => entry.sourceFiles).filter(frame => isFixerrorsSourcePath(frame.file))
      .slice(0, 12).map(frame => ({
        file: frame.file,
        ...(frame.line && frame.line > 0 && frame.line <= 1_000_000 ? { line: frame.line } : {}),
      }));
    const firstDays = cluster.patterns.flatMap(entry => day(entry.firstSeen) ?? []).sort();
    const lastDays = cluster.patterns.flatMap(entry => day(entry.lastSeen) ?? []).sort();
    const diagnostics: IncidentDiagnostics = {
      classes: classes.size ? [...classes] : ['unknown'], operation,
      ...(stage ? { stage } : {}),
      ...(typeof code === 'string' && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/u.test(code) ? { databaseCode: code } : {}),
      noncriticalHandled: operation === 'usage-analytics' && stage === 'record-usage' &&
        occurrences.every(entry => entry.additional_data?.transient === true),
      occurrences: Math.max(1, cluster.occurrences),
      ...(firstDays.length ? { firstDay: firstDays[0] } : {}),
      ...(lastDays.length ? { lastDay: lastDays.at(-1) } : {}),
      frames,
    };
    return {
      id: cluster.id, rootCauseFamily: safeRetrievalText(cluster.rootCauseFamily),
      advisoryLane: cluster.lane, advisoryAction: cluster.action, query,
      sourceFiles: files,
      patterns: cluster.patterns.map(entry => ({
        errorType: safeRetrievalText(entry.errorType), component: safeRetrievalText(entry.component),
        normalizedMessage: safeRetrievalText(entry.normalizedMessage),
        sourceFiles: entry.sourceFiles.map(source => source.file).filter(isFixerrorsSourcePath), occurrences: entry.occurrences.length,
      })),
      priorResolutions: retrieveIncidents(knowledge, query),
      diagnostics,
    };
  }

export function lifecycleErrorEntry(record: LifecycleRecord): ErrorLogEntry {
    return {
      id: record.id, timestamp: String(record.timestamp), created_at: String(record.created_at),
      error_message: String(record.error_message ?? ''), error_stack: record.error_stack == null ? null : String(record.error_stack),
      error_type: String(record.error_type ?? ''), user_id: null, user_email: null,
      page_url: String(record.page_url ?? ''), user_agent: '', component_name: record.component_name == null ? null : String(record.component_name),
      additional_data: record.additional_data && typeof record.additional_data === 'object' && !Array.isArray(record.additional_data)
        ? record.additional_data as Record<string, unknown> : null,
    };
  }

export function assertLifecycleSnapshotRows(records: LifecycleRecord[], errors: ErrorLogEntry[]): void {
    const stamp = (value: unknown): string => {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error('Invalid exact snapshot timestamp');
      return new Date(value).toISOString().slice(0, 19) + '.' + (value.match(/\.(\d+)/u)?.[1] ?? '').padEnd(6, '0') + 'Z';
    };
    const byId = new Map(records.map(record => [record.id, record]));
    if (records.length !== errors.length || byId.size !== records.length ||
        new Set(errors.map(error => error.id)).size !== errors.length) {
      throw new Error('Lifecycle snapshot exact row set changed');
    }
    for (const error of errors) {
      const record = byId.get(error.id);
      if (!record || record.status !== 'active' || record.triage_state !== null ||
          Object.entries(error).some(([key, value]) =>
            ['timestamp', 'created_at'].includes(key) ? stamp(record[key]) !== stamp(value) :
              JSON.stringify(record[key] ?? null) !== JSON.stringify(value))) {
        throw new Error('Lifecycle source rows no longer match the captured snapshot');
      }
    }
  }
