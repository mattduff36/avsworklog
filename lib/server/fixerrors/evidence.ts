import 'server-only';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { buildFixerrorsBatchRetrieval, fetchFixerrorsBatchSnapshot } from '@/scripts/fixerrors-capture';
import { createDatabaseTargetFingerprint, type PgClientLike } from '@/scripts/fixerrors-safety';
import { loadKnowledgeStore } from '@/scripts/fixerrors-knowledge';
import { describeBatch, type CapturedBatch } from '@/lib/fixerrors/batch';
import { getFixerrorsProductionDatabaseSsl, isFixerrorsProductionEnabled, projectRef } from './config';
import { type Checkout } from '@/lib/fixerrors/protocol';
import { parseStackTrace } from '@/lib/fixerrors/stack';
import { isFixerrorsSourcePath } from '@/scripts/fixerrors-auto';
import { encodeCompanionPacket } from '@/scripts/automation/fixerrors-companion-packet';
import { rejectSensitiveText } from '@/scripts/fixerrors-knowledge';

export interface FreshErrorEvidence {
  error_message: string;
  error_stack: string | null;
  error_type: string;
  triage_state: string | null;
}

// Arbitrary diagnostic prose can contain names, credentials or instructions.
// Only fixed diagnostic vocabulary and bounded source references cross this boundary.
export function projectFreshEvidence(row: FreshErrorEvidence, requestId: string, checkout: Checkout): string {
  if (row.error_message.length > 32_768 || (row.error_stack?.length ?? 0) > 65_536) {
    throw new Error('Error evidence exceeds the bounded capture limit');
  }
  const text = `${row.error_type} ${row.error_message}`;
  const sensitive = /auth|permission|forbidden|unauthori|session|jwt|password|secret|token|rls|database|postgres|supabase|sql|payroll|invoice|quote|payment|finance|deadlock|concurren|race condition/i.test(text);
  const network = /network|fetch failed|failed to fetch|timeout|load chunk|chunkload/i.test(text);
  const family = sensitive ? 'sensitive-runtime' : network ? 'network-transient' : 'runtime-error';
  const diagnostic = /cannot read properties of (?:undefined|null)/i.test(text)
    ? 'Cannot read properties of an absent value'
    : /is not a function/i.test(text) ? 'Runtime value is not callable'
      : /maximum update depth/i.test(text) ? 'Maximum update depth exceeded'
        : network ? 'Network request or resource load failed'
          : 'Runtime error; free text withheld for privacy; inspect source evidence';
  const errorType = ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(row.error_type)
    ? row.error_type : 'Error';
  const boundedStack = row.error_stack?.split(/\r?\n/u).filter(line => line.length <= 2048).slice(0, 64).join('\n') ?? null;
  const sources = [...new Set(parseStackTrace(boundedStack).map(ref => ref.file))]
    .filter(source => source.length <= 512 && isFixerrorsSourcePath(source)).slice(0, 8);
  for (const source of sources) rejectSensitiveText(source, 'Fresh evidence source');
  const held = !sources.length || (row.triage_state !== null && !['untriaged', 'outstanding'].includes(row.triage_state));
  const retrieval = {
    schemaVersion: 1, snapshotId: requestId, baseHead: checkout.head,
    treeFingerprint: createHash('sha256').update(`${checkout.tree}\n`).digest('hex'),
    archiveMeansResolved: false,
    clusters: [{
      id: 'cluster-1', rootCauseFamily: family,
      advisoryLane: sensitive ? 'critical' : network ? 'report-only' : 'standard',
      advisoryAction: held ? 'manual evidence required' : 'investigate',
      query: { errorContextId: null, httpStatus: null, route: 'NoPage', component: 'NoComponent',
        sourceFile: sources[0] ?? null, normalizedMessage: diagnostic, rootCauseFamily: family },
      sourceFiles: sources,
      patterns: [{ errorType, component: 'NoComponent', normalizedMessage: diagnostic, sourceFiles: sources, occurrences: 1 }],
      priorResolutions: [], held,
      existingState: held ? 'awaiting-evidence' : 'actionable',
      matchingAllowed: false,
    }],
  };
  return encodeCompanionPacket({
    schemaVersion: 1,
    snapshotChecksum: createHash('sha256').update(JSON.stringify(retrieval)).digest('hex'),
    retrieval,
  }, { baseHead: retrieval.baseHead, treeFingerprint: retrieval.treeFingerprint }).toString('utf8');
}

// Called only after actual-SuperAdmin/origin and queue eligibility checks.
// This application client is never shared with the dedicated queue login.
export async function captureFreshFixerrorsEvidence(_requestId: string, checkout: Checkout): Promise<CapturedBatch> {
  return withFixerrorsApplicationDatabase(async (client, target) => {
    const snapshot = await fetchFixerrorsBatchSnapshot(client, target);
    const captured = buildFixerrorsBatchRetrieval({
      ...snapshot, candidate: { baseHead: checkout.head,
        treeFingerprint: createHash('sha256').update(`${checkout.tree}\n`).digest('hex') },
      knowledge: loadKnowledgeStore(resolve(process.cwd(), 'lib', 'config', 'fixerrors-knowledge.json')),
      repoRoot: process.cwd(),
    });
    const manifest = JSON.stringify({
      schemaVersion: 1, snapshotChecksum: snapshot.snapshot.checksum, retrieval: captured.retrieval,
    });
    return {
      manifest, target, bindings: captured.bindings, suppressed: captured.suppressed,
      delivery: describeBatch(manifest, snapshot.records.captured.length + snapshot.records.held.length),
      sequence: 0,
    };
  });
}

// Explicit options prevent URL ssl parameters overriding verified TLS. This is
// application access, never the dedicated private queue login.
export async function withFixerrorsApplicationDatabase<T>(
  operation: (client: PgClientLike, target: string) => Promise<T>,
): Promise<T> {
  const raw = process.env.POSTGRES_URL_NON_POOLING;
  if (!raw) throw new Error('Fixerrors application database is not configured');
  const url = new URL(raw);
  const user = decodeURIComponent(url.username);
  const production = isFixerrorsProductionEnabled();
  const validHost = url.hostname === `db.${projectRef}.supabase.co` && user === 'postgres' ||
    /^aws-[0-9]+-eu-west-2\.pooler\.supabase\.com$/u.test(url.hostname) && user === `postgres.${projectRef}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/postgres' ||
      (url.port && url.port !== '5432') || url.hash || !url.password ||
      (production ? !validHost : !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Fixerrors application database target rejected');
  }
  const client = new Client({
    host: url.hostname, user, password: decodeURIComponent(url.password), database: 'postgres', port: 5432,
    ssl: production ? { ...getFixerrorsProductionDatabaseSsl(), servername: url.hostname } : false,
    connectionTimeoutMillis: 10_000, query_timeout: 35_000, application_name: 'squires-fixerrors-batch',
  });
  try {
    await client.connect();
    return await operation(client, createDatabaseTargetFingerprint(raw));
  } finally {
    await client.end();
  }
}
