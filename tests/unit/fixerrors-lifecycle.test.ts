import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_GAP_EXPIRY_MS, makeLifecyclePlan, matchNewEvidence, readLifecycle, reviewLifecycleRow,
  type LifecycleAttempt, type LifecycleRecord,
} from '@/scripts/fixerrors-lifecycle';
import { fingerprintIncident, type IncidentQuery } from '@/scripts/fixerrors-knowledge';
import { buildAutomaticLifecyclePlan, renderAutomaticLifecycleSummary } from '@/scripts/fixerrors-lifecycle-run';
import { assertLifecycleSnapshotRows, parseLifecycleReplay, type ErrorLogEntry } from '@/scripts/fixerrors';
import { type AutoRetrieval, type AutoRunResult } from '@/scripts/fixerrors-auto';

const start = '2026-09-01T00:00:00.000Z';
const fingerprint = 'a'.repeat(64);
const attempt = (at = start, id = 'attempt-one'): LifecycleAttempt => ({
  id, reviewedAt: at, diagnosis: 'Current source cannot reproduce the historical failure',
  attempt: 'Reviewed source and focused regression evidence', tests: ['tests/unit/display-label.test.ts: passed'],
  result: 'blocked', evidence: ['Source and targeted sanitized diagnostics reviewed'],
});
function record(): LifecycleRecord {
  return { id: '00000000-0000-4000-8000-000000000001', status: 'active', triage_state: 'outstanding',
    triaged_at: start, created_at: start, triage_local_commit: null, additional_data: { originalDiagnostic: 'retained' } };
}
function held(state: 'awaiting-evidence' | 'actionable' | 'awaiting-deployment' = 'awaiting-evidence'): LifecycleRecord {
  const original = record();
  const first = reviewLifecycleRow(original, {
    fingerprint, state, nextStep: 'Inspect named sanitized diagnostic evidence',
    attempt: { ...attempt(), result: state === 'awaiting-deployment' ? 'verified-local' : 'blocked',
      ...(state === 'awaiting-deployment' ? { verifiedCandidate: { baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) } } : {}) },
  });
  return { ...original, additional_data: { originalDiagnostic: 'retained', fixerrorsLifecycle: first.metadata } };
}
describe('exact-row lifecycle planning and evidence gap expiry', () => {
  it('expires only evidence gaps at exactly 30 days, preserving their full reviewed history', () => {
    const previous = held();
    const before = new Date(Date.parse(start) + EVIDENCE_GAP_EXPIRY_MS - 1).toISOString();
    const at = new Date(Date.parse(start) + EVIDENCE_GAP_EXPIRY_MS).toISOString();
    expect(reviewLifecycleRow(previous, { fingerprint, state: 'awaiting-evidence', nextStep: 'Collect named evidence',
      attempt: attempt(before, 'before-expiry') }).metadata.state).toBe('awaiting-evidence');
    const expired = reviewLifecycleRow(previous, { fingerprint, state: 'awaiting-evidence', nextStep: 'Collect named evidence',
      attempt: attempt(at, 'at-expiry') });
    expect(expired.metadata).toMatchObject({ state: 'resolved-no-fix', closureReason: 'evidence_gap_expired',
      firstReviewedAt: start, lastMatchingEvidenceAt: start });
    expect(expired.metadata.history).toHaveLength(2);
    expect(expired.nextStep).toBeNull();
    expect(previous.additional_data).toMatchObject({ originalDiagnostic: 'retained' });
  });
  it('a repeated investigation never resets the clock; exact matching new evidence does', () => {
    const previous = held();
    const at = '2026-10-01T00:00:00.000Z';
    const extended = reviewLifecycleRow(previous, { fingerprint, state: 'awaiting-evidence', nextStep: 'Inspect new evidence',
      matchingNewEvidenceAt: '2026-09-20T00:00:00.000Z', attempt: attempt(at, 'retry') });
    expect(extended.metadata.state).toBe('awaiting-evidence');
    expect(extended.metadata.lastMatchingEvidenceAt).toBe('2026-09-20T00:00:00.000Z');
    const query: IncidentQuery = { errorContextId: null, httpStatus: null, route: '/dashboard', component: 'Label',
      sourceFile: 'lib/utils/display-label.ts', normalizedMessage: 'Invalid label', rootCauseFamily: 'label formatting' };
    expect(fingerprintIncident(query)).toHaveLength(64);
    expect(matchNewEvidence(query, [{ query: { ...query, route: '/other' }, observedAt: at }])).toBeUndefined();
    expect(matchNewEvidence(query, [{ query, observedAt: at }])).toBe(at);
  });
  it.each(['actionable', 'awaiting-deployment'] as const)('never automatically expires %s', state => {
    const row = reviewLifecycleRow(held(state), { fingerprint, state: 'awaiting-evidence', nextStep: 'Take the current bounded action',
      attempt: attempt('2027-01-01T00:00:00.000Z', 'later') });
    expect(row.metadata.state).toBe(state);
    expect(row.metadata.closureReason).toBeNull();
  });
  it('does not infer a verified fix from age or a local commit and rejects unjustified closure/live claims', () => {
    const previous = { ...held(), triage_local_commit: 'local-proof' };
    expect(reviewLifecycleRow(previous, { fingerprint, state: 'awaiting-evidence', nextStep: 'Review original local verification',
      attempt: attempt('2027-01-01T00:00:00.000Z', 'later') }).metadata.state).toBe('awaiting-evidence');
    expect(() => reviewLifecycleRow(previous, { fingerprint, state: 'resolved-no-fix', nextStep: null,
      closureReason: 'insufficient_evidence', attempt: attempt() })).toThrow('discard');
    expect(() => reviewLifecycleRow(record(), { fingerprint, state: 'fixed-live', nextStep: null, attempt: attempt() })).toThrow();
    expect(() => reviewLifecycleRow(record(), { fingerprint, state: 'awaiting-deployment', nextStep: 'Deploy separately',
      attempt: attempt() })).toThrow('verified local');
  });
  it('requires relevant structured deployed identity and verification, not a generic smoke', () => {
    const live = { deployedCommit: 'd'.repeat(40), deploymentId: 'deployment-example', check: 'Reproduce original label formatter failure',
      result: 'passed' as const, verifiedAt: start };
    const review = { fingerprint, state: 'fixed-live' as const, nextStep: null,
      attempt: { ...attempt(), result: 'verified-live' as const }, liveEvidence: live };
    expect(() => reviewLifecycleRow(held('awaiting-deployment'), review)).toThrow('Relevant live verification');
    expect(reviewLifecycleRow(held('awaiting-deployment'), {
      ...review, attempt: { ...review.attempt, id: 'verified-live', evidence: [live.check] },
    }).metadata.state).toBe('fixed-live');
  });
  it('rejects sensitive evidence and mismatched attempt identity; identical planning retries are idempotent', () => {
    const original = held();
    const reviewed = reviewLifecycleRow(original, { fingerprint, state: 'awaiting-evidence', nextStep: 'Review named diagnostics', attempt: attempt() });
    expect(reviewed.metadata.history).toHaveLength(1);
    expect(() => reviewLifecycleRow(original, { fingerprint, state: 'awaiting-evidence', nextStep: 'Review named diagnostics',
      attempt: { ...attempt(), diagnosis: 'Different evidence' } })).toThrow('identity');
    expect(() => reviewLifecycleRow(record(), { fingerprint, state: 'awaiting-evidence', nextStep: 'Review named diagnostics',
      attempt: { ...attempt(), diagnosis: 'person@example.com failed' } })).toThrow('Sensitive');
    expect(() => readLifecycle({ ...record(), additional_data: { fixerrorsLifecycle: {} } })).toThrow();
    expect(() => reviewLifecycleRow(original, { fingerprint, state: 'awaiting-evidence', nextStep: 'Review named diagnostics',
      attempt: attempt('2026-08-31T00:00:00.000Z', 'earlier') })).toThrow('chronology');
  });
  it('reports exact oldest cases, expiry evidence, real transition blockers and no routine approval invitation', () => {
    const original = held();
    const reviewed = reviewLifecycleRow(original, { fingerprint, state: 'awaiting-evidence', nextStep: 'Collect named evidence',
      attempt: attempt('2026-10-01T00:00:00.000Z', 'expiry') });
    const plan = makeLifecyclePlan('c'.repeat(64), [reviewed], new Date('2026-10-01T00:00:00.000Z'));
    const summary = renderAutomaticLifecycleSummary({ records: [original], plan, transitionApplied: true });
    expect(summary).toContain(original.id);
    expect(summary).toContain(`oldest occurrence ${start}`);
    expect(summary).toContain(`last matching evidence ${start}`);
    expect(summary).toContain('Errors closed without a fix');
    expect(summary).toContain('evidence_gap_expired');
    expect(summary).toContain('Outstanding work remains: NO');
    const blocked = renderAutomaticLifecycleSummary({ records: [original], plan, transitionApplied: false, blocker: 'Unreviewed account merge triggers' });
    expect(blocked).toContain('Outstanding work remains: YES');
    expect(blocked).toContain('Unreviewed account merge triggers');
    expect(blocked).not.toContain('Errors closed without a fix');
    expect(blocked).not.toContain('Say "fix"');
  });
});

describe('capture, orchestration and recovery boundary', () => {
  const candidate = { baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) };
  function automatic() {
    const query = { errorContextId: null, httpStatus: null, route: '/dashboard', component: 'Label',
      sourceFile: 'lib/utils/display-label.ts', normalizedMessage: 'Invalid label', rootCauseFamily: 'label formatting' };
    const retrieval: AutoRetrieval = {
      schemaVersion: 1, snapshotId: '00000000-0000-4000-8000-000000000003', ...candidate, archiveMeansResolved: false,
      clusters: [{
        id: 'cluster-1', rootCauseFamily: query.rootCauseFamily, advisoryLane: 'fast', advisoryAction: 'fix',
        query, patterns: [], sourceFiles: [query.sourceFile], priorResolutions: [],
      }],
    };
    const result: AutoRunResult = { runId: 'fixerrors-example', candidate, decisions: [], clusters: [{
      id: 'cluster-1', status: 'verified-local', reason: 'Guard label formatting',
      attempt: 'Bounded local repair and candidate-bound checks', tests: ['tests/unit/display-label.test.ts'],
      evidence: ['Candidate-bound MPDEE Worker check receipts'],
    }] };
    return { retrieval, result };
  }
  it('binds verified candidates to every exact row, includes suppressed coverage, and preserves deployment holds', () => {
    const { retrieval, result } = automatic();
    const plan = buildAutomaticLifecyclePlan({
      retrieval, result, target: 'c'.repeat(64), now: new Date(start),
      bindings: [{ clusterId: 'cluster-1', records: [record()], observedAt: start }],
      suppressed: [{ ...record(), id: '00000000-0000-4000-8000-000000000002' }],
    })!;
    expect(plan.rows[0].metadata).toMatchObject({ state: 'awaiting-deployment', history: [
      expect.objectContaining({ verifiedCandidate: candidate, tests: ['tests/unit/display-label.test.ts'] }),
    ] });
    expect(plan.rows[1].metadata).toMatchObject({ state: 'resolved-no-fix', closureReason: 'expected_behavior' });
    result.clusters[0].status = 'report-only';
    const existing = held('awaiting-deployment');
    const retained = buildAutomaticLifecyclePlan({
      retrieval, result, target: 'c'.repeat(64), now: new Date('2027-01-01T00:00:00.000Z'),
      bindings: [{ clusterId: 'cluster-1', records: [{ ...existing, additional_data: {
        fixerrorsLifecycle: { ...readLifecycle(existing)!, fingerprint: fingerprintIncident(retrieval.clusters[0].query) },
      } }], observedAt: start }], suppressed: [],
    })!;
    expect(retained.rows[0].metadata.state).toBe('awaiting-deployment');
    expect(retained.rows[0].nextStep).toContain('separate exact-candidate approval');
    expect(retained.rows[0].nextStep).toContain('missing or stale');
  });
  it('keeps independently blocked groups in review history and rejects incomplete coverage', () => {
    const { retrieval, result } = automatic();
    result.clusters[0].status = 'held';
    const input = {
      retrieval, result, target: 'c'.repeat(64), now: new Date(start),
      bindings: [{ clusterId: 'cluster-1', records: [record()], observedAt: start }], suppressed: [],
    };
    expect(buildAutomaticLifecyclePlan(input)?.rows[0].metadata).toMatchObject({
      state: 'awaiting-evidence', history: [expect.objectContaining({ result: 'blocked' })],
    });
    result.clusters = [];
    expect(() => buildAutomaticLifecyclePlan(input)).toThrow('cover every captured group');
  });
  it('compares complete capture diagnostics, including timestamp microseconds, before workers run', () => {
    const error: ErrorLogEntry = {
      id: record().id, created_at: start, timestamp: '2026-09-01T00:00:00.123456Z', error_message: 'Invalid label',
      error_stack: null, error_type: 'Error', user_id: null, user_email: null, page_url: '', user_agent: '',
      component_name: 'Label', additional_data: null,
    };
    const row: LifecycleRecord = { ...error, status: 'active', triage_state: null,
      timestamp: '2026-09-01T01:00:00.123456+01:00' };
    expect(() => assertLifecycleSnapshotRows([row], [error])).not.toThrow();
    expect(() => assertLifecycleSnapshotRows([{ ...row, timestamp: '2026-09-01T00:00:00.123457Z' }], [error])).toThrow('no longer match');
    expect(() => assertLifecycleSnapshotRows([{ ...row, error_message: 'Changed' }], [error])).toThrow('no longer match');
    expect(() => assertLifecycleSnapshotRows([], [error])).toThrow('exact row set');
  });
  it('requires exact hash and target confirmation for replay and rejects mixed/duplicate arguments', () => {
    const hash = 'a'.repeat(64), target = 'b'.repeat(64);
    expect(parseLifecycleReplay([])).toBeNull();
    expect(parseLifecycleReplay([`--resume-lifecycle=${hash}`, `--confirm-target=${target}`])).toEqual({ planHash: hash, target });
    for (const args of [[`--resume-lifecycle=${hash}`], ['--resume-lifecycle=../other', `--confirm-target=${target}`],
      [`--resume-lifecycle=${hash}`, `--confirm-target=${target}`, '--capture-only'],
      [`--resume-lifecycle=${hash}`, `--resume-lifecycle=${hash}`]]) {
      expect(() => parseLifecycleReplay(args)).toThrow('exact saved plan hash');
    }
  });
});
