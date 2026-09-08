import { readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKFLOW_UNBYPASSABLE_SAFETY_REQUIREMENTS,
  classifyWorkflowModelAutonomy,
  isTeeAutonomousModel,
  selectWorkflowTeeMode,
} from '@/scripts/automation/workflow-model-tier';
import { buildWorkflowFindings } from '@/scripts/automation/workflow-findings';
import { validateWorkflowCompletionMarker } from '@/scripts/automation/workflow-marker';
import {
  applyProtocolTransition,
  readProtocolRecord,
  writeProtocolRecord,
} from '@/scripts/automation/workflow-review-protocol';
import {
  getFinaliseProtocolReadiness,
  resolveFinaliseWorkstreamMatches,
} from '@/scripts/automation/workflow-finalise-correlation';
import { buildEvidenceManifest } from '@/scripts/automation/workflow-evidence-manifest';
import { getWorkflowPaths, loadWorkflowReviewState } from '@/scripts/automation/workflow-events';
import {
  assessAcceptanceCommandSubstitution,
  assessWorkflowVerificationCapability,
} from '@/scripts/automation/workflow-tool-capability';
import {
  cleanupWorkflowV24Fixtures,
  failFirstThenClosure,
  initGitRepo,
  initWorkstream,
  makeTempRoot,
  writePassingManifest,
} from '@/tests/unit/workflow-v24-test-harness';

afterEach(async () => {
  cleanupWorkflowV24Fixtures();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

function authorize(params: {
  repoRoot: string;
  predecessor: string;
  successor: string;
  mode?: 'direct' | 'tee-light' | 'tee-full';
    model?: string | null;
}) {
  return applyProtocolTransition({
    repoRoot: params.repoRoot,
    command: 'successor-authorize',
    workstreamId: params.predecessor,
    newWorkstreamId: params.successor,
    teeMode: params.mode ?? 'tee-full',
    ownerAuthorization: `authorise successor ${params.successor}`,
    model:
      params.model === null
        ? undefined
        : (params.model ??
          (params.mode === 'direct' || params.mode === 'tee-light'
            ? 'gpt-5.6-sol-high'
            : undefined)),
  });
}

function premiumContext(
  overrides: Partial<Parameters<typeof selectWorkflowTeeMode>[0]> = {}
): Parameters<typeof selectWorkflowTeeMode>[0] {
  return {
    modelId: 'gpt-5.6-sol-high',
    parentTier: 'premium',
    lane: 'standard',
    complexity: 'small',
    ambiguity: 'low',
    blastRadius: 'local',
    reversible: true,
    testQuality: 'strong',
    productionDataImpact: 'none',
    securityConsequences: 'none',
    independentReviewValue: 'low',
    ...overrides,
  };
}

describe('TEE V2.5 owner-controlled successor generations', { timeout: 50_000 }, () => {
  it('TEE25-SAME-CONTEXT-SUCCESSOR-001 / TEE25-NO-WORKTREE-007 / TEE25-SAME-BRANCH-008', () => {
    const repoRoot = makeTempRoot('tee25-same-context');
    const base = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_generation_1', base);
    failFirstThenClosure(repoRoot, 'ws_generation_1');
    const before = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).stdout;

    const result = authorize({
      repoRoot,
      predecessor: 'ws_generation_1',
      successor: 'ws_generation_2',
    });

    expect(result.ok, result.message).toBe(true);
    expect(result.successorWorkstreamId).toBe('ws_generation_2');
    const successor = readProtocolRecord(repoRoot, 'ws_generation_2');
    expect(successor?.branchName).toBe('main');
    expect(successor?.successorGeneration?.generation).toBe(2);
    expect(successor?.failedPremiumReviewCount).toBe(0);
    const after = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).stdout;
    expect(after).toBe(before);
  });

  it('TEE25-NO-SILENT-RESET-002 / TEE25-SPLIT-NO-RESET-003', () => {
    const repoRoot = makeTempRoot('tee25-no-reset');
    const base = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_exhausted', base);
    failFirstThenClosure(repoRoot, 'ws_exhausted');

    const ordinaryNewId = applyProtocolTransition({
      repoRoot,
      command: 'init',
      workstreamId: 'ws_cosmetic_id',
      baseCommit: base,
      sourceWorkstreamIds: ['ws_exhausted'],
    });
    expect(ordinaryNewId.ok).toBe(true);
    expect(ordinaryNewId.record?.failedPremiumReviewCount).toBeGreaterThanOrEqual(2);

    initWorkstream(repoRoot, 'ws_exhausted_split', base);
    failFirstThenClosure(repoRoot, 'ws_exhausted_split');
    const split = applyProtocolTransition({
      repoRoot,
      command: 'split',
      workstreamId: 'ws_exhausted_split',
      newWorkstreamId: 'ws_split_child',
    });
    expect(split.ok).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_split_child')?.failedPremiumReviewCount).toBeGreaterThanOrEqual(2);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'review-start',
        workstreamId: 'ws_split_child',
        pass: 'first',
      }).ok
    ).toBe(false);
  });

  it('TEE25-BLOCKER-INHERIT-004 carries unresolved blockers and gates the successor review', () => {
    const repoRoot = makeTempRoot('tee25-blockers');
    const base = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_blocked_1', base);
    failFirstThenClosure(repoRoot, 'ws_blocked_1');

    expect(
      authorize({
        repoRoot,
        predecessor: 'ws_blocked_1',
        successor: 'ws_blocked_2',
      }).ok
    ).toBe(true);
    const successor = readProtocolRecord(repoRoot, 'ws_blocked_2');
    expect(successor?.openBlockerIds).toEqual(['C']);
    expect(successor?.successorGeneration?.inheritedOpenBlockerIds).toEqual(['C']);
    expect(successor?.successorGeneration?.inheritedFixDeltaManifestPath).toBeTruthy();
    expect(successor?.phase).toBe('fix_sweep_required');
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'review-start',
        workstreamId: 'ws_blocked_2',
        pass: 'first',
      }).ok
    ).toBe(false);
  });

  it('TEE25-SECOND-AUTH-005 requires fresh authorization after each exhausted successor', () => {
    const repoRoot = makeTempRoot('tee25-second-auth');
    const base = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_g1', base);
    failFirstThenClosure(repoRoot, 'ws_g1');
    expect(authorize({ repoRoot, predecessor: 'ws_g1', successor: 'ws_g2' }).ok).toBe(true);

    const inheritedFix = writePassingManifest(repoRoot, 'ws_g2', 'fix-delta', ['C']);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'fix-record',
        workstreamId: 'ws_g2',
        manifestPath: inheritedFix,
        closedBlockerIds: ['C'],
      }).ok
    ).toBe(true);
    failFirstThenClosure(repoRoot, 'ws_g2');
    expect(readProtocolRecord(repoRoot, 'ws_g2')?.successorGeneration?.generation).toBe(2);
    expect(authorize({ repoRoot, predecessor: 'ws_g2', successor: 'ws_g3' }).ok).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_g3')?.successorGeneration?.generation).toBe(3);
    expect(authorize({ repoRoot, predecessor: 'ws_g2', successor: 'ws_illegal_g3b' }).ok).toBe(false);
  });

  it('TEE25-V24-MIGRATION-006 / TEE25-V24-PREMIUM-ESCAPE-019 preserves exhausted history while allowing premium DIRECT', () => {
    const repoRoot = makeTempRoot('tee25-v24');
    const base = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_v24_historical', base);
    failFirstThenClosure(repoRoot, 'ws_v24_historical');
    const historical = readProtocolRecord(repoRoot, 'ws_v24_historical')!;
    historical.phase = 'routing_required';
    historical.nextAction = 'route_or_isolate';
    const attemptsBefore = JSON.stringify(historical.reviewAttempts);
    writeProtocolRecord(repoRoot, historical);

    const direct = authorize({
      repoRoot,
      predecessor: 'ws_v24_historical',
      successor: 'ws_v25_direct',
      mode: 'direct',
      model: null,
    });
    expect(direct.ok, direct.message).toBe(true);
    expect(readProtocolRecord(repoRoot, 'ws_v24_historical')?.phase).toBe('routing_required');
    expect(JSON.stringify(readProtocolRecord(repoRoot, 'ws_v24_historical')?.reviewAttempts)).toBe(
      attemptsBefore
    );
    expect(readProtocolRecord(repoRoot, 'ws_v25_direct')?.phase).toBe(
      'direct_continuation_authorized'
    );
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
    const inheritedFix = writePassingManifest(repoRoot, 'ws_v25_direct', 'fix-delta', ['C']);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'fix-record',
        workstreamId: 'ws_v25_direct',
        manifestPath: inheritedFix,
        closedBlockerIds: ['C'],
      }).ok
    ).toBe(true);
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'finalise-start',
        workstreamId: 'ws_v25_direct',
      }).ok
    ).toBe(true);
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(true);
    const driftPath = path.join(repoRoot, 'direct-drift.txt');
    writeFileSync(driftPath, 'drift\n', 'utf8');
    expect(getFinaliseProtocolReadiness(repoRoot).allowed).toBe(false);
    rmSync(driftPath);
    expect(
      applyProtocolTransition({
        repoRoot,
        command: 'finalise-start',
        workstreamId: 'ws_v25_direct',
      }).ok
    ).toBe(true);
    const correlation = resolveFinaliseWorkstreamMatches({
      repoRoot,
      state: loadWorkflowReviewState(getWorkflowPaths(repoRoot).statePath),
      branchName: 'main',
      headCommit: base,
    });
    expect(correlation.correlation).toMatchObject({
      matchedBy: 'explicit_context',
      workstreamIds: ['ws_v25_direct'],
    });
  });
});

describe('TEE V2.5 model-aware workflow selection', () => {
  it('TEE25-AUTONOMY-REGISTRY-020 grants self-selection only to explicit registry members', () => {
    expect(isTeeAutonomousModel('gpt-5.6-sol-high')).toBe(true);
    for (const model of [
      'cursor-grok-4.6-xhigh-fast',
      'grok-4.6',
      'gpt-5.5-high',
      'claude-opus-5-thinking-high',
      'self-described-capable-model',
    ]) {
      expect(isTeeAutonomousModel(model)).toBe(false);
      expect(
        selectWorkflowTeeMode(
          premiumContext({
            modelId: model,
            parentTier: 'premium',
          })
        )
      ).toMatchObject({
        mode: 'tee-managed',
        source: 'automatic_tee',
      });
    }
  });

  it('TEE25-GROK-MANAGED-021 keeps Grok 4.6 managed and rejects premium marker claims', () => {
    expect(
      selectWorkflowTeeMode(
        premiumContext({
          modelId: 'cursor-grok-4.6-xhigh-fast',
          parentTier: 'economical',
        })
      )
    ).toMatchObject({
      mode: 'tee-managed',
      source: 'automatic_tee',
    });

    const parsed = validateWorkflowCompletionMarker({
      schemaVersion: '4',
      lane: 'standard',
      taskId: 'grok-false-premium',
      taskType: 'change',
      verification: 'passed',
      commit: 'completed',
      handoff: 'completed',
      teeMode: 'direct',
      teeModeSource: 'premium_model',
      executionParentTier: 'premium',
    });
    expect(parsed.status).toBe('present');
    const findings = buildWorkflowFindings({
      marker: parsed.marker,
      markerStatus: parsed.status,
      transcriptSignals: null,
      observedParentTier: 'economical',
      observedModelId: 'cursor-grok-4.6-xhigh-fast',
    });
    expect(findings.map((finding) => finding.id)).toContain(
      'unregistered-model-autonomy-claim'
    );
  });

  it('TEE25-SOL-AUTONOMOUS-022 keeps GPT-5.6 Sol autonomous', () => {
    expect(classifyWorkflowModelAutonomy('gpt-5.6-sol-high')).toBe('tee-autonomous');
    expect(selectWorkflowTeeMode(premiumContext())).toMatchObject({
      mode: 'direct',
      source: 'premium_model',
    });
  });

  it('TEE25-UNKNOWN-MODEL-MANAGED-023 fails unknown identity toward managed TEE', () => {
    for (const modelId of [undefined, null, 'unknown-model']) {
      expect(
        selectWorkflowTeeMode(
          premiumContext({
            modelId,
            parentTier: modelId ? 'unknown' : 'premium',
          })
        )
      ).toMatchObject({
        mode: 'tee-managed',
        source: 'automatic_tee',
      });
    }
  });

  it('TEE25-CHEAP-SIMPLE-LIGHT-024 keeps simple Grok audit work in STANDARD', () => {
    expect(
      selectWorkflowTeeMode(
        premiumContext({
          modelId: 'cursor-grok-4.6-xhigh-fast',
          parentTier: 'economical',
          lane: 'standard',
          productionDataImpact: 'read-only',
        })
      )
    ).toEqual({
      mode: 'tee-managed',
      source: 'automatic_tee',
      reason: 'tee-managed-standard-lane',
    });
  });

  it('TEE25-PREMIUM-DIRECT-013 permits recognised premium DIRECT execution', () => {
    expect(selectWorkflowTeeMode(premiumContext())).toMatchObject({
      mode: 'direct',
      source: 'premium_model',
    });
  });

  it('TEE25-PREMIUM-LIGHT-014 selects only material safeguards', () => {
    expect(
      selectWorkflowTeeMode(
        premiumContext({ lane: 'critical', securityConsequences: 'contained' })
      ).mode
    ).toBe('tee-light');
  });

  it('TEE25-PREMIUM-FULL-015 retains full TEE where materially useful', () => {
    expect(
      selectWorkflowTeeMode(
        premiumContext({
          lane: 'critical',
          complexity: 'exceptional',
          ambiguity: 'high',
          blastRadius: 'production',
        })
      ).mode
    ).toBe('tee-full');
  });

  it('TEE25-PREMIUM-CRITICAL-NOT-FORCED-016 keeps risk separate from ceremony', () => {
    expect(selectWorkflowTeeMode(premiumContext({ lane: 'critical' })).mode).toBe('direct');
  });

  it('TEE25-USER-MODE-OVERRIDE-017 honors explicit owner modes', () => {
    for (const mode of ['direct', 'tee-light', 'tee-full'] as const) {
      expect(selectWorkflowTeeMode(premiumContext({ userOverride: mode }))).toMatchObject({
        mode,
        source: 'owner_override',
      });
    }
      expect(
        selectWorkflowTeeMode(
          premiumContext({
            modelId: 'cursor-grok-4.6-xhigh-fast',
            parentTier: 'economical',
            userOverride: 'direct',
          })
        )
      ).toMatchObject({
        mode: 'direct',
        source: 'owner_override',
      });
  });

  it('TEE25-SAFETY-ALWAYS-018 retains objective safeguards in every mode', () => {
    expect(WORKFLOW_UNBYPASSABLE_SAFETY_REQUIREMENTS).toEqual(
      expect.arrayContaining([
        'production-data-authorization',
        'secret-protection',
        'deployment-authorization',
        'no-force-push-without-authorization',
        'truthful-verification-reporting',
      ])
    );
  });
});

describe('TEE V2.5 capability-based verification and release aliases', () => {
  it('TEE25-TOOL-CAPABILITY-009 / TEE25-PLAYWRIGHT-LOCAL-010 does not require Docker for browser verification', () => {
    expect(
      assessWorkflowVerificationCapability({
        property: 'browser-ui',
        available: ['local-next-playwright'],
      })
    ).toMatchObject({ satisfied: true, selectedCapability: 'local-next-playwright' });
  });

  it('TEE25-POSTGRES-CAPABILITY-011 requires disposable real PostgreSQL semantics', () => {
    expect(
      assessWorkflowVerificationCapability({
        property: 'postgres-concurrency',
        available: ['pglite', 'local-next-playwright'],
      }).satisfied
    ).toBe(false);
    expect(
      assessWorkflowVerificationCapability({
        property: 'postgres-concurrency',
        available: ['native-local-postgres'],
      }).satisfied
    ).toBe(true);
    expect(
      assessAcceptanceCommandSubstitution({
        originalProperty: 'postgres-concurrency',
        replacementProperty: 'browser-ui',
        deterministic: true,
        coverage: 'stronger',
        recorded: true,
      }).allowed
    ).toBe(false);
  });

  it('records capability decisions in the canonical evidence manifest', () => {
    const repoRoot = makeTempRoot('tee25-capability-manifest');
    const base = initGitRepo(repoRoot);
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_capability',
      kind: 'preflight',
      baseCommit: base,
      runChecks: false,
      commandResults: [
        {
          name: 'local-playwright',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'local Next.js browser acceptance passed',
          command: 'npx playwright test',
        },
      ],
      verificationRequirements: [
        {
          property: 'browser-ui',
          available: ['local-next-playwright'],
          evidenceCommandNames: ['local-playwright'],
        },
      ],
    });
    expect(built.manifest.status).toBe('passed');
    expect(built.manifest.verificationCapabilities?.[0]).toMatchObject({
      property: 'browser-ui',
      assessment: { satisfied: true, selectedCapability: 'local-next-playwright' },
    });
    expect(
      buildEvidenceManifest({
        repoRoot,
        workstreamId: 'ws_unexecuted_capability',
        kind: 'preflight',
        baseCommit: base,
        runChecks: false,
        verificationRequirements: [
          {
            property: 'postgres-concurrency',
            available: ['native-local-postgres'],
            evidenceCommandNames: ['postgres-lock-test'],
          },
        ],
      }).manifest.status
    ).toBe('failed');
  });

  it('TEE25-FAP-FFAP-012 preserves COMPLETE_AND_RELEASE semantics', () => {
    const fap = readFileSync(path.join(process.cwd(), '.cursor', 'commands', 'fap.md'), 'utf8');
    const ffap = readFileSync(path.join(process.cwd(), '.cursor', 'commands', 'ffap.md'), 'utf8');
    expect(fap).toContain('COMPLETE_AND_RELEASE(normal)');
    expect(ffap).toContain('COMPLETE_AND_RELEASE(full)');
    expect(fap).toContain('npm run finalise:push');
    expect(ffap).toContain('npm run finalise:full:push');
  });
});
