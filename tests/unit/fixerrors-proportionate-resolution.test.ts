import { describe, expect, it, vi } from 'vitest';
import { parseDecision, type DecisionCluster } from '@/scripts/fixerrors-decision';
import { buildAutomaticLifecyclePlan } from '@/scripts/fixerrors-lifecycle-run';
import { reviewLifecycleRow, type LifecycleRecord } from '@/scripts/fixerrors-lifecycle';
import { verifyReviewedDeployments } from '@/scripts/fixerrors-deployment-evidence';
import { fingerprintIncident } from '@/scripts/fixerrors-knowledge';
import type { AutoRetrieval, AutoRunResult } from '@/scripts/fixerrors-auto';
import { passedAnalysisTests, type WorkerRequest } from '@/scripts/fixerrors-auto';

const at = '2026-11-18T12:00:00.000Z';
const source = 'lib/utils/example.ts';
const test = 'tests/unit/example.test.ts';
const candidate = { baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) };
const change = 'c'.repeat(40);
const deployment = { deployedCommit: 'd'.repeat(40), deploymentId: 'dpl_Example',
  check: 'Production identity and tested improvement source verified', result: 'passed' as const, verifiedAt: at };
const decision = (): DecisionCluster => ({
  id: 'cluster-1', lane: 'standard', action: 'report-only', disposition: 'no_fix_required', nextStep: null,
  evidencePaths: [source], files: [source], requiredTestIds: [test],
  forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
  rationale: 'Historical request lacked status and operation diagnostics; original cause remains unknown',
  priorIncidentIds: [], evidenceEnrichmentAttempted: true,
  resolution: { reason: 'diagnostics_improved', summary: 'Added and tested status and operation diagnostics; original cause is unknown', changeCommit: change },
});
function fixture() {
  const query = { errorContextId: 'example-load', httpStatus: null, route: '/example', component: 'Example',
    sourceFile: source, normalizedMessage: 'Request failed', rootCauseFamily: 'unknown' };
  const retrieval: AutoRetrieval = { schemaVersion: 1, snapshotId: '00000000-0000-4000-8000-000000000001',
    ...candidate, archiveMeansResolved: false, clusters: [{
      id: 'cluster-1', rootCauseFamily: 'unknown', advisoryLane: 'standard', advisoryAction: 'manual-investigation',
      query, sourceFiles: [source], patterns: [], priorResolutions: [],
      diagnostics: { classes: ['unknown'], operation: 'unknown', noncriticalHandled: false, occurrences: 1, frames: [] },
    }] };
  const record: LifecycleRecord = { id: '00000000-0000-4000-8000-000000000002', status: 'active',
    triage_state: 'outstanding', triage_local_commit: null, created_at: at, timestamp: at,
    additional_data: { originalDiagnostic: 'preserved' } };
  const result: AutoRunResult = { runId: 'chat-resolution-example', candidate, decisions: [decision()], clusters: [{
    id: 'cluster-1', status: 'report-only', reason: 'Diagnostic improvement tested and deployed',
    attempt: 'Reviewed source, focused checks and original incident evidence', tests: [test], evidence: [source],
  }] };
  return { retrieval, result, bindings: [{ clusterId: 'cluster-1', records: [record], observedAt: at }],
    suppressed: [], target: 'e'.repeat(64), now: new Date(at) };
}

describe('proportionate resolution contract', () => {
  const parse = (cluster: unknown) => parseDecision({ schemaVersion: 1, snapshotId: 'snapshot', analyst: 'review',
    ...candidate, clusters: [cluster] });
  it('preserves old decisions and accepts only the strict optional resolution object', () => {
    const old = decision(); delete old.resolution;
    expect(parse(old).clusters[0]).toEqual(old);
    expect(parse(decision()).clusters[0].resolution?.reason).toBe('diagnostics_improved');
    for (const value of [{ ...decision(), extra: true }, { ...decision(), resolution: { reason: 'ignored', summary: 'Unknown result' } },
      { ...decision(), resolution: { ...decision().resolution, deployed: true } },
      { ...decision(), resolution: { ...decision().resolution, summary: 'Contact private@example.invalid' } },
      { ...decision(), resolution: { reason: 'diagnostics_improved', summary: 'Useful improvement but no commit evidence' } }]) {
      expect(() => parse(value)).toThrow();
    }
  });
  it('keeps a tested local diagnostic change outstanding until independent deployment proof', () => {
    const input = fixture();
    input.result.decisions[0] = { ...decision(), action: 'fix', disposition: 'outstanding', nextStep: 'Deploy the verified improvement' };
    input.result.clusters[0].status = 'verified-local';
    const row = buildAutomaticLifecyclePlan(input)!.rows[0];
    expect(row.metadata).toMatchObject({ state: 'awaiting-deployment', resolution: { reason: 'diagnostics_improved' } });
    expect(row.metadata.deployment).toBeUndefined();
    expect(row.nextStep).toContain('reproducing the original');
  });
  it('resolves a deployed diagnostic improvement without claiming the original defect fixed', () => {
    const input = fixture();
    const local = reviewLifecycleRow(input.bindings[0].records[0], {
      fingerprint: fingerprintIncident(input.retrieval.clusters[0].query), state: 'awaiting-deployment', nextStep: 'Deploy',
      attempt: { id: 'previous-local', reviewedAt: at, diagnosis: 'Useful missing diagnostics identified',
        attempt: 'Added diagnostics with relevant regression checks', tests: [test], result: 'verified-local', evidence: [source], verifiedCandidate: candidate },
    });
    input.bindings[0].records[0].additional_data = { originalDiagnostic: 'preserved', fixerrorsLifecycle: local.metadata };
    input.bindings[0].records[0].triage_local_commit = change;
    const row = buildAutomaticLifecyclePlan({ ...input, deployments: { 'cluster-1': deployment } })!.rows[0];
    expect(row.metadata).toMatchObject({ state: 'resolved-no-fix', closureReason: 'diagnostics_improved',
      deployment, previousLocalCommit: change });
    expect(row.metadata.history).toHaveLength(2);
    expect(row.liveEvidence).toBeNull();
    expect(row.nextStep).toBeNull();
    expect(input.bindings[0].records[0].additional_data).toHaveProperty('originalDiagnostic', 'preserved');
  });
  it.each(['missing-deployment', 'missing-checks', 'serious', 'critical', 'continuing', 'recurrence'])(
    'retains the incident when %s prevents closure', failure => {
      const input = fixture();
      const captured = input.retrieval.clusters[0];
      if (failure === 'missing-checks') input.result.clusters[0].tests = [];
      if (failure === 'serious') captured.diagnostics!.classes = ['financial-loss'];
      if (failure === 'critical') input.result.decisions[0].lane = 'critical';
      if (failure === 'continuing') captured.diagnostics!.continuingFailure = true;
      if (failure === 'recurrence') captured.recurrenceAfterResolution = true;
      const row = buildAutomaticLifecyclePlan({ ...input,
        deployments: failure === 'missing-deployment' ? {} : { 'cluster-1': deployment } })!.rows[0];
      expect(row.metadata.state).toBe('actionable');
      expect(row.metadata.closureReason).toBeNull();
      expect(row.nextStep).toBeTruthy();
    },
  );
  it('does not keep addressed historical repetitions open solely because their count is high', () => {
    const input = fixture();
    input.retrieval.clusters[0].diagnostics!.occurrences = 20;
    expect(buildAutomaticLifecyclePlan({ ...input, deployments: { 'cluster-1': deployment } })!.rows[0].metadata.state)
      .toBe('resolved-no-fix');
  });
  it('distinguishes an ordinary permission rejection from serious impact when resolving reviewed client diagnostics', () => {
    const input = fixture();
    input.retrieval.clusters[0].advisoryLane = 'critical';
    input.retrieval.clusters[0].diagnostics!.classes = ['authentication'];
    input.retrieval.clusters[0].query.httpStatus = 403;
    input.result.decisions[0].lane = 'guarded';
    expect(buildAutomaticLifecyclePlan({ ...input, deployments: { 'cluster-1': deployment } })!.rows[0].metadata)
      .toMatchObject({ state: 'resolved-no-fix', closureReason: 'diagnostics_improved' });
  });
  it('can resolve an investigated unreproducible event immediately with its uncertainty retained', () => {
    const input = fixture();
    input.result.decisions[0].resolution = { reason: 'reviewed_unable_to_reproduce',
      summary: 'Reviewed source and relevant regression checks; historical cause remains unknown' };
    expect(buildAutomaticLifecyclePlan(input)!.rows[0].metadata).toMatchObject({
      state: 'resolved-no-fix', closureReason: 'reviewed_unable_to_reproduce',
    });
  });
  it.each([{ impact: 'financial-loss' }, { continuingFailure: true }, { databaseCode: 'XX001' }])(
    'never expires serious or continuing raw evidence through a legacy review: %j', data => {
      const input = fixture();
      const record = input.bindings[0].records[0];
      const review = { fingerprint: fingerprintIncident(input.retrieval.clusters[0].query),
        state: 'awaiting-evidence' as const, nextStep: 'Investigate the evidenced impact',
        attempt: { id: 'first-review', reviewedAt: '2026-09-01T00:00:00.000Z', diagnosis: 'Reviewed original diagnostics',
          attempt: 'Inspected original source evidence', tests: [], result: 'blocked' as const, evidence: [source] } };
      const prior = reviewLifecycleRow(record, review);
      record.additional_data = { ...data, fixerrorsLifecycle: prior.metadata };
      expect(reviewLifecycleRow(record, { ...review, attempt: { ...review.attempt, id: 'later-review', reviewedAt: at } })
        .metadata.state).toBe('actionable');
      expect(() => reviewLifecycleRow(record, { ...review, state: 'resolved-no-fix', closureReason: 'expected_behavior',
        attempt: { ...review.attempt, id: 'legacy-close', reviewedAt: at, result: 'no-fix' } })).toThrow('Serious');
    },
  );
});

describe('independent existing-deployment evidence', () => {
  const identity = async () => ({ commit_sha: deployment.deployedCommit, deployment_id: deployment.deploymentId });
  it('requires deployed ancestry and the actual tested source, not analyst deployment assertions', async () => {
    const git = vi.fn((args: string[]) => args[0] === 'diff-tree' ? source : '');
    const result = await verifyReviewedDeployments(fixture(), { identity, git, now: () => new Date(at) });
    expect(result['cluster-1']).toMatchObject({ deployedCommit: deployment.deployedCommit, result: 'passed' });
    expect(git.mock.calls.map(([args]) => args[0])).toEqual(['merge-base', 'diff', 'diff-tree']);
  });
  it.each(['merge-base', 'diff', 'diff-tree', 'identity', 'tests'])(
    'keeps the incident open when %s cannot verify the improvement', async failure => {
      const input = fixture();
      if (failure === 'tests') input.result.clusters[0].tests = [];
      const result = await verifyReviewedDeployments(input, {
        identity: failure === 'identity' ? async () => { throw new Error('unavailable'); } : identity,
        git: args => { if (args[0] === failure) throw new Error('proof unavailable'); return args[0] === 'diff-tree' ? source : ''; },
      });
      expect(result).toEqual({});
    },
  );
  it('cannot replace an undeployed retained repair with an unrelated deployed ancestor', async () => {
    const input = fixture();
    input.bindings[0].records[0].triage_local_commit = 'f'.repeat(40);
    input.result.decisions[0].resolution!.reason = 'reviewed_unable_to_reproduce';
    const git = vi.fn((args: string[]) => {
      if (args[0] === 'merge-base' && args[2] === 'f'.repeat(40)) throw new Error('Original repair is not deployed');
      return args[0] === 'diff-tree' ? source : '';
    });
    expect(await verifyReviewedDeployments(input, { identity, git })).toEqual({});
    expect(git).toHaveBeenCalledWith(['merge-base', '--is-ancestor', 'f'.repeat(40), deployment.deployedCommit]);
  });
  it('does not silently discard malformed or abbreviated retained repair evidence', async () => {
    const input = fixture();
    input.bindings[0].records[0].triage_local_commit = 'old-local-proof';
    const git = vi.fn(() => source);
    expect(await verifyReviewedDeployments(input, { identity, git })).toEqual({});
    expect(git).not.toHaveBeenCalled();
  });
});

describe('genuine passing analysis assertions', () => {
  const request = { checks: { 'targeted-tests': { argv: ['node', 'check.mjs', 'observe-tests', test, 'tests/unit/other.test.ts'] } } } as unknown as WorkerRequest;
  const marker = (passed = [test]) => 'SQUIRES_OBSERVATION_V1 ' + JSON.stringify({
    selected: [test, 'tests/unit/other.test.ts'], passed,
  });
  const receipt = (stdout: string, truncated = false) => [{ checkId: 'targeted-tests', stdout, truncated }];
  it('carries only passing file assertions, not a successful observation wrapper', () => {
    expect(passedAnalysisTests(request, receipt('Baseline observations: 1 passed, 1 failed.\n' + marker()))).toEqual([test]);
    expect(passedAnalysisTests(request, receipt(marker([])))).toEqual([]);
    expect(passedAnalysisTests(request, receipt('Baseline observations: 1 passed, 0 failed.'))).toEqual([]);
  });
  it('rejects truncated, forged, duplicated, nonfinal and out-of-scope observations', () => {
    for (const output of [receipt(marker(), true), receipt(marker() + '\nmore output'), receipt(marker() + '\n' + marker()),
      receipt(marker(['tests/unit/unapproved.test.ts'])),
      receipt('SQUIRES_OBSERVATION_V1 ' + JSON.stringify({ selected: [test], passed: [test] }))]) {
      expect(passedAnalysisTests(request, output)).toEqual([]);
    }
  });
});
