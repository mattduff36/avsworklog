import { UNEXPECTED_ERROR_LOG_TRIGGERS } from './fixerrors-trigger-contract';
import { createHash } from 'crypto';
import { z } from 'zod';
import { rejectSensitiveText, type IncidentQuery, fingerprintIncident } from './fixerrors-knowledge';
import { writeAndVerifyTextArtifactAtomic, type PgClientLike } from './fixerrors-safety';
import { TRUSTED_OPERATIONAL_ACTIONS, classifyOperationalAction } from './automation/trusted-operational-actions';

export const LIFECYCLE_CONTRACT = 'fixerrors-lifecycle-exact-id-v1';
export const EVIDENCE_GAP_EXPIRY_MS = 30 * 86400000;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().datetime();
const text = z.string().trim().min(1).max(2000).superRefine((value, context) => {
  try { rejectSensitiveText(value, 'lifecycle evidence'); }
  catch { context.addIssue({ code: 'custom', message: 'Sensitive lifecycle evidence rejected' }); }
});
const attemptSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,140}$/u),
  reviewedAt: timestamp,
  diagnosis: text,
  attempt: text,
  tests: z.array(text),
  result: z.enum(['blocked', 'failed', 'verified-local', 'no-fix', 'verified-live']),
  evidence: z.array(text).min(1),
  verifiedCandidate: z.object({
    baseHead: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
    treeFingerprint: digest,
  }).strict().optional(),
}).strict();
const liveSchema = z.object({
  deployedCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
  deploymentId: text,
  check: text,
  result: z.literal('passed'),
  verifiedAt: timestamp,
}).strict();
const lifecycleSchema = z.object({
  version: z.literal(1),
  state: z.enum(['awaiting-evidence', 'awaiting-deployment', 'actionable', 'resolved-no-fix', 'fixed-live']),
  fingerprint: digest,
  firstReviewedAt: timestamp,
  lastMatchingEvidenceAt: timestamp,
  history: z.array(attemptSchema).min(1),
  closureReason: z.enum(['expected_behavior', 'insufficient_evidence', 'evidence_gap_expired']).nullable(),
}).strict();
export type LifecycleMetadata = z.infer<typeof lifecycleSchema>;
export type LifecycleAttempt = z.infer<typeof attemptSchema>;
export type LifecycleRecord = Record<string, unknown> & { id: string };
export type LifecycleReview = {
  fingerprint: string;
  state: LifecycleMetadata['state'];
  nextStep: string | null;
  attempt: LifecycleAttempt;
  matchingNewEvidenceAt?: string;
  closureReason?: LifecycleMetadata['closureReason'];
  liveEvidence?: z.infer<typeof liveSchema>;
};
const rowSchema = z.object({
  id: z.string().uuid(),
  expectedRecordHash: digest,
  diagnosticHash: digest,
  metadata: lifecycleSchema,
  nextStep: text.nullable(),
  liveEvidence: liveSchema.nullable(),
}).strict();
const planSchema = z.object({
  schemaVersion: z.literal(1),
  safetyContract: z.literal(LIFECYCLE_CONTRACT),
  databaseTargetFingerprint: digest,
  createdAt: timestamp,
  expiresAt: timestamp,
  rows: z.array(rowSchema).min(1),
}).strict();
export type LifecyclePlan = z.infer<typeof planSchema>;
export const parseLifecyclePlan = (value: unknown): LifecyclePlan => planSchema.parse(value);
export const hashLifecycleRecord = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function dataObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid lifecycle additional_data');
  return value as Record<string, unknown>;
}
export function readLifecycle(record: LifecycleRecord): LifecycleMetadata | null {
  const value = dataObject(record.additional_data).fixerrorsLifecycle;
  return value === undefined ? null : lifecycleSchema.parse(value);
}
const mutable = new Set([
  'status', 'archived_at', 'triage_state', 'triaged_at', 'triage_incident_id', 'triage_summary',
  'triage_next_step', 'triage_local_commit', 'triage_live_verified_at', 'triage_live_evidence',
]);
function diagnosticHash(record: LifecycleRecord): string {
  const data = { ...dataObject(record.additional_data) };
  delete data.fixerrorsLifecycle;
  delete data.fixerrorsLifecycleReceipts;
  const entries = Object.entries({ ...record, additional_data: data })
    .filter(([key]) => !mutable.has(key)).sort(([a], [b]) => a.localeCompare(b));
  return hashLifecycleRecord(Object.fromEntries(entries));
}
export function reviewLifecycleRow(record: LifecycleRecord, review: LifecycleReview): z.infer<typeof rowSchema> {
  const attempt = attemptSchema.parse(review.attempt);
  const prior = readLifecycle(record);
  if (prior && prior.fingerprint !== review.fingerprint) throw new Error('Historical incident fingerprint mismatch');
  if (prior && Date.parse(attempt.reviewedAt) < Date.parse(prior.history.at(-1)!.reviewedAt)) {
    throw new Error('Lifecycle review chronology moved backwards');
  }
  const firstReviewedAt = prior?.firstReviewedAt ?? attempt.reviewedAt;
  const observed = review.matchingNewEvidenceAt ?? prior?.lastMatchingEvidenceAt ?? attempt.reviewedAt;
  timestamp.parse(observed);
  if (Date.parse(observed) > Date.parse(attempt.reviewedAt)) throw new Error('Future matching evidence');
  const lastMatchingEvidenceAt = new Date(Math.max(Date.parse(firstReviewedAt), Date.parse(observed),
    Date.parse(prior?.lastMatchingEvidenceAt ?? firstReviewedAt))).toISOString();
  let state = review.state;
  let closureReason = review.closureReason ?? null;
  // Neither a verified candidate nor an evidenced actionable defect is an evidence gap.
  if (prior?.state === 'awaiting-deployment' && state !== 'fixed-live') state = 'awaiting-deployment';
  if (prior?.state === 'actionable' && state === 'awaiting-evidence') state = 'actionable';
  if (state === 'awaiting-evidence' && !record.triage_local_commit &&
      Date.parse(attempt.reviewedAt) - Date.parse(lastMatchingEvidenceAt) >= EVIDENCE_GAP_EXPIRY_MS) {
    state = 'resolved-no-fix';
    closureReason = 'evidence_gap_expired';
  }
  if (state === 'resolved-no-fix' && (!closureReason || record.triage_local_commit ||
      prior?.state === 'actionable' || prior?.state === 'awaiting-deployment')) {
    throw new Error('No-fix closure cannot discard evidenced actionable or local repair evidence');
  }
  if (state === 'awaiting-deployment' && prior?.state !== state && !record.triage_local_commit &&
      (attempt.result !== 'verified-local' || !attempt.verifiedCandidate || !attempt.tests.length)) {
    throw new Error('Awaiting deployment requires verified local repair evidence');
  }
  if (state === 'fixed-live') {
    const live = liveSchema.parse(review.liveEvidence);
    if (attempt.result !== 'verified-live' || Date.parse(live.verifiedAt) > Date.parse(attempt.reviewedAt) ||
        !attempt.evidence.includes(live.check)) throw new Error('Relevant live verification is required');
  } else if (review.liveEvidence) throw new Error('Unexpected live evidence');
  const closing = state === 'resolved-no-fix' || state === 'fixed-live';
  const history = prior?.history ?? [];
  const existing = history.find(entry => entry.id === attempt.id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(attempt)) throw new Error('Attempt identity reused with different evidence');
  return rowSchema.parse({
    id: record.id,
    expectedRecordHash: hashLifecycleRecord(record),
    diagnosticHash: diagnosticHash(record),
    metadata: {
      version: 1, state, fingerprint: review.fingerprint, firstReviewedAt, lastMatchingEvidenceAt,
      history: existing ? history : [...history, attempt], closureReason: state === 'resolved-no-fix' ? closureReason : null,
    },
    nextStep: closing ? null : review.nextStep,
    liveEvidence: state === 'fixed-live' ? review.liveEvidence : null,
  });
}
export function makeLifecyclePlan(target: string, rows: LifecyclePlan['rows'], now = new Date()): LifecyclePlan {
  return planSchema.parse({
    schemaVersion: 1, safetyContract: LIFECYCLE_CONTRACT, databaseTargetFingerprint: target,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 60000).toISOString(), rows,
  });
}
export function matchNewEvidence(query: IncidentQuery, evidence: readonly { query: IncidentQuery; observedAt: string }[]): string | undefined {
  const fingerprint = fingerprintIncident(query);
  return evidence.filter(entry => fingerprintIncident(entry.query) === fingerprint)
    .map(entry => timestamp.parse(entry.observedAt)).sort().at(-1);
}
export async function fetchLifecycleRecords(client: PgClientLike, ids?: string[], allActive = false): Promise<LifecycleRecord[]> {
  const result = await client.query<{ record: LifecycleRecord }>(
    `SELECT to_jsonb(e) AS record FROM public.error_logs e
     WHERE ${ids ? 'id = ANY($1::uuid[])' : allActive ? "status = 'active'" : "status = 'active' AND triage_state = 'outstanding'"}
     ORDER BY created_at, id`, ids ? [ids] : []);
  return result.rows.map(row => row.record);
}

// This is a separate exact-row contract; the v5 snapshot/retention guard is unchanged.
export async function applyLifecyclePlan(client: PgClientLike, input: LifecyclePlan, target: string, options: {
  writer?: (file: string, contents: string) => void | Promise<void>;
  now?: () => Date;
} = {}): Promise<{ updated: number; alreadyApplied: number }> {
  const plan = planSchema.parse(input);
  const now = options.now ?? (() => new Date());
  const writer = options.writer ?? writeAndVerifyTextArtifactAtomic;
  const planHash = hashLifecycleRecord(plan);
  const receiptPath = `docs_private/fixerrors-lifecycle-${planHash}`;
  if (plan.databaseTargetFingerprint !== target || new Set(plan.rows.map(row => row.id)).size !== plan.rows.length) {
    throw new Error('Lifecycle target or exact row coverage mismatch');
  }
  const created = Date.parse(plan.createdAt), expires = Date.parse(plan.expiresAt);
  if (created > now().getTime() || expires <= created || expires - created > 30 * 60000) throw new Error('Invalid lifecycle expiry');
  const registered = TRUSTED_OPERATIONAL_ACTIONS['fixerrors-lifecycle'];
  if (!classifyOperationalAction({
    commandId: registered.commandId, safetyContract: plan.safetyContract, intent: 'execute',
    explicitlyRequested: true, confirmationBoundToSnapshot: true, runtimeSafetyChecksPassed: true,
    requestedMutations: registered.allowedMutations,
  }).trusted) throw new Error('Lifecycle operational trust failed');
  let committed = false;
  let commitAttempted = false;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'");
    await client.query('LOCK TABLE public.error_logs IN SHARE ROW EXCLUSIVE MODE');
    // The released account-merge fence is read-only for triage-only updates.
    // Pin the audited live definitions; new or changed guards fail closed.
    const relation = await client.query<{ relkind: string; rules: boolean; triggers: boolean; cascading: boolean; inherits: boolean }>(`
      SELECT c.relkind,
        EXISTS(SELECT 1 FROM pg_rewrite r WHERE r.ev_class=c.oid) AS rules,
        ${UNEXPECTED_ERROR_LOG_TRIGGERS} AS triggers,
        EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inherits,
        EXISTS(SELECT 1 FROM pg_constraint f WHERE f.confrelid=c.oid AND f.contype='f' AND f.confupdtype NOT IN ('a','r')) AS cascading
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='error_logs'`);
    if (relation.rows.length !== 1 || relation.rows[0].relkind !== 'r' || relation.rows[0].rules ||
        relation.rows[0].triggers || relation.rows[0].cascading || relation.rows[0].inherits) {
      throw new Error('error_logs trigger/schema safety contract changed; lifecycle blocked');
    }
    const locked = await client.query<{ record: LifecycleRecord }>(
      'SELECT to_jsonb(e) AS record FROM public.error_logs e WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [plan.rows.map(row => row.id).sort()]);
    if (locked.rows.length !== plan.rows.length) throw new Error('Lifecycle exact row set missing');
    let updated = 0, alreadyApplied = 0;
    const pending: { record: LifecycleRecord; row: LifecyclePlan['rows'][number] }[] = [];
    for (const { record } of locked.rows) {
      const row = plan.rows.find(entry => entry.id === record.id)!;
      const receipts = dataObject(record.additional_data).fixerrorsLifecycleReceipts;
      if (receipts !== undefined && !Array.isArray(receipts)) throw new Error('Invalid lifecycle receipts');
      const priorReceipt = (receipts as unknown[] | undefined)?.find(value =>
        value && typeof value === 'object' && (value as Record<string, unknown>).planHash === planHash);
      if (priorReceipt) {
        const saved = dataObject(priorReceipt);
        if (saved.beforeHash !== row.expectedRecordHash || saved.afterHash !== lifecycleStateHash(record) ||
            diagnosticHash(record) !== row.diagnosticHash) throw new Error('Lifecycle retry state changed');
        alreadyApplied++;
        continue;
      }
      if (expires <= now().getTime()) throw new Error('Lifecycle plan expired');
      if (record.status !== 'active' || (record.triage_state !== null && record.triage_state !== 'outstanding') ||
          hashLifecycleRecord(record) !== row.expectedRecordHash || diagnosticHash(record) !== row.diagnosticHash) {
        throw new Error('Lifecycle current row state or fingerprint changed');
      }
      if (!row.nextStep && row.metadata.state !== 'resolved-no-fix' && row.metadata.state !== 'fixed-live') {
        throw new Error('Outstanding lifecycle row requires a concrete next step');
      }
      const reviewed = reviewLifecycleRow(record, {
        fingerprint: row.metadata.fingerprint, state: row.metadata.state, nextStep: row.nextStep,
        attempt: row.metadata.history.at(-1)!, matchingNewEvidenceAt: row.metadata.lastMatchingEvidenceAt,
        closureReason: row.metadata.closureReason, liveEvidence: row.liveEvidence ?? undefined,
      });
      if (JSON.stringify(reviewed.metadata) !== JSON.stringify(row.metadata) || reviewed.nextStep !== row.nextStep ||
          Date.parse(row.metadata.history.at(-1)!.reviewedAt) > now().getTime()) {
        throw new Error('Lifecycle reviewed history or transition mismatch');
      }
      pending.push({ record, row });
    }
    if (alreadyApplied && pending.length) throw new Error('Mixed applied and unapplied lifecycle rows');
    await writer(`${receiptPath}.pre.json`, JSON.stringify({ planHash, plan, validatedAt: now().toISOString() }, null, 2));
    for (const { record, row } of pending) {
      const closing = row.metadata.state === 'resolved-no-fix' || row.metadata.state === 'fixed-live';
      const state = row.metadata.state === 'fixed-live' ? 'fixed_live' : closing ? 'no_fix_required' : 'outstanding';
      const data = dataObject(record.additional_data);
      const at = row.metadata.history.at(-1)!.reviewedAt;
      const summary = row.metadata.history.at(-1)!.diagnosis;
      const next = {
        ...record, status: closing ? 'archived' : 'active', archived_at: closing ? at : null,
        triage_state: state, triaged_at: at, triage_incident_id: `fei_${row.metadata.fingerprint.slice(0, 16)}`,
        triage_summary: summary, triage_next_step: row.nextStep,
        triage_local_commit: closing && state === 'no_fix_required' ? null : record.triage_local_commit,
        triage_live_verified_at: row.liveEvidence?.verifiedAt ?? null, triage_live_evidence: row.liveEvidence,
        additional_data: { ...data, fixerrorsLifecycle: row.metadata },
      };
      const receipt = { planHash, beforeHash: row.expectedRecordHash, afterHash: lifecycleStateHash(next) };
      const additional = { ...next.additional_data, fixerrorsLifecycleReceipts: [
        ...(data.fixerrorsLifecycleReceipts as unknown[] | undefined ?? []), receipt,
      ] };
      const result = await client.query<{ record: LifecycleRecord }>(`
        UPDATE public.error_logs e SET status=$2, archived_at=$3::timestamptz, triage_state=$4,
          triaged_at=$5::timestamptz, triage_incident_id=$6, triage_summary=$7, triage_next_step=$8,
          triage_local_commit=$9, triage_live_verified_at=$10::timestamptz,
          triage_live_evidence=$11::jsonb, additional_data=$12::jsonb
        WHERE id=$1::uuid AND status='active' AND (triage_state IS NULL OR triage_state='outstanding')
        RETURNING to_jsonb(e) AS record`,
      [row.id, next.status, next.archived_at, state, at, next.triage_incident_id, summary, row.nextStep,
        next.triage_local_commit ?? null, next.triage_live_verified_at, row.liveEvidence ? JSON.stringify(row.liveEvidence) : null, JSON.stringify(additional)]);
      if (result.rows.length !== 1 || diagnosticHash(result.rows[0].record) !== row.diagnosticHash ||
          lifecycleStateHash(result.rows[0].record) !== receipt.afterHash) throw new Error('Lifecycle update verification failed');
      updated++;
    }
    commitAttempted = true;
    await client.query('COMMIT');
    committed = true;
    const result = { updated, alreadyApplied };
    await writer(`${receiptPath}.post.json`, JSON.stringify({ planHash, ...result, verifiedAt: now().toISOString() }, null, 2));
    return result;
  } catch (error) {
    let cause = error;
    if (!committed) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { cause = new AggregateError([error, rollbackError], 'Lifecycle rollback was not acknowledged'); }
    }
    if (commitAttempted) throw new Error('Lifecycle commit may have completed; retry the identical saved plan to verify receipts', { cause });
    throw cause;
  }
}
function lifecycleStateHash(record: LifecycleRecord): string {
  const data = { ...dataObject(record.additional_data) };
  delete data.fixerrorsLifecycleReceipts;
  // jsonb key order and PostgreSQL timestamp rendering are not JavaScript serialization order.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
    return value;
  };
  const normalized: LifecycleRecord = { ...record, additional_data: data };
  for (const key of ['archived_at', 'triaged_at', 'triage_live_verified_at']) {
    if (typeof normalized[key] === 'string') normalized[key] = new Date(normalized[key]).toISOString();
  }
  return hashLifecycleRecord(canonical(normalized));
}
