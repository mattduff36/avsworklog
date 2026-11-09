import { fingerprintIncident } from './fixerrors-knowledge';
import { type AutoRetrieval, type AutoRunResult } from './fixerrors-auto';
import {
  makeLifecyclePlan, matchNewEvidence, readLifecycle, reviewLifecycleRow,
  type LifecyclePlan, type LifecycleRecord, type LifecycleReview,
} from './fixerrors-lifecycle';
import { renderFixerrorsRunSummary } from './fixerrors-summary';

export interface LifecycleBinding {
  clusterId: string;
  records: LifecycleRecord[];
  observedAt: string;
}
export function buildAutomaticLifecyclePlan(input: {
  result: AutoRunResult;
  retrieval: AutoRetrieval;
  bindings: LifecycleBinding[];
  suppressed: LifecycleRecord[];
  target: string;
  now?: Date;
}): LifecyclePlan | null {
  const now = input.now ?? new Date();
  const reviewedAt = now.toISOString();
  const newEvidence = input.bindings.flatMap(binding => {
    const cluster = input.retrieval.clusters.find(entry => entry.id === binding.clusterId);
    return cluster && !cluster.held ? [{ query: cluster.query, observedAt: binding.observedAt }] : [];
  });
  const rows: LifecyclePlan['rows'] = [];
  for (const binding of input.bindings) {
    const cluster = input.retrieval.clusters.find(entry => entry.id === binding.clusterId);
    const outcome = input.result.clusters.find(entry => entry.id === binding.clusterId);
    const decision = input.result.decisions.find(entry => entry.id === binding.clusterId);
    if (!cluster || !outcome) throw new Error('Lifecycle review does not cover every captured group');
    let proposedState: LifecycleReview['state'] = decision?.action === 'fix' ? 'actionable' : 'awaiting-evidence';
    if (outcome.status === 'verified-local') proposedState = 'awaiting-deployment';
    if (outcome.status === 'report-only') proposedState = 'resolved-no-fix';
    const matchingAt = cluster.held
      ? cluster.matchingAllowed === false ? undefined : matchNewEvidence(cluster.query, newEvidence)
      : binding.observedAt;
    for (const record of binding.records) {
      // A held row's original fingerprint remains authoritative even if source extraction changes later.
      const prior = readLifecycle(record);
      const fingerprint = prior?.fingerprint ?? fingerprintIncident(cluster.query);
      const state = prior?.state === 'awaiting-deployment' || record.triage_local_commit ? 'awaiting-deployment' :
        prior?.state === 'actionable' && proposedState !== 'awaiting-deployment' ? 'actionable' : proposedState;
      const nextStep = state === 'awaiting-deployment'
        ? 'Deploy the verified local candidate through the separately approved release flow, then verify the original failure live.'
        : decision?.nextStep ?? (typeof record.triage_next_step === 'string' ? record.triage_next_step : null) ??
          'Inspect the scoped investigation receipt and add the named targeted diagnostic evidence.';
      rows.push(reviewLifecycleRow(record, {
        fingerprint, state, nextStep,
        matchingNewEvidenceAt: prior && prior.fingerprint !== fingerprintIncident(cluster.query) ? undefined : matchingAt,
        closureReason: state === 'resolved-no-fix'
          ? ['external-network', 'user-input'].includes(cluster.query.rootCauseFamily) ? 'expected_behavior' : 'insufficient_evidence'
          : null,
        attempt: {
          id: `${input.result.runId}-${binding.clusterId}`, reviewedAt,
          diagnosis: decision?.rationale ?? outcome.reason, attempt: outcome.attempt,
          tests: outcome.tests, result: outcome.status === 'verified-local' ? 'verified-local' :
            outcome.status === 'report-only' ? 'no-fix' : outcome.status === 'failed' ? 'failed' : 'blocked',
          evidence: outcome.evidence,
          ...(outcome.status === 'verified-local' ? { verifiedCandidate: input.result.candidate } : {}),
        },
      }));
    }
  }
  for (const record of input.suppressed) rows.push(reviewLifecycleRow(record, {
    fingerprint: fingerprintIncident({
      errorContextId: null, httpStatus: null, route: 'NoPage', component: 'suppressed-telemetry',
      sourceFile: null, normalizedMessage: 'Localhost or admin telemetry', rootCauseFamily: 'expected-telemetry',
    }),
    state: 'resolved-no-fix', nextStep: null, closureReason: 'expected_behavior',
    attempt: {
      id: `${input.result.runId}-suppressed`, reviewedAt, diagnosis: 'Localhost or admin telemetry is excluded from product repairs',
      attempt: 'Reviewed exact snapshot suppression coverage', tests: [], result: 'no-fix',
      evidence: ['Verified snapshot suppressed row coverage'],
    },
  }));
  return rows.length ? makeLifecyclePlan(input.target, rows, now) : null;
}
export function renderAutomaticLifecycleSummary(input: {
  records: LifecycleRecord[];
  plan: LifecyclePlan | null;
  transitionApplied: boolean;
  blocker?: string;
}): string {
  const planRows = input.plan?.rows ?? [];
  const summaryRows = input.records.map(record => {
    const proposed = planRows.find(row => row.id === record.id);
    const metadata = input.transitionApplied && proposed ? proposed.metadata : readLifecycle(record);
    const closing = metadata?.state === 'resolved-no-fix' || metadata?.state === 'fixed-live';
    const reviewed = proposed?.metadata.history.at(-1);
    return {
      id: record.id,
      title: `${metadata?.state ?? 'untriaged'}; oldest occurrence ${String(record.created_at)}; ` +
        (metadata ? `last matching evidence ${metadata.lastMatchingEvidenceAt}; ` : '') +
        (input.blocker ? `transition blocked: ${input.blocker}; ` : '') +
        (metadata?.closureReason ?? reviewed?.diagnosis ?? String(record.triage_summary ?? 'Review captured diagnostics')),
      count: 1,
      nextStep: closing ? null : input.blocker
        ? /trigger\/schema/u.test(input.blocker)
          ? 'Review the error_logs trigger/schema side effects and authorize a bounded compatible transition; do not bypass the guard.'
          : 'Inspect the exact-row lifecycle failure receipt and retry the identical saved plan only after resolving its reported blocker.'
        : proposed?.nextStep ?? String(record.triage_next_step ?? 'Investigate the captured diagnostics.'),
      state: metadata?.state,
    };
  });
  return renderFixerrorsRunSummary({
    found: summaryRows,
    fixedLive: summaryRows.filter(row => row.state === 'fixed-live'),
    closedWithoutFix: summaryRows.filter(row => row.state === 'resolved-no-fix'),
    outstanding: summaryRows.filter(row => row.state !== 'fixed-live' && row.state !== 'resolved-no-fix'),
  }, false);
}
