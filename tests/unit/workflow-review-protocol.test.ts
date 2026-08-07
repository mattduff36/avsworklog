import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEvidenceManifest } from '@/scripts/automation/workflow-evidence-manifest';
import {
  canResumeFinaliseCheckpointStep,
  createOrLoadFinaliseCheckpoint,
  markFinaliseCheckpointStep,
} from '@/scripts/automation/finalise-checkpoint';
import { buildWorkflowFindings } from '@/scripts/automation/workflow-findings';
import {
  WORKFLOW_ROUTING_REQUIRED_EXIT_CODE,
  applyProtocolTransition,
  readProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  buildFixtureTimesheetsPayInventory,
  validateTimesheetsPayInventoryCompleteness,
} from '@/scripts/automation/workflow-sensitive-inventory';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  saveWorkflowReviewState,
  upsertWorkstreamRecord,
} from '@/scripts/automation/workflow-events';
import { resolveFinaliseWorkstreamMatches } from '@/scripts/automation/workflow-finalise-correlation';
import { buildWorkflowStopEvent } from '@/scripts/automation/workflow-review';
import {
  createDefaultPlanContract,
  renderPlanContractMarker,
} from '@/scripts/automation/workflow-plan-contract';

const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
  const root = path.join(
    tmpdir(),
    `workflow-protocol-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function writePassingManifest(
  repoRoot: string,
  workstreamId: string,
  kind: 'preflight' | 'fix-delta',
  closedBlockerIds?: string[]
): string {
  const built = buildEvidenceManifest({
    repoRoot,
    workstreamId,
    kind,
    baseCommit: 'abc1234deadbeef',
    requiredTestIds: [],
    runChecks: false,
    closedBlockerIds,
    blockerEvidence: closedBlockerIds?.map((blockerId) => ({
      blockerId,
      evidenceLabel: `targeted:${blockerId}`,
      commandName: 'fixture',
    })),
    commandResults: [
      {
        name: 'fixture',
        status: 'passed',
        exitCode: 0,
        durationMs: 1,
        summary: 'ok',
      },
    ],
  });
  expect(built.manifest.status).toBe('passed');
  return built.relativePath;
}

describe('workflow review protocol', () => {
  it('WF-IDENTITY-001 / WF-REVIEW-001 / WF-REVIEW-002 / WF-ROUTE-001 / WF-ROUTE-002: two-pass budget and routing', () => {
    const repoRoot = makeTempRoot('route');
    const workstreamId = 'ws_protocol_route_1';

    const init = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId,
      baseCommit: 'abc1234deadbeef',
    });
    expect(init.ok).toBe(true);
    expect(init.record?.phase).toBe('initialized');

    const manifestPath = writePassingManifest(repoRoot, workstreamId, 'preflight');
    const preflight = applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId,
      manifestPath,
    });
    expect(preflight.ok).toBe(true);
    expect(preflight.record?.phase).toBe('preflight_ready');

    const firstStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'first',
    });
    expect(firstStart.ok).toBe(true);
    expect(firstStart.reviewToken).toBeTruthy();

    const firstFail = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: firstStart.reviewToken!,
      result: 'failed',
      blockerFamilies: ['auth-boundary'],
      blockerIds: ['BLK-1'],
      siblingSurfaces: ['reports-stats'],
    });
    expect(firstFail.ok).toBe(true);
    expect(firstFail.record?.phase).toBe('fix_sweep_required');

    const fixPath = writePassingManifest(repoRoot, workstreamId, 'fix-delta', ['BLK-1']);
    const fix = applyProtocolTransition({
      repoRoot,
      command: 'fix-record',
      workstreamId,
      manifestPath: fixPath,
      closedBlockerIds: ['BLK-1'],
    });
    expect(fix.ok).toBe(true);
    expect(fix.record?.phase).toBe('fix_recorded');

    const closureStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'closure',
    });
    expect(closureStart.ok).toBe(true);

    const secondFail = applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: closureStart.reviewToken!,
      result: 'failed',
      blockerFamilies: ['auth-boundary'],
      blockerIds: ['BLK-2'],
      siblingSurfaces: ['ownership-pivot'],
    });
    expect(secondFail.ok).toBe(false);
    expect(secondFail.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);
    expect(secondFail.record?.phase).toBe('routing_required');

    const thirdStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'closure',
    });
    expect(thirdStart.ok).toBe(false);
    expect(thirdStart.exitCode).toBe(WORKFLOW_ROUTING_REQUIRED_EXIT_CODE);
  });

  it('WF-LINEAGE-001: cosmetic split cannot reset exhausted budget', () => {
    const repoRoot = makeTempRoot('lineage');
    const workstreamId = 'ws_protocol_lineage_1';
    applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId,
      baseCommit: 'abc1234deadbeef',
    });
    const manifestPath = writePassingManifest(repoRoot, workstreamId, 'preflight');
    applyProtocolTransition({
      repoRoot,
      command: 'preflight-record',
      workstreamId,
      manifestPath,
    });
    const firstStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'first',
    });
    applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: firstStart.reviewToken!,
      result: 'failed',
      blockerFamilies: ['auth'],
      blockerIds: ['A'],
      siblingSurfaces: ['B'],
    });
    const fixPath = writePassingManifest(repoRoot, workstreamId, 'fix-delta', ['A']);
    applyProtocolTransition({
      repoRoot,
      command: 'fix-record',
      workstreamId,
      manifestPath: fixPath,
      closedBlockerIds: ['A'],
    });
    const closureStart = applyProtocolTransition({
      repoRoot,
      command: 'review-start',
      workstreamId,
      pass: 'closure',
    });
    applyProtocolTransition({
      repoRoot,
      command: 'review-record',
      workstreamId,
      token: closureStart.reviewToken!,
      result: 'failed',
      blockerFamilies: ['auth'],
      blockerIds: ['C'],
      siblingSurfaces: ['D'],
    });

    const split = applyProtocolTransition({
      repoRoot,
      command: 'split',
      workstreamId,
      newWorkstreamId: 'ws_protocol_lineage_child',
      narrowerPartition: false,
      hasFixDelta: false,
    });
    expect(split.ok).toBe(true);
    const child = readProtocolRecord(repoRoot, 'ws_protocol_lineage_child');
    expect(child?.phase).toBe('routing_required');
    expect((child?.failedPremiumReviewCount ?? 0) >= 2).toBe(true);
  });

  it('WF-PREFLIGHT-001 / WF-MANIFEST-001 / WF-MANIFEST-002: behavioral evidence required', () => {
    const repoRoot = makeTempRoot('manifest');
    mkdirSync(path.join(repoRoot, 'tests', 'unit'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, 'tests', 'unit', 'sample.test.ts'),
      `import { it } from 'vitest';\nit('WF-PREFLIGHT-001 behavioral', () => {});\n`,
      'utf8'
    );

    const unexecuted = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_manifest_1',
      kind: 'preflight',
      baseCommit: 'abc1234',
      requiredTestIds: ['WF-PREFLIGHT-001', 'WF-MISSING-999'],
      runChecks: false,
      commandResults: [
        { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    expect(
      unexecuted.manifest.requiredTests.find((test) => test.id === 'WF-PREFLIGHT-001')?.behavioral
    ).toBe(true);
    expect(
      unexecuted.manifest.requiredTests.find((test) => test.id === 'WF-PREFLIGHT-001')?.executed
    ).toBe(false);
    expect(unexecuted.manifest.requiredTests.find((test) => test.id === 'WF-MISSING-999')?.status).toBe(
      'missing'
    );
    expect(unexecuted.manifest.status).toBe('failed');

    const executed = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_manifest_1',
      kind: 'preflight',
      baseCommit: 'abc1234',
      requiredTestIds: ['WF-PREFLIGHT-001'],
      runChecks: false,
      executedTestIds: ['WF-PREFLIGHT-001'],
      commandResults: [
        { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    expect(executed.manifest.status).toBe('passed');
    expect(executed.manifest.contentHash).toBeTruthy();
    expect(executed.manifest.inputFingerprint).toBeTruthy();
    expect(executed.manifest.baseHeadEvidence.headCommit).toBeTruthy();
  });

  it('WF-PAY-INVENTORY-001 / WF-PAY-LIVE-001: fixture inventory completeness and no mutating SQL marker', () => {
    const inventory = buildFixtureTimesheetsPayInventory();
    const completeness = validateTimesheetsPayInventoryCompleteness(inventory);
    expect(completeness.ok).toBe(true);
    expect(inventory.mutatingSqlDetected).toBe(false);
    expect(inventory.surfaces.some((surface) => surface.kind === 'rls_policy')).toBe(true);
    expect(inventory.surfaces.filter((surface) => surface.kind === 'actor')).toHaveLength(6);
  });

  it('WF-CKPT-001 / WF-CKPT-002 / WF-CKPT-003 / WF-CKPT-004: checkpoint resume rules', () => {
    const repoRoot = makeTempRoot('ckpt');
    writeFileSync(path.join(repoRoot, 'package.json'), '{"name":"tmp"}', 'utf8');
    writeFileSync(path.join(repoRoot, 'package-lock.json'), '{}', 'utf8');
    const artifact = path.join(repoRoot, 'BUILD_ID');
    writeFileSync(artifact, 'build-1', 'utf8');

    createOrLoadFinaliseCheckpoint({
      repoRoot,
      workstreamId: 'ws_ckpt_1',
      checkpointId: 'ckpt_1',
    });
    markFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_ckpt_1',
      checkpointId: 'ckpt_1',
      task: 'build',
      status: 'passed',
      command: 'npm run build',
      exitCode: 0,
      artifactPaths: [artifact],
    });

    const ok = canResumeFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_ckpt_1',
      checkpointId: 'ckpt_1',
      task: 'build',
      requiredArtifactPaths: [artifact],
    });
    expect(ok.resumable).toBe(true);

    markFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_ckpt_1',
      checkpointId: 'ckpt_1',
      task: 'test-run',
      status: 'failed',
      command: 'npm run test:run',
      exitCode: 1,
    });
    const failed = canResumeFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_ckpt_1',
      checkpointId: 'ckpt_1',
      task: 'test-run',
    });
    expect(failed.resumable).toBe(false);

    writeFileSync(path.join(repoRoot, 'package.json'), '{"name":"tmp","changed":true}', 'utf8');
    const changed = canResumeFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_ckpt_1',
      checkpointId: 'ckpt_1',
      task: 'build',
      requiredArtifactPaths: [artifact],
    });
    expect(changed.resumable).toBe(false);
    expect(changed.reason).toContain('fingerprint');
  });

  it('WF-TRANSCRIPT-001 / WF-TELEMETRY-001: null transcript remains unknown and uncorrelated without inferred identity', async () => {
    const repoRoot = makeTempRoot('telemetry');
    const event = await buildWorkflowStopEvent(
      {
        conversation_id: 'conv-1',
        generation_id: 'gen-1',
        status: 'completed',
        loop_count: 0,
        transcript_path: null,
        model: 'cursor-grok',
      },
      { repoRoot }
    );
    expect(event.transcriptStatus).toBe('null');
    expect(event.identityStatus).toBe('missing');
    expect(event.workstreamId).toBeUndefined();
    expect(event.findings.some((finding) => finding.id === 'missing-transcript')).toBe(true);
    expect(event.findings.some((finding) => finding.id === 'missing-workstream-id')).toBe(true);
  });

  it('WF-TELEMETRY-001: explicit finalise context preferred over ancestry', () => {
    const repoRoot = makeTempRoot('corr');
    const paths = getWorkflowPaths(repoRoot);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    let state = createEmptyWorkflowReviewState();
    state = upsertWorkstreamRecord(state, {
      workstreamId: 'ws_explicit_1',
      branchName: 'main',
      headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      taskIds: [],
      eventIds: [],
      status: 'open',
      updatedAt: new Date().toISOString(),
    });
    state = {
      ...state,
      protocolRecords: {
        ws_explicit_1: {
          schemaVersion: '1',
          workstreamId: 'ws_explicit_1',
          identityStatus: 'present',
          inheritedFailedReviewCount: 0,
          branchName: 'main',
          baseCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          phase: 'finalise_ready',
          nextAction: 'run_finalise',
          failedPremiumReviewCount: 0,
          activeReviewToken: null,
          activeReviewPass: null,
          reviewAttempts: [],
          blockerFamilies: [],
          openBlockerIds: [],
          evidenceManifestPath: null,
          fixDeltaManifestPath: null,
          activeCheckpointId: 'ckpt_explicit',
          planPath: null,
          updatedAt: new Date().toISOString(),
        },
      },
      activeFinaliseContext: {
        workstreamId: 'ws_explicit_1',
        checkpointId: 'ckpt_explicit',
        activatedAt: new Date().toISOString(),
      },
    };
    saveWorkflowReviewState(paths.statePath, state);

    const matched = resolveFinaliseWorkstreamMatches({
      state,
      repoRoot,
      branchName: 'main',
      headCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(matched.correlation.matchedBy).toBe('explicit_context');
    expect(matched.correlation.workstreamIds).toEqual(['ws_explicit_1']);
    expect(matched.correlation.identityStatus).toBe('present');
    expect(matched.correlation.checkpointId).toBe('ckpt_explicit');
  });

  it('WF-COMPAT-001: default high-risk plan contract includes two-pass-v1', () => {
    const contract = createDefaultPlanContract({
      taskId: 'task-protocol',
      taskType: 'change',
      risk: 'high',
      rationale: 'test',
      fallbackEscalation: 'escalate',
      requiredTests: [{ id: 'WF-COMPAT-001', status: 'unresolved' }],
      independentReviewReasons: ['broad-regression'],
    });
    expect(contract.reviewClosureProtocol).toBe('two-pass-v1');
    const rendered = renderPlanContractMarker(contract);
    expect(rendered).toContain('two-pass-v1');
  });

  it('WF-CLOSURE-001 / review-loop finding fires at two failures', () => {
    const findings = buildWorkflowFindings({
      marker: null,
      markerStatus: 'missing',
      transcriptSignals: null,
      transcriptStatus: 'parsed',
      identityStatus: 'present',
      protocolPhase: 'routing_required',
      failedPremiumReviewCount: 2,
    });
    expect(findings.some((finding) => finding.id === 'review-loop-unbounded')).toBe(true);
  });

  it('WF-PAY-CONTRACT-001: inventory actor/transition obligations are enumerated (not behavioral auth proof)', () => {
    // Intentionally does not use WF-PAY-ACTOR/MUTATION/REPORT IDs in the title so
    // preflight cannot mis-mark those IDs completed from contract-only tests.
    const inventory = buildFixtureTimesheetsPayInventory();
    expect(inventory.requiredBehavioralTestIds).toEqual(
      expect.arrayContaining([
        'WF-PAY-ACTOR-001',
        'WF-PAY-MUTATION-001',
        'WF-PAY-REPORT-001',
      ])
    );
    expect(inventory.surfaces.filter((surface) => surface.kind === 'actor')).toHaveLength(6);
    expect(inventory.mode).toBe('fixture');
  });

  it('WF-PRIVACY-001: evidence manifests mark redaction and omit secrets', () => {
    const repoRoot = makeTempRoot('privacy');
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_privacy_1',
      kind: 'preflight',
      baseCommit: 'abc1234',
      runChecks: false,
      commandResults: [
        { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    expect(built.manifest.status).toBe('passed');
    expect(built.manifest.privacy.redacted).toBe(true);
    expect(JSON.stringify(built.manifest)).not.toMatch(/POSTGRES_URL|password|secret/iu);
  });

  it('WF-MIGRATION-001: migration fingerprint mismatch blocks resume', () => {
    const repoRoot = makeTempRoot('migration');
    mkdirSync(path.join(repoRoot, 'supabase'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'supabase', 'a.sql'), 'select 1;', 'utf8');
    writeFileSync(path.join(repoRoot, 'package.json'), '{}', 'utf8');
    writeFileSync(path.join(repoRoot, 'package-lock.json'), '{}', 'utf8');

    createOrLoadFinaliseCheckpoint({
      repoRoot,
      workstreamId: 'ws_mig_1',
      checkpointId: 'ckpt_mig',
    });
    markFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_mig_1',
      checkpointId: 'ckpt_mig',
      task: 'migrations',
      status: 'passed',
      command: 'migrate',
      exitCode: 0,
    });

    writeFileSync(path.join(repoRoot, 'supabase', 'b.sql'), 'select 2;', 'utf8');
    const result = canResumeFinaliseCheckpointStep({
      repoRoot,
      workstreamId: 'ws_mig_1',
      checkpointId: 'ckpt_mig',
      task: 'migrations',
    });
    expect(result.resumable).toBe(false);
  });
});
