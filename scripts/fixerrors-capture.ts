import { z } from 'zod';
import { type CandidateFingerprint } from './fixerrors-decision';
import { parseAutomaticFixerrorsRetrieval, type AutoRetrieval } from './fixerrors-auto';
import {
  fingerprintIncident, type KnowledgeStore,
} from './fixerrors-knowledge';
import { readLifecycle, type LifecycleRecord } from './fixerrors-lifecycle';
import { type LifecycleBinding } from './fixerrors-lifecycle-run';
import { createWorkerEvidenceProjector } from './fixerrors-worker-evidence';
import {
  assertLifecycleSnapshotRows, buildRetrievalCluster, clusterErrorPatterns,
  filterErrors, groupIntoPatterns, lifecycleErrorEntry, splitLifecycleClusters,
  type ErrorRootCauseCluster,
} from './fixerrors-retrieval';
import {
  captureProductionErrorSnapshot, type ErrorSnapshotExport, type PgClientLike,
} from './fixerrors-safety';

const PAGE_SIZE = 200;
const eligible = "e.status = 'active' AND (e.triage_state IS NULL OR e.triage_state = 'outstanding')";
const cursorSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime({ precision: 6 }),
});
const recordSchema = z.object({ id: z.string().uuid() }).passthrough();
export interface FixerrorsCapturedRecords {
  captured: LifecycleRecord[];
  held: LifecycleRecord[];
}

async function readBatchRecords(client: PgClientLike): Promise<LifecycleRecord[]> {
  const count = await client.query<{ count: string }>(
    `/* fixerrors:batch-count */ SELECT COUNT(*)::text AS count
     FROM public.error_logs e WHERE ${eligible}`,
  );
  const expected = Number(count.rows[0]?.count);
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Invalid full-batch row count');
  const records: LifecycleRecord[] = [];
  const seen = new Set<string>();
  let cursor: z.infer<typeof cursorSchema> | null = null;
  while (records.length < expected || (expected > 0 && records.length % PAGE_SIZE === 0)) {
    const page = await client.query<{
      id: string; created_at: string; record: LifecycleRecord;
    }>(
      `/* fixerrors:batch-page */
       SELECT e.id::text AS id,
         to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
         to_jsonb(e) AS record
       FROM public.error_logs e WHERE ${eligible}
         AND ($1::timestamptz IS NULL OR (e.created_at, e.id) > ($1::timestamptz, $2::uuid))
       ORDER BY e.created_at ASC, e.id ASC LIMIT $3`,
      [cursor?.created_at ?? null, cursor?.id ?? null, PAGE_SIZE],
    );
    if (!page.rows.length) break;
    if (page.rows.length > PAGE_SIZE) throw new Error('Full-batch pagination coverage mismatch');
    for (const row of page.rows) {
      const next = cursorSchema.parse(row);
      recordSchema.parse(row.record);
      const record = row.record;
      if (record.id !== next.id || seen.has(record.id) ||
          (cursor && (next.created_at < cursor.created_at ||
            (next.created_at === cursor.created_at && next.id <= cursor.id)))) {
        throw new Error('Full-batch cursor did not advance over unique exact rows');
      }
      if (record.status !== 'active' || (record.triage_state !== null && record.triage_state !== 'outstanding')) {
        throw new Error('Full-batch capture returned an ineligible row');
      }
      records.push(record);
      seen.add(record.id);
      cursor = next;
    }
    if (records.length > expected) throw new Error('Full-batch row count exceeded snapshot count');
  }
  if (records.length !== expected) throw new Error('Full-batch pagination coverage mismatch');
  return records;
}

// Exact IDs and lifecycle rows are trusted capture state, never retrieval/model input.
export async function fetchFixerrorsBatchSnapshot(
  client: PgClientLike, target: string, now = new Date(),
): Promise<{ snapshot: ErrorSnapshotExport; records: FixerrorsCapturedRecords }> {
  const result = await captureProductionErrorSnapshot(client, target, now, async (transaction, snapshot) => {
    const rows = await readBatchRecords(transaction);
    const captured = rows.filter(record => record.triage_state === null);
    assertLifecycleSnapshotRows(captured, snapshot.errors);
    return { captured, held: rows.filter(record => record.triage_state === 'outstanding') };
  });
  return { snapshot: result.snapshot, records: result.related };
}

export function buildFixerrorsBatchRetrieval(input: {
  snapshot: ErrorSnapshotExport;
  records: FixerrorsCapturedRecords;
  candidate: CandidateFingerprint;
  knowledge: KnowledgeStore;
  repoRoot?: string;
  clusters?: ErrorRootCauseCluster[];
}): { retrieval: AutoRetrieval; bindings: LifecycleBinding[]; suppressed: LifecycleRecord[] } {
  const { snapshot, records, candidate, knowledge, repoRoot } = input;
  const project = createWorkerEvidenceProjector(repoRoot);
  const projectCluster = (cluster: ErrorRootCauseCluster) => project(
    buildRetrievalCluster(cluster, knowledge), knowledge,
    cluster.patterns.flatMap(pattern => pattern.occurrences),
  );
  assertLifecycleSnapshotRows(records.captured, snapshot.errors);
  const exact = new Map([...records.captured, ...records.held].map(record => [record.id, record]));
  if (exact.size !== records.captured.length + records.held.length) throw new Error('Duplicate private batch binding');
  const errors = filterErrors(snapshot.errors).sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const clusters = input.clusters ??
    splitLifecycleClusters(clusterErrorPatterns(groupIntoPatterns(errors, repoRoot)), repoRoot);
  const allowed = new Set(errors.map(error => error.id));
  const covered = new Set<string>();
  const bindings: LifecycleBinding[] = clusters.map(cluster => {
    const occurrences = cluster.patterns.flatMap(pattern => pattern.occurrences);
    const bound = occurrences.map(error => {
      const record = exact.get(error.id);
      if (!record || !allowed.has(error.id) || covered.has(error.id)) throw new Error('New batch group coverage mismatch');
      covered.add(error.id);
      return record;
    });
    if (!bound.length) throw new Error('Empty new batch group');
    return {
      clusterId: cluster.id, records: bound,
      observedAt: new Date(occurrences.reduce((latest, error) =>
        Math.max(latest, Date.parse(error.timestamp)), -Infinity)).toISOString(),
    };
  });
  if (covered.size !== allowed.size) throw new Error('New batch groups omit eligible snapshot rows');
  const retrieval: AutoRetrieval = {
    schemaVersion: 1, snapshotId: snapshot.snapshotId, ...candidate, archiveMeansResolved: false,
    clusters: clusters.map(projectCluster),
  };
  let nextCluster = clusters.reduce((max, cluster) => Math.max(max, Number(cluster.id.slice('cluster-'.length))), 0) + 1;
  const held = [...records.held].sort((left, right) => {
    const leftAt = String(left.created_at);
    const rightAt = String(right.created_at);
    const difference = Date.parse(leftAt) - Date.parse(rightAt);
    if (!Number.isFinite(difference)) throw new Error('Invalid held occurrence timestamp');
    const micros = (value: string) => (value.match(/\.(\d+)/u)?.[1] ?? '').padEnd(6, '0');
    return difference || micros(leftAt).localeCompare(micros(rightAt)) || left.id.localeCompare(right.id);
  });
  for (const record of held) {
    if (record.status !== 'active' || record.triage_state !== 'outstanding') throw new Error('Invalid held batch binding');
    const historical = clusterErrorPatterns(groupIntoPatterns([lifecycleErrorEntry(record)], repoRoot))[0];
    if (!historical) throw new Error('Held error has no diagnostic pattern');
    const entry = projectCluster({ ...historical, id: `cluster-${nextCluster++}` });
    const previous = readLifecycle(record);
    entry.held = true;
    entry.existingState = record.triage_local_commit ? 'awaiting-deployment' :
      previous?.state === 'awaiting-deployment' || previous?.state === 'actionable' ? previous.state : 'awaiting-evidence';
    entry.matchingAllowed = entry.matchingAllowed !== false && (!previous || previous.fingerprint === fingerprintIncident(entry.query)) &&
      !JSON.stringify(entry.query).includes('[redacted]');
    retrieval.clusters.push(entry);
    bindings.push({ clusterId: entry.id, records: [record], observedAt: String(record.timestamp) });
  }
  return {
    retrieval: parseAutomaticFixerrorsRetrieval(retrieval), bindings,
    suppressed: records.captured.filter(record => !covered.has(record.id)),
  };
}
