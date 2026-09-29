import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import pg from 'pg';
import { parseDecision, readDecisionFile, type FixerrorsDecision } from './fixerrors-decision';
import { renderFixerrorsRunSummary } from './fixerrors-summary';
import {
  ERROR_SNAPSHOT_PATH,
  acquireErrorSnapshotArtifactLock,
  bindErrorSnapshotDispositionArtifacts,
  bindSnapshotDisposition,
  createDatabaseTargetFingerprint,
  executeVerifiedSnapshotCleanup,
  fetchOutstandingErrorLogSummaries,
  readAndVerifyErrorSnapshot,
  writeAndVerifyTextArtifactAtomic,
  type ErrorLogLiveEvidence,
  type ErrorSnapshotDisposition,
  type ErrorSnapshotExport,
  type PgClientLike,
} from './fixerrors-safety';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const SUMMARY_PATH = resolve(process.cwd(), 'docs_private', 'error-run-summary.txt');
const LIVE_EVIDENCE_PATH = resolve(process.cwd(), 'docs_private', 'error-live-evidence.json');

export function buildSnapshotDisposition(input: {
  snapshot: ErrorSnapshotExport;
  decision: FixerrorsDecision;
  liveEvidenceByCluster?: Record<string, ErrorLogLiveEvidence | null>;
}): ErrorSnapshotDisposition {
  const coverage = input.snapshot.coverage;
  if (!coverage) {
    throw new Error('Snapshot coverage is missing; finalization blocked');
  }
  const rows: ErrorSnapshotDisposition['rows'] = [];
  const seen = new Set<string>();
  for (const cluster of input.decision.clusters) {
    const binding = coverage.clusters.find((entry) => entry.id === cluster.id);
    if (!binding) throw new Error(`Snapshot coverage is missing ${cluster.id}`);
    const liveEvidence = input.liveEvidenceByCluster?.[cluster.id] ?? null;
    if (cluster.disposition === 'fixed_live' && !liveEvidence) {
      throw new Error(`${cluster.id} is fixed_live without structured live evidence`);
    }
    for (const id of binding.errorLogIds) {
      if (seen.has(id)) throw new Error(`Snapshot row ${id} is bound more than once`);
      seen.add(id);
      rows.push({
        id,
        clusterId: cluster.id,
        action: cluster.disposition,
        incidentId: cluster.id,
        summary: cluster.rationale,
        nextStep: cluster.nextStep,
        localCommit: null,
        liveEvidence: cluster.disposition === 'fixed_live' ? liveEvidence : null,
      });
    }
  }
  for (const id of coverage.suppressedIds) {
    if (seen.has(id)) throw new Error(`Suppressed row ${id} is already bound`);
    seen.add(id);
    rows.push({
      id,
      clusterId: 'cluster-suppressed',
      action: 'no_fix_required',
      incidentId: 'suppressed-telemetry',
      summary: 'Localhost or admin telemetry is excluded from product fixes',
      nextStep: null,
      localCommit: null,
      liveEvidence: null,
    });
  }
  if (seen.size !== input.snapshot.exactIds.length || input.snapshot.exactIds.some((id) => !seen.has(id))) {
    throw new Error('Disposition does not partition the exact snapshot IDs');
  }
  return {
    decisionChecksum: createHash('sha256').update(JSON.stringify(input.decision)).digest('hex'),
    rows,
  };
}

function requireConnectionString(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING is required for fixerrors finalization');
  }
  return connectionString;
}

async function main(): Promise<void> {
  const snapshot = readAndVerifyErrorSnapshot(ERROR_SNAPSHOT_PATH);
  const decision = parseDecision(readDecisionFile('docs_private/error-analysis-decision.json'));
  if (decision.snapshotId !== snapshot.snapshotId) {
    throw new Error('Decision snapshot does not match the captured snapshot');
  }
  let liveEvidenceByCluster: Record<string, ErrorLogLiveEvidence | null> = {};
  try {
    liveEvidenceByCluster = JSON.parse(readFileSync(LIVE_EVIDENCE_PATH, 'utf8')) as Record<
      string,
      ErrorLogLiveEvidence
    >;
  } catch {
    liveEvidenceByCluster = {};
  }
  const disposition = buildSnapshotDisposition({ snapshot, decision, liveEvidenceByCluster });
  const candidate = bindSnapshotDisposition(snapshot, disposition);
  const releaseLock = acquireErrorSnapshotArtifactLock(candidate.snapshotId);
  let bound: ErrorSnapshotExport;
  try {
    bound = bindErrorSnapshotDispositionArtifacts({ snapshot: candidate });
    const connectionString = requireConnectionString();
    const url = new URL(connectionString);
    const client = new pg.Client({
      host: url.hostname,
      port: Number(url.port) || 5432,
      database: url.pathname.replace(/^\/+/u, '') || 'postgres',
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      await executeVerifiedSnapshotCleanup({
        client: client as unknown as PgClientLike,
        confirmation: {
          snapshotId: bound.snapshotId,
          checksum: bound.checksum,
          rowCount: bound.rowCount,
          databaseTargetFingerprint: bound.databaseTargetFingerprint,
          expiresAt: bound.expiresAt,
          safetyContract: bound.safetyContract,
          manifestChecksum: bound.manifestChecksum,
        },
        databaseTargetFingerprint: createDatabaseTargetFingerprint(connectionString),
        lockAlreadyHeld: true,
      });
      const outstanding = await fetchOutstandingErrorLogSummaries(client as unknown as PgClientLike);
      const found = decision.clusters.map((cluster) => ({
        id: cluster.id,
        title: cluster.rationale,
        count: disposition.rows.filter((row) => row.clusterId === cluster.id).length,
        nextStep: null,
      }));
      const summary = renderFixerrorsRunSummary({
        found,
        fixedLive: decision.clusters
          .filter((cluster) => cluster.disposition === 'fixed_live')
          .map((cluster) => ({
            id: cluster.id,
            title: cluster.rationale,
            count: disposition.rows.filter((row) => row.clusterId === cluster.id).length,
            nextStep: null,
          })),
        outstanding: [
          ...decision.clusters
            .filter((cluster) => cluster.disposition === 'outstanding')
            .map((cluster) => ({
              id: cluster.id,
              title: cluster.rationale,
              count: disposition.rows.filter((row) => row.clusterId === cluster.id).length,
              nextStep: cluster.nextStep,
            })),
          ...outstanding
            .filter((row) => !disposition.rows.some((item) => item.id === row.id))
            .map((row) => ({
              id: row.id,
              title: row.summary,
              count: 1,
              nextStep: row.nextStep,
            })),
        ],
      });
      writeAndVerifyTextArtifactAtomic(SUMMARY_PATH, summary);
      console.log(summary.trimEnd());
    } finally {
      await client.end();
    }
  } finally {
    releaseLock();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
