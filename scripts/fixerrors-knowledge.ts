import { createHash } from 'crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import path from 'path';

export const FIXERRORS_KNOWLEDGE_VERSION = 1;
export const FIXERRORS_KNOWLEDGE_PATH = path.resolve(
  process.cwd(),
  'lib/config/fixerrors-knowledge.json'
);
export const MAX_RETRIEVAL_MATCHES = 5;

export const INCIDENT_OUTCOMES = [
  'expected',
  'report_only',
  'manual_evidence_gap',
  'fix_verified_local',
  'fix_failed',
  'recurred',
] as const;

export const INCIDENT_LANES = [
  'fast',
  'standard',
  'guarded',
  'critical',
  'report-only',
] as const;

export const INCIDENT_CONFIDENCE = ['low', 'medium', 'high'] as const;

const INCIDENT_KEYS = [
  'id',
  'fingerprint',
  'errorContextId',
  'httpStatus',
  'route',
  'component',
  'sourceFile',
  'normalizedMessage',
  'rootCauseFamily',
  'diagnosis',
  'fixSummary',
  'changedFiles',
  'tests',
  'confidence',
  'outcome',
  'lane',
  'firstSeen',
  'lastSeen',
  'occurrences',
  'recurrenceCount',
  'updatedAt',
] as const;

const SENSITIVE_TEXT =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|postgres(?:ql)?:\/\/|bearer\s+|service_role|password\s*[:=]|secret\s*[:=]|api[_-]?key\s*[:=]|user_id\s*[:=]|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\+\d[\d\s().-]{8,}\d|\b\d{10,}\b|\b0\d[\d\s]{8,}\d\b/iu;

export type IncidentOutcome = (typeof INCIDENT_OUTCOMES)[number];
export type IncidentLane = (typeof INCIDENT_LANES)[number];
export type IncidentConfidence = (typeof INCIDENT_CONFIDENCE)[number];

export interface KnowledgeIncident {
  id: string;
  fingerprint: string;
  errorContextId: string | null;
  httpStatus: number | null;
  route: string;
  component: string;
  sourceFile: string | null;
  normalizedMessage: string;
  rootCauseFamily: string;
  diagnosis: string;
  fixSummary: string | null;
  changedFiles: string[];
  tests: string[];
  confidence: IncidentConfidence;
  outcome: IncidentOutcome;
  lane: IncidentLane;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  recurrenceCount: number;
  updatedAt: string;
}

export interface KnowledgeStore {
  version: typeof FIXERRORS_KNOWLEDGE_VERSION;
  incidents: KnowledgeIncident[];
}

export interface IncidentQuery {
  errorContextId: string | null;
  httpStatus: number | null;
  route: string;
  component: string;
  sourceFile: string | null;
  normalizedMessage: string;
  rootCauseFamily: string;
}

export interface RetrievalMatch {
  incidentId: string;
  fingerprint: string;
  match: 'exact' | 'related';
  advisory: boolean;
  score: number;
  confidence: IncidentConfidence;
  outcome: IncidentOutcome;
  diagnosis: string;
  fixSummary: string | null;
  changedFiles: string[];
  tests: string[];
  updatedAt: string;
  contradictsEarlierSuccess: boolean;
}

export interface RecordIncidentInput extends IncidentQuery {
  diagnosis: string;
  fixSummary: string | null;
  changedFiles: string[];
  tests: string[];
  confidence: IncidentConfidence;
  outcome: IncidentOutcome;
  lane: IncidentLane;
  observedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function rejectSensitiveText(value: string, field: string): void {
  if (SENSITIVE_TEXT.test(value)) {
    throw new Error(`Sensitive knowledge rejected in ${field}`);
  }
}

function assertSafeText(value: string, field: string): void {
  rejectSensitiveText(value, field);
}

export function sanitizeKnowledgeText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/giu, '[redacted-url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 180);
}

export function fingerprintIncident(query: IncidentQuery): string {
  const payload = [
    query.rootCauseFamily,
    query.route,
    query.component,
    query.sourceFile ?? '',
    query.errorContextId ?? '',
    query.httpStatus === null ? '' : String(query.httpStatus),
    sanitizeKnowledgeText(query.normalizedMessage).toLowerCase(),
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${field} must be a string array`);
  }
  for (const entry of value) {
    assertSafeText(entry, field);
    if (entry.includes('..') || entry.startsWith('/') || /^[A-Za-z]:/u.test(entry)) {
      throw new Error(`${field} contains an unsafe path`);
    }
  }
  return value;
}

function parseIncident(value: unknown): KnowledgeIncident {
  if (!isRecord(value)) throw new Error('Incident must be an object');
  const keys = Object.keys(value);
  if (keys.some((key) => !INCIDENT_KEYS.includes(key as (typeof INCIDENT_KEYS)[number]))) {
    throw new Error('Incident contains a non-allowlisted field');
  }
  for (const key of INCIDENT_KEYS) {
    if (!(key in value)) throw new Error(`Incident missing ${key}`);
  }
  const incident = value as unknown as KnowledgeIncident;
  if (!/^fei_[a-f0-9]{16}$/u.test(incident.id)) throw new Error('Invalid incident id');
  if (!/^[a-f0-9]{64}$/u.test(incident.fingerprint)) throw new Error('Invalid fingerprint');
  if (incident.errorContextId !== null && typeof incident.errorContextId !== 'string') {
    throw new Error('Invalid error context');
  }
  if (
    incident.httpStatus !== null &&
    (!Number.isInteger(incident.httpStatus) || incident.httpStatus < 100 || incident.httpStatus > 599)
  ) {
    throw new Error('Invalid HTTP status');
  }
  for (const field of [
    'route',
    'component',
    'normalizedMessage',
    'rootCauseFamily',
    'diagnosis',
    'firstSeen',
    'lastSeen',
    'updatedAt',
  ] as const) {
    if (typeof incident[field] !== 'string' || !incident[field]) {
      throw new Error(`Invalid ${field}`);
    }
    assertSafeText(incident[field], field);
  }
  if (incident.sourceFile !== null) assertStringArray([incident.sourceFile], 'sourceFile');
  if (incident.fixSummary !== null) {
    if (typeof incident.fixSummary !== 'string') throw new Error('Invalid fix summary');
    assertSafeText(incident.fixSummary, 'fixSummary');
  }
  if (incident.errorContextId) assertSafeText(incident.errorContextId, 'errorContextId');
  assertStringArray(incident.changedFiles, 'changedFiles');
  assertStringArray(incident.tests, 'tests');
  if (!INCIDENT_CONFIDENCE.includes(incident.confidence)) throw new Error('Invalid confidence');
  if (!INCIDENT_OUTCOMES.includes(incident.outcome)) throw new Error('Invalid outcome');
  if (!INCIDENT_LANES.includes(incident.lane)) throw new Error('Invalid lane');
  if (!Number.isInteger(incident.occurrences) || incident.occurrences < 1) {
    throw new Error('Invalid occurrences');
  }
  if (!Number.isInteger(incident.recurrenceCount) || incident.recurrenceCount < 0) {
    throw new Error('Invalid recurrence count');
  }
  return incident;
}

export function parseKnowledgeStore(value: unknown): KnowledgeStore {
  if (!isRecord(value)) throw new Error('Knowledge store must be an object');
  if (Object.keys(value).some((key) => key !== 'version' && key !== 'incidents')) {
    throw new Error('Knowledge store contains a non-allowlisted field');
  }
  if (value.version !== FIXERRORS_KNOWLEDGE_VERSION) throw new Error('Unsupported knowledge version');
  if (!Array.isArray(value.incidents)) throw new Error('Knowledge incidents must be an array');
  const incidents = value.incidents.map(parseIncident);
  const ids = new Set<string>();
  for (const incident of incidents) {
    if (ids.has(incident.id)) throw new Error(`Duplicate incident ${incident.id}`);
    ids.add(incident.id);
  }
  return { version: FIXERRORS_KNOWLEDGE_VERSION, incidents };
}

export function loadKnowledgeStore(filePath = FIXERRORS_KNOWLEDGE_PATH): KnowledgeStore {
  if (!existsSync(filePath)) return { version: FIXERRORS_KNOWLEDGE_VERSION, incidents: [] };
  return parseKnowledgeStore(JSON.parse(readFileSync(filePath, 'utf8')));
}

export function assertNoSensitiveKnowledge(store: KnowledgeStore): void {
  parseKnowledgeStore(store);
  assertSafeText(JSON.stringify(store), 'knowledge');
}

function incidentId(fingerprint: string, observedAt: string): string {
  return `fei_${createHash('sha256').update(`${fingerprint}|${observedAt}`).digest('hex').slice(0, 16)}`;
}

function latestExact(store: KnowledgeStore, fingerprint: string): KnowledgeIncident | null {
  return store.incidents
    .filter((incident) => incident.fingerprint === fingerprint)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

export function applySnapshotAbsence(store: KnowledgeStore): KnowledgeStore {
  return parseKnowledgeStore(structuredClone(store));
}

export function recordIncidentOutcome(
  store: KnowledgeStore,
  input: RecordIncidentInput
): KnowledgeStore {
  const validated = parseKnowledgeStore(store);
  for (const [field, value] of Object.entries(input)) {
    if (typeof value === 'string') rejectSensitiveText(value, field);
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') rejectSensitiveText(entry, field);
      }
    }
  }
  const query: IncidentQuery = {
    errorContextId: input.errorContextId,
    httpStatus: input.httpStatus,
    route: sanitizeKnowledgeText(input.route),
    component: sanitizeKnowledgeText(input.component),
    sourceFile: input.sourceFile,
    normalizedMessage: sanitizeKnowledgeText(input.normalizedMessage),
    rootCauseFamily: sanitizeKnowledgeText(input.rootCauseFamily),
  };
  const fingerprint = fingerprintIncident(query);
  const existing = latestExact(validated, fingerprint);
  let outcome = input.outcome;
  let recurrenceCount = existing?.recurrenceCount ?? 0;
  if (existing?.outcome === 'fix_verified_local' && outcome !== 'fix_failed') {
    outcome = 'recurred';
    recurrenceCount += 1;
  }
  if (
    outcome === 'recurred' &&
    existing?.outcome !== 'fix_verified_local' &&
    existing?.outcome !== 'recurred'
  ) {
    throw new Error('Recurrence requires an exact previously verified local fix');
  }
  const incident: KnowledgeIncident = {
    id: incidentId(fingerprint, input.observedAt),
    fingerprint,
    ...query,
    diagnosis: sanitizeKnowledgeText(input.diagnosis),
    fixSummary: input.fixSummary ? sanitizeKnowledgeText(input.fixSummary) : null,
    changedFiles: input.changedFiles,
    tests: input.tests,
    confidence: input.confidence,
    outcome,
    lane: input.lane,
    firstSeen: existing?.firstSeen ?? input.observedAt,
    lastSeen: input.observedAt,
    occurrences: (existing?.occurrences ?? 0) + 1,
    recurrenceCount,
    updatedAt: input.observedAt,
  };
  const incidents = [incident, ...validated.incidents];
  const next = parseKnowledgeStore({ version: FIXERRORS_KNOWLEDGE_VERSION, incidents });
  assertNoSensitiveKnowledge(next);
  return next;
}

function relatedScore(incident: KnowledgeIncident, query: IncidentQuery): number {
  let score = 0;
  if (query.errorContextId && incident.errorContextId === query.errorContextId) score += 4;
  if (query.route && incident.route === query.route) score += 3;
  if (query.sourceFile && incident.sourceFile === query.sourceFile) score += 3;
  if (query.httpStatus !== null && incident.httpStatus === query.httpStatus) score += 2;
  if (query.component && incident.component === query.component) score += 2;
  if (query.rootCauseFamily && incident.rootCauseFamily === query.rootCauseFamily) score += 2;
  const left = new Set(sanitizeKnowledgeText(query.normalizedMessage).toLowerCase().split(' '));
  const overlap = sanitizeKnowledgeText(incident.normalizedMessage)
    .toLowerCase()
    .split(' ')
    .filter((token) => token.length > 3 && left.has(token)).length;
  return score + Math.min(overlap, 3);
}

export function retrieveIncidents(
  store: KnowledgeStore,
  query: IncidentQuery
): RetrievalMatch[] {
  const validated = parseKnowledgeStore(store);
  const fingerprint = fingerprintIncident(query);
  const exact = validated.incidents
    .filter((incident) => incident.fingerprint === fingerprint)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const latest = exact[0];
  const contradictsEarlierSuccess = Boolean(
    latest &&
      (latest.outcome === 'fix_failed' || latest.outcome === 'recurred') &&
      exact.some((incident) => incident.outcome === 'fix_verified_local' && incident.updatedAt < latest.updatedAt)
  );
  const exactMatches: RetrievalMatch[] = exact.slice(0, MAX_RETRIEVAL_MATCHES).map((incident) => ({
    incidentId: incident.id,
    fingerprint: incident.fingerprint,
    match: 'exact',
    advisory: false,
    score: 100,
    confidence: incident.confidence,
    outcome: incident.outcome,
    diagnosis: incident.diagnosis,
    fixSummary: incident.fixSummary,
    changedFiles: incident.changedFiles,
    tests: incident.tests,
    updatedAt: incident.updatedAt,
    contradictsEarlierSuccess,
  }));
  if (exactMatches.length > 0) return exactMatches;

  return validated.incidents
    .map((incident) => ({ incident, score: relatedScore(incident, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.incident.updatedAt.localeCompare(left.incident.updatedAt))
    .slice(0, MAX_RETRIEVAL_MATCHES)
    .map(({ incident, score }) => ({
      incidentId: incident.id,
      fingerprint: incident.fingerprint,
      match: 'related' as const,
      advisory: true,
      score,
      confidence: incident.confidence,
      outcome: incident.outcome,
      diagnosis: incident.diagnosis,
      fixSummary: incident.fixSummary,
      changedFiles: incident.changedFiles,
      tests: incident.tests,
      updatedAt: incident.updatedAt,
      contradictsEarlierSuccess: false,
    }));
}

export function summarizeKnowledgeOutcomes(store: KnowledgeStore): {
  verifiedOutcomeCount: number;
  recurrenceCount: number;
} {
  const validated = parseKnowledgeStore(store);
  return {
    verifiedOutcomeCount: validated.incidents.filter((incident) => incident.outcome === 'fix_verified_local').length,
    recurrenceCount: validated.incidents.reduce((total, incident) => total + incident.recurrenceCount, 0),
  };
}

export function saveKnowledgeAtomic(store: KnowledgeStore, filePath: string): KnowledgeStore {
  const validated = parseKnowledgeStore(store);
  assertNoSensitiveKnowledge(validated);
  const lockPath = `${filePath}.lock`;
  const started = Date.now();
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() - started > 2000) throw new Error('Knowledge update lock is held');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    const content = `${JSON.stringify(validated, null, 2)}\n`;
    writeFileSync(temporaryPath, content, 'utf8');
    if (readFileSync(temporaryPath, 'utf8') !== content) {
      throw new Error('Knowledge temporary readback mismatch');
    }
    renameSync(temporaryPath, filePath);
    const persisted = parseKnowledgeStore(JSON.parse(readFileSync(filePath, 'utf8')));
    if (JSON.stringify(persisted) !== JSON.stringify(validated)) {
      throw new Error('Knowledge persisted readback mismatch');
    }
    return persisted;
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  } finally {
    closeSync(fd);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}
