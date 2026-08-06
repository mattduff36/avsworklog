import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import {
  runMonthlyAutomationFollowUp,
  writeMonthlyAutomationPendingFollowUp,
  type PendingMonthlyFollowUp,
} from '@/scripts/automation/monthly-follow-up';
import {
  WORKFLOW_REVIEW_THRESHOLD,
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  listWorkflowEvents,
  loadWorkflowReviewState,
  recoverStaleWorkflowLock,
  saveWorkflowReviewState,
  withWorkflowLock,
  writeWorkflowEvent,
} from '@/scripts/automation/workflow-events';
import { buildWorkflowFindings, estimatePremiumTokenReduction } from '@/scripts/automation/workflow-findings';
import {
  extractWorkflowCompletionMarker,
  renderWorkflowCompletionMarker,
  validateWorkflowCompletionMarker,
} from '@/scripts/automation/workflow-marker';
import {
  classifyWorkflowModelTier,
  getWorkflowRoutingAction,
} from '@/scripts/automation/workflow-model-tier';
import { assertNoForbiddenPayload, hashIdentifier, sanitizeEvidenceLabel } from '@/scripts/automation/workflow-privacy';
import { parseWorkflowTranscript } from '@/scripts/automation/workflow-transcript';
import {
  extractPlanContractMarker,
} from '@/scripts/automation/workflow-plan-contract';
import {
  buildWorkflowReviewMetrics,
  computePlanRecommendationAdherence,
  processWorkflowStopEvent,
} from '@/scripts/automation/workflow-review';
import type { WorkflowCompletionMarker, WorkflowStopEvent, WorkflowTranscriptSignals } from '@/scripts/automation/types';

const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
  const root = path.join(tmpdir(), `workflow-review-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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
function marker(overrides: Partial<WorkflowCompletionMarker> = {}): WorkflowCompletionMarker {
  const risk = overrides.risk ?? 'routine';
  return {
    schemaVersion: '1',
    taskId: overrides.taskId ?? 'task-1',
    taskType: overrides.taskType ?? 'change',
    risk,
    workstreamId: overrides.workstreamId,
    sourceWorkstreamIds: overrides.sourceWorkstreamIds,
    exploreCanonical: overrides.exploreCanonical ?? true,
    architectureGate: overrides.architectureGate ?? 'skipped',
    requiredTests: overrides.requiredTests ?? [],
    unresolvedRisks: overrides.unresolvedRisks ?? [],
    verification: overrides.verification ?? 'passed',
    finalReviewRequired: overrides.finalReviewRequired ?? risk === 'high',
    reviewEscalationReasons: overrides.reviewEscalationReasons ?? [],
    finalReview: overrides.finalReview ?? 'skipped',
    commit: overrides.commit ?? 'completed',
    handoff: overrides.handoff ?? 'completed',
  };
}

function markerV2(overrides: Partial<WorkflowCompletionMarker> = {}): WorkflowCompletionMarker {
  const base = marker(overrides);
  const finalReviewRequired = base.finalReviewRequired ?? base.risk === 'high';
  return {
    ...base,
    ...overrides,
    schemaVersion: '2',
    initialParentTier: overrides.initialParentTier ?? 'premium',
    executionParentTier: overrides.executionParentTier ?? 'premium',
    routingDecision: overrides.routingDecision ?? 'continued_premium',
    architectureReviewSource:
      overrides.architectureReviewSource ?? (base.risk === 'high' ? 'parent_structured' : 'not_applicable'),
    requiredTests:
      overrides.requiredTests ??
      (base.risk === 'high' ? [{ id: 'VERIFY-001', status: 'completed' }] : []),
    independentReviewRequired: overrides.independentReviewRequired ?? false,
    independentReviewReasons: overrides.independentReviewReasons ?? [],
    finalReviewSource:
      overrides.finalReviewSource ?? (finalReviewRequired ? 'parent_structured' : 'not_applicable'),
  };
}

function markerV3(overrides: Partial<WorkflowCompletionMarker> = {}): WorkflowCompletionMarker {
  return {
    ...markerV2(overrides),
    ...overrides,
    schemaVersion: '3',
    workstreamId: overrides.workstreamId ?? 'ws_test',
    registryVersion: overrides.registryVersion ?? '2',
    recommendedBuildModel: overrides.recommendedBuildModel ?? {
      implementation: {
        role: 'premium-planning',
        tier: 'premium',
        family: 'gpt-sol',
      },
      premiumGates: [],
      switchTiming: 'not_applicable',
      rationale: 'Test recommendation.',
      fallbackEscalation: 'Escalate if verification fails.',
    },
    planRecommendationAdherence: overrides.planRecommendationAdherence ?? 'matched',
    reviewPasses: overrides.reviewPasses ?? [],
  };
}

function writeJsonl(filePath: string, records: unknown[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

describe('workflow-marker', () => {
  it('parses and validates a complete marker', () => {
    const rendered = renderWorkflowCompletionMarker(marker({ taskId: 'abc' }));
    const parsed = extractWorkflowCompletionMarker(`Done.\n${rendered}\n`);
    expect(parsed.status).toBe('present');
    expect(parsed.marker?.taskId).toBe('abc');
  });

  it('MARKER-002 round-trips v2 routing evidence while preserving v1 compatibility', () => {
    const v2 = markerV2({ taskId: 'route-2' });
    const parsedV2 = extractWorkflowCompletionMarker(renderWorkflowCompletionMarker(v2));
    expect(parsedV2.status).toBe('present');
    expect(parsedV2.marker?.schemaVersion).toBe('2');
    expect(parsedV2.marker?.executionParentTier).toBe('premium');

    const parsedV1 = extractWorkflowCompletionMarker(renderWorkflowCompletionMarker(marker()));
    expect(parsedV1.status).toBe('present');
    expect(parsedV1.marker?.schemaVersion).toBe('1');
  });

  it('MARKER-003 validates and selects v3 completion markers', () => {
    const v3 = markerV3({
      taskId: 'route-3',
      sourceWorkstreamIds: ['ws-source-a', 'ws-source-b'],
    });
    const parsedV3 = extractWorkflowCompletionMarker(renderWorkflowCompletionMarker(v3));
    expect(parsedV3.status).toBe('present');
    expect(parsedV3.marker?.schemaVersion).toBe('3');
    expect(parsedV3.marker?.workstreamId).toBe('ws_test');
    expect(parsedV3.marker?.sourceWorkstreamIds).toEqual(['ws-source-a', 'ws-source-b']);

    const incomplete = markerV3();
    delete incomplete.reviewPasses;
    expect(validateWorkflowCompletionMarker(incomplete).status).toBe('malformed');

    const latest = extractWorkflowCompletionMarker(
      `${renderWorkflowCompletionMarker(v3)}\n${renderWorkflowCompletionMarker(markerV2({ taskId: 'latest-v2' }))}`
    );
    expect(latest.marker?.taskId).toBe('latest-v2');
  });

  it('requires complete v2 routing and independent-review evidence', () => {
    const incomplete = markerV2();
    delete incomplete.routingDecision;
    expect(validateWorkflowCompletionMarker(incomplete).status).toBe('malformed');

    const missingReason = markerV2({
      risk: 'high',
      independentReviewRequired: true,
      independentReviewReasons: [],
    });
    expect(validateWorkflowCompletionMarker(missingReason).status).toBe('malformed');

    const missingReviewRequirement = markerV2();
    delete missingReviewRequirement.finalReviewRequired;
    expect(validateWorkflowCompletionMarker(missingReviewRequirement).status).toBe('malformed');

    const contradictoryRouting = markerV2({
      routingDecision: 'switched_to_economical',
      executionParentTier: 'premium',
    });
    expect(validateWorkflowCompletionMarker(contradictoryRouting).status).toBe('malformed');

    const duplicateTests = markerV2({
      risk: 'high',
      requiredTests: [
        { id: 'VERIFY-001', status: 'completed' },
        { id: 'VERIFY-001', status: 'unresolved' },
      ],
    });
    expect(validateWorkflowCompletionMarker(duplicateTests).status).toBe('malformed');
  });

  it('rejects malformed markers and missing markers', () => {
    expect(extractWorkflowCompletionMarker('no marker here').status).toBe('missing');
    expect(validateWorkflowCompletionMarker({ schemaVersion: '1' }).status).toBe('malformed');
    expect(
      extractWorkflowCompletionMarker('<!-- workflow-completion-marker:v1\n{not-json}\n-->').status
    ).toBe('malformed');
  });

  it('keeps old markers compatible and cannot bypass required review', () => {
    const legacy = marker({ risk: 'routine' });
    delete legacy.finalReviewRequired;
    delete legacy.reviewEscalationReasons;
    const legacyParsed = validateWorkflowCompletionMarker(legacy);
    expect(legacyParsed.status).toBe('present');
    expect(legacyParsed.marker?.finalReviewRequired).toBe(false);

    const contradictoryHighRisk = validateWorkflowCompletionMarker({
      ...marker({ risk: 'high', finalReviewRequired: false }),
      finalReviewRequired: false,
    });
    expect(contradictoryHighRisk.marker?.finalReviewRequired).toBe(true);

    const reasonsOnly = validateWorkflowCompletionMarker({
      ...marker({
        risk: 'routine',
        finalReviewRequired: false,
        reviewEscalationReasons: ['hardcoding'],
      }),
      finalReviewRequired: false,
    });
    expect(reasonsOnly.marker?.finalReviewRequired).toBe(true);

    const invalidReason = validateWorkflowCompletionMarker({
      ...marker(),
      reviewEscalationReasons: ['hardcoding', 123],
    });
    expect(invalidReason.status).toBe('malformed');
  });
});
describe('workflow-privacy', () => {
  it('PRIVACY-002: hashes identifiers and rejects emails, transcripts, and secrets', () => {
    expect(hashIdentifier('conversation-a')).toBe(
      createHash('sha256').update('conversation-a').digest('hex').slice(0, 32)
    );
    expect(sanitizeEvidenceLabel('email user@example.com path C:\\Users\\mattd\\secret')).not.toContain(
      'user@example.com'
    );
    expect(sanitizeEvidenceLabel('token=supersecretvalue123 Bearer abcdefghijklmnop')).toContain(
      '[REDACTED'
    );
    expect(assertNoForbiddenPayload({ user_email: 'x@y.com' })).toContain('user_email must not be persisted');
    expect(assertNoForbiddenPayload({ note: 'see agent-transcripts/abc.jsonl' })).toContain(
      'raw transcript path must not be persisted'
    );
    expect(assertNoForbiddenPayload({ note: 'API_KEY=abcd1234efgh5678' })).toContain(
      'environment secret assignment must not be persisted'
    );
    expect(assertNoForbiddenPayload({ note: 'access_token=abcdefghijklmnop' })).toContain(
      'secret assignment must not be persisted'
    );
    expect(assertNoForbiddenPayload({ note: 'refresh_token=abcdefghijklmnop' })).toContain(
      'secret assignment must not be persisted'
    );
    expect(assertNoForbiddenPayload({ note: 'client_secret=abcdefghijklmnop' })).toContain(
      'secret assignment must not be persisted'
    );
    expect(assertNoForbiddenPayload({ note: 'password=hunter22secret' })).toContain(
      'secret assignment must not be persisted'
    );
    expect(
      assertNoForbiddenPayload({
        note: 'Bearer abcdefghijklmnopqr',
      })
    ).toContain('bearer token must not be persisted');
    const syntheticJwt = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'synthetic-test-subject' })).toString('base64url'),
      'synthetic-signature',
    ].join('.');
    expect(
      assertNoForbiddenPayload({
        note: syntheticJwt,
      })
    ).toContain('JWT token must not be persisted');
    expect(
      assertNoForbiddenPayload({
        note: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----',
      })
    ).toContain('private key material must not be persisted');
    expect(assertNoForbiddenPayload({ workstreamId: 'ws_safe', taskId: 'task-1' })).toEqual([]);
  });
});

describe('workflow model routing', () => {
  it('uses the versioned model-tier registry without guessing unknown models', () => {
    expect(classifyWorkflowModelTier('gpt-5.6-sol-high')).toBe('premium');
    expect(classifyWorkflowModelTier('cursor-grok-4.5-high-fast')).toBe('economical');
    expect(classifyWorkflowModelTier('composer-2.5-fast')).toBe('economical');
    expect(classifyWorkflowModelTier('gpt-5.6-sol-unregistered')).toBe('unknown');
    expect(classifyWorkflowModelTier('future-model')).toBe('unknown');
    expect(classifyWorkflowModelTier(undefined)).toBe('unknown');
  });

  it('ROUTE-001 asks once for a premium-parent routine task', () => {
    expect(
      getWorkflowRoutingAction({
        parentTier: 'premium',
        risk: 'routine',
        substantive: true,
        explicitPremiumRequested: false,
      })
    ).toBe('ask_switch');
  });

  it('ROUTE-002 pauses when the user elects to switch', () => {
    expect(
      getWorkflowRoutingAction({
        parentTier: 'premium',
        risk: 'routine',
        substantive: true,
        explicitPremiumRequested: false,
        premiumTaskDecision: 'pause_to_switch',
      })
    ).toBe('pause_for_switch');
  });

  it('ROUTE-003 does not repeat the prompt after continuing premium', () => {
    expect(
      getWorkflowRoutingAction({
        parentTier: 'premium',
        risk: 'routine',
        substantive: true,
        explicitPremiumRequested: false,
        premiumTaskDecision: 'continue_premium',
      })
    ).toBe('continue');
  });

  it('ROUTE-004 skips prompting for factual or explicitly premium work', () => {
    expect(
      getWorkflowRoutingAction({
        parentTier: 'premium',
        risk: 'routine',
        substantive: false,
        explicitPremiumRequested: false,
      })
    ).toBe('continue');
    expect(
      getWorkflowRoutingAction({
        parentTier: 'premium',
        risk: 'routine',
        substantive: true,
        explicitPremiumRequested: true,
      })
    ).toBe('continue');
  });
});

describe('workflow-transcript adapter', () => {
  it('handles null, missing, BOM/CRLF, malformed, and strong signals', async () => {
    expect((await parseWorkflowTranscript(null)).signals.parseErrors[0]).toMatch(/null/i);

    const root = makeTempRoot('transcript');
    const missing = path.join(root, 'missing.jsonl');
    expect((await parseWorkflowTranscript(missing)).signals.parseErrors[0]).toMatch(/not found/i);

    const transcriptPath = path.join(root, 'chat.jsonl');
    const bom = '\uFEFF';
    writeFileSync(
      transcriptPath,
      `${bom}${JSON.stringify({
        role: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { path: 'C:/Users/mattd/.cursor/skills/token-efficient-engineering/SKILL.md' },
            },
            { type: 'tool_use', name: 'Task', input: { subagent_type: 'explore' } },
            { type: 'tool_use', name: 'Grep', input: { pattern: 'nickname', path: 'app' } },
            { type: 'tool_use', name: 'Grep', input: { pattern: 'nickname', path: 'app' } },
            { type: 'tool_use', name: 'Task', input: { subagent_type: 'architecture-gate' } },
            { type: 'tool_use', name: 'Task', input: { subagent_type: 'final-diff-reviewer' } },
            { type: 'tool_use', name: 'Shell', input: { command: 'npm run typecheck | head -20' } },
            { type: 'tool_use', name: 'Shell', input: { command: 'git commit -m "x"' } },
            {
              type: 'tool_use',
              name: 'Shell',
              input: { command: 'python scripts/bulk-text-insertion.py' },
            },
            {
              type: 'text',
              text: `${renderWorkflowCompletionMarker(marker({ risk: 'high', architectureGate: 'approved', finalReview: 'passed' }))}`,
            },
          ],
        },
      })}\r\n{not valid json}\r\n`,
      'utf8'
    );

    const parsed = await parseWorkflowTranscript(transcriptPath);
    expect(parsed.signals.adapterVersion).toBe('2');
    expect(parsed.signals.skillRead).toBe(true);
    expect(parsed.signals.architectureGateTask).toBe(true);
    expect(parsed.signals.finalDiffReviewerTask).toBe(true);
    expect(parsed.signals.exploreTask).toBe(true);
    expect(parsed.signals.duplicateBroadSearchAfterExplore).toBe(true);
    expect(parsed.signals.truncatedShellEvidence).toBe(true);
    expect(parsed.signals.gitCommitEvidence).toBe(true);
    expect(parsed.signals.bulkInsertionScriptEvidence).toBe(true);
    expect(parsed.signals.markerPresent).toBe(true);
    expect(parsed.signals.parseErrors.some((error) => /malformed/i.test(error))).toBe(true);
  });

  it('does not treat prose alone as a strong gate signal', async () => {
    const root = makeTempRoot('prose');
    const transcriptPath = path.join(root, 'chat.jsonl');
    writeJsonl(transcriptPath, [
      {
        role: 'assistant',
        message: {
          content: [{ type: 'text', text: 'I ran architecture-gate and final-diff-reviewer carefully.' }],
        },
      },
    ]);
    const parsed = await parseWorkflowTranscript(transcriptPath);
    expect(parsed.signals.architectureGateTask).toBe(false);
    expect(parsed.signals.finalDiffReviewerTask).toBe(false);
    expect(parsed.signals.markerPresent).toBe(false);
  });

  it('PLAN-PATH-001: rejects distinct ambiguous plan candidates after stable deduplication', async () => {
    const root = makeTempRoot('ambiguous-plans');
    const plansDirectory = path.join(root, 'plans');
    mkdirSync(plansDirectory, { recursive: true });
    writeFileSync(path.join(plansDirectory, 'one.plan.md'), '# One\n', 'utf8');
    writeFileSync(path.join(plansDirectory, 'two.plan.md'), '# Two\n', 'utf8');
    const transcriptPath = path.join(root, 'chat.jsonl');
    writeJsonl(transcriptPath, [
      {
        role: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'CreatePlan',
              input: { path: 'plans/one.plan.md' },
            },
            {
              type: 'tool_use',
              name: 'CreatePlan',
              input: { path: path.join(root, 'plans', '.', 'one.plan.md') },
            },
            {
              type: 'tool_use',
              name: 'CreatePlan',
              input: { path: 'plans/two.plan.md' },
            },
          ],
        },
      },
    ]);

    const parsed = await parseWorkflowTranscript(transcriptPath, { repoRoot: root });
    expect(parsed.signals.planPathSource).toBe('unavailable');
    expect(parsed.signals.planPathRef).toBeNull();
    expect(parsed.signals.parseErrors).toContain('ambiguous plan candidates');
  });
});

describe('workflow-findings', () => {
  const emptySignals = (): WorkflowTranscriptSignals => ({
    adapterVersion: '2',
    skillRead: false,
    architectureGateTask: false,
    finalDiffReviewerTask: false,
    exploreTask: false,
    truncatedShellEvidence: false,
    bulkInsertionScriptEvidence: false,
    duplicateBroadSearchAfterExplore: false,
    gitCommitEvidence: false,
    markerPresent: false,
    planContractPresent: false,
    planPathSource: 'unavailable',
    planPathRef: null,
    parseErrors: [],
  });

  it('flags missing gates, unresolved tests, truncation, and incomplete handoff', () => {
    const findings = buildWorkflowFindings({
      marker: marker({
        risk: 'high',
        architectureGate: 'skipped',
        finalReview: 'skipped',
        requiredTests: [{ id: 'db-acl', status: 'unresolved' }],
        unresolvedRisks: [],
        verification: 'unknown',
        commit: 'pending',
        handoff: 'pending',
      }),
      markerStatus: 'present',
      transcriptSignals: {
        ...emptySignals(),
        truncatedShellEvidence: true,
        duplicateBroadSearchAfterExplore: true,
        bulkInsertionScriptEvidence: true,
      },
    });

    const ids = findings.map((finding) => finding.id);
    expect(ids).toContain('missing-architecture-gate');
    expect(ids).toContain('missing-final-review');
    expect(ids).toContain('unresolved-gate-tests');
    expect(ids).toContain('truncated-verification-output');
    expect(ids).toContain('duplicate-broad-search');
    expect(ids).toContain('bulk-text-insertion');
    expect(ids).toContain('incomplete-commit');
    expect(ids).toContain('incomplete-handoff');
  });

  it('treats missing markers and unknown gates as unknown, never false passes', () => {
    const missing = buildWorkflowFindings({
      marker: null,
      markerStatus: 'missing',
      transcriptSignals: emptySignals(),
    });
    expect(missing.find((finding) => finding.id === 'missing-completion-marker')?.status).toBe('unknown');

    const unknownGate = buildWorkflowFindings({
      marker: marker({
        risk: 'high',
        architectureGate: 'unknown',
        finalReview: 'unknown',
      }),
      markerStatus: 'present',
      transcriptSignals: {
        ...emptySignals(),
        architectureGateTask: true,
        finalDiffReviewerTask: true,
      },
    });
    expect(unknownGate.find((finding) => finding.id === 'architecture-gate-unknown')?.status).toBe('unknown');
    expect(unknownGate.find((finding) => finding.id === 'final-review-unknown')?.status).toBe('unknown');

    const blocked = buildWorkflowFindings({
      marker: marker({
        risk: 'high',
        architectureGate: 'blocked',
        finalReview: 'failed',
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
    });
    expect(blocked.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(['architecture-gate-blocked', 'final-review-failed'])
    );
  });

  it('allows planning tasks without commit and estimates savings conservatively', () => {
    const findings = buildWorkflowFindings({
      marker: markerV2({
        taskType: 'planning',
        commit: 'not_applicable',
        handoff: 'completed',
        verification: 'passed',
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
    });
    expect(findings.some((finding) => finding.id === 'incomplete-commit')).toBe(false);
    expect(findings.some((finding) => finding.id === 'missing-plan-contract-marker')).toBe(true);

    const estimate = estimatePremiumTokenReduction([
      { marker: marker({ risk: 'high' }) },
      { marker: marker({ risk: 'routine' }) },
      { marker: null },
    ]);
    expect(estimate.confidence).toBe('low');
    expect(estimate.highPercent).toBeGreaterThanOrEqual(estimate.lowPercent);
  });

  it('requires premium review for an escalated routine change', () => {
    const findings = buildWorkflowFindings({
      marker: marker({
        risk: 'routine',
        finalReviewRequired: true,
        reviewEscalationReasons: ['hardcoding'],
        finalReview: 'skipped',
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
    });

    const missing = findings.find((finding) => finding.id === 'missing-final-review');
    expect(missing?.status).toBe('failed');
    expect(missing?.evidenceLabels).toContain('marker:reviewEscalationReason=hardcoding');
  });

  it('GATE-001 requires independent pre/post review for sensitive work', () => {
    const sensitiveParentReview = buildWorkflowFindings({
      marker: markerV2({
        risk: 'high',
        architectureGate: 'approved',
        architectureReviewSource: 'parent_structured',
        finalReview: 'passed',
        finalReviewSource: 'parent_structured',
        independentReviewRequired: true,
        independentReviewReasons: ['security'],
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
    });
    expect(sensitiveParentReview.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        'invalid-architecture-review-source',
        'invalid-final-review-source',
      ])
    );
  });

  it('GATE-002 and REVIEW-001 allow complete premium-parent structured passes', () => {
    const eligibleParentReview = buildWorkflowFindings({
      marker: markerV2({
        risk: 'high',
        architectureGate: 'approved',
        finalReview: 'passed',
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
    });
    expect(
      eligibleParentReview.some((finding) => finding.id === 'invalid-architecture-review-source')
    ).toBe(false);
    expect(
      eligibleParentReview.some((finding) => finding.id === 'invalid-final-review-source')
    ).toBe(false);
  });

  it('ECON-001 rejects parent-structured review for economical execution', () => {
    const findings = buildWorkflowFindings({
      marker: markerV2({
        risk: 'high',
        architectureGate: 'approved',
        finalReview: 'passed',
        executionParentTier: 'economical',
        architectureReviewSource: 'parent_structured',
        finalReviewSource: 'parent_structured',
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
      observedParentTier: 'economical',
    });
    expect(findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        'invalid-architecture-review-source',
        'invalid-final-review-source',
      ])
    );
  });

  it('AUDIT-001 reconciles marker tier claims with hook telemetry', () => {
    const findings = buildWorkflowFindings({
      marker: markerV2({
        risk: 'high',
        architectureGate: 'approved',
        finalReview: 'passed',
        executionParentTier: 'premium',
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
      observedParentTier: 'economical',
    });
    expect(findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        'parent-tier-mismatch',
        'invalid-architecture-review-source',
        'invalid-final-review-source',
      ])
    );
  });
});

describe('workflow events and lock', () => {
  it('STATE-002 creates v2 state and migrates v1 state defaults', () => {
    expect(createEmptyWorkflowReviewState()).toMatchObject({
      schemaVersion: '2',
      reviewWindowByEventId: {},
      workstreams: {},
    });

    const root = makeTempRoot('state-migration');
    const paths = getWorkflowPaths(root);
    mkdirSync(path.dirname(paths.statePath), { recursive: true });
    writeFileSync(
      paths.statePath,
      JSON.stringify({
        schemaVersion: '1',
        scriptName: 'workflow-review',
        updatedAt: '2026-07-01T00:00:00.000Z',
        lastReviewAt: null,
        lastReviewWindowId: null,
        lastReviewedEventId: null,
        unreviewedEventIds: ['event-1'],
        pendingFollowUpPath: null,
        processedGenerationHashes: ['generation-1'],
      }),
      'utf8'
    );

    expect(loadWorkflowReviewState(paths.statePath)).toMatchObject({
      schemaVersion: '2',
      unreviewedEventIds: ['event-1'],
      reviewWindowByEventId: {},
      workstreams: {},
    });
  });

  it('deduplicates generation events and recovers stale locks', () => {
    const root = makeTempRoot('events');
    const paths = getWorkflowPaths(root);
    const event: WorkflowStopEvent = {
      schemaVersion: '1',
      eventId: 'abc',
      recordedAt: '2026-07-29T10:00:00.000Z',
      conversationHash: 'c',
      generationHash: 'g1',
      selectedModel: 'composer-2.5',
      selectedModelSource: 'model',
      selectedModelTier: 'economical',
      status: 'completed',
      loopCount: 0,
      qualifies: true,
      qualificationReasons: ['marker:present'],
      marker: marker(),
      markerStatus: 'present',
      transcriptSignals: null,
      findings: [],
      monthKey: '2026-07',
    };

    expect(writeWorkflowEvent(paths.eventsDirectory, event).created).toBe(true);
    expect(writeWorkflowEvent(paths.eventsDirectory, event).created).toBe(false);
    expect(listWorkflowEvents(paths.eventsDirectory)).toHaveLength(1);

    mkdirSync(path.dirname(paths.lockPath), { recursive: true });
    writeFileSync(
      paths.lockPath,
      JSON.stringify({
        pid: 2_147_483_647,
        token: 'dead-stale',
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      'utf8'
    );
    const value = withWorkflowLock(paths.lockPath, () => 42, { staleMs: 1_000, now: () => Date.now() });
    expect(value).toBe(42);
    expect(existsSync(paths.lockPath)).toBe(false);
  });

  it('restores a replacement lock if stale takeover races', () => {
    const root = makeTempRoot('stale-race');
    const paths = getWorkflowPaths(root);
    mkdirSync(path.dirname(paths.lockPath), { recursive: true });

    writeFileSync(
      paths.lockPath,
      JSON.stringify({
        pid: process.pid,
        token: 'replacement-owner',
        createdAt: new Date().toISOString(),
      }),
      'utf8'
    );

    const result = recoverStaleWorkflowLock({
      lockPath: paths.lockPath,
      expectedOwner: { token: 'old-stale-token', pid: 2_147_483_647 },
    });
    expect(result).toBe('restored-replacement');
    expect(JSON.parse(readFileSync(paths.lockPath, 'utf8')).token).toBe('replacement-owner');

    writeFileSync(paths.lockPath, '{', 'utf8'); // unreadable/partial replacement
    const partial = recoverStaleWorkflowLock({
      lockPath: paths.lockPath,
      expectedOwner: { token: 'old-stale-token', pid: 2_147_483_647 },
    });
    expect(partial).toBe('restored-replacement');
    expect(readFileSync(paths.lockPath, 'utf8')).toBe('{');
  });

  it('preserves a replacement lock token during cleanup', () => {
    const root = makeTempRoot('replace-lock');
    const paths = getWorkflowPaths(root);
    let sawOwnedToken = '';
    const result = withWorkflowLock(paths.lockPath, () => {
      sawOwnedToken = (JSON.parse(readFileSync(paths.lockPath, 'utf8')) as { token: string }).token;
      writeFileSync(
        paths.lockPath,
        JSON.stringify({
          pid: process.pid,
          token: 'replacement-token',
          createdAt: new Date().toISOString(),
        }),
        'utf8'
      );
      return 'done';
    });
    expect(result).toBe('done');
    expect(sawOwnedToken).toBeTruthy();
    expect(existsSync(paths.lockPath)).toBe(true);
    expect(JSON.parse(readFileSync(paths.lockPath, 'utf8')).token).toBe('replacement-token');
    rmSync(paths.lockPath, { force: true });
  });
});

describe('workflow-review cadence', () => {
  async function seedQualifyingEvent(params: {
    repoRoot: string;
    conversationId: string;
    generationId: string;
    now: Date;
    risk?: 'high' | 'routine';
    workstreamId?: string;
    commit?: WorkflowCompletionMarker['commit'];
  }) {
    const transcriptPath = path.join(params.repoRoot, 'transcripts', `${params.generationId}.jsonl`);
    writeJsonl(transcriptPath, [
      {
        role: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { path: 'C:/Users/x/.cursor/skills/token-efficient-engineering/SKILL.md' },
            },
            {
              type: 'text',
              text: renderWorkflowCompletionMarker(
                marker({
                  taskId: params.generationId,
                  workstreamId: params.workstreamId,
                  risk: params.risk ?? 'routine',
                  architectureGate: params.risk === 'high' ? 'approved' : 'skipped',
                  finalReview: params.risk === 'high' ? 'passed' : 'skipped',
                  commit: params.commit,
                })
              ),
            },
          ],
        },
      },
    ]);

    return processWorkflowStopEvent(
      {
        conversation_id: params.conversationId,
        generation_id: params.generationId,
        model_id: 'composer-2.5',
        transcript_path: transcriptPath,
        status: 'completed',
        loop_count: 0,
      },
      {
        repoRoot: params.repoRoot,
        now: () => params.now,
      }
    );
  }

  it('waits until five qualifying tasks before reviewing', async () => {
    const root = makeTempRoot('threshold');
    for (let index = 1; index <= 4; index += 1) {
      const result = await seedQualifyingEvent({
        repoRoot: root,
        conversationId: `c-${index}`,
        generationId: `g-${index}`,
        now: new Date(`2026-07-29T0${index}:00:00.000Z`),
      });
      expect(result.reviewTriggered).toBe(false);
    }

    const fifth = await seedQualifyingEvent({
      repoRoot: root,
      conversationId: 'c-5',
      generationId: 'g-5',
      now: new Date('2026-07-29T05:00:00.000Z'),
    });
    expect(fifth.reviewTriggered).toBe(true);
    expect(fifth.reviewWindowId).toBeTruthy();

    const paths = getWorkflowPaths(root);
    const state = loadWorkflowReviewState(paths.statePath);
    expect(state.unreviewedEventIds).toHaveLength(0);
    expect(Object.keys(state.reviewWindowByEventId ?? {})).toHaveLength(5);
  });

  it('reviews previous-month remainder on month-boundary backstop', async () => {
    const root = makeTempRoot('month');
    for (let index = 1; index <= 3; index += 1) {
      await seedQualifyingEvent({
        repoRoot: root,
        conversationId: `old-${index}`,
        generationId: `old-g-${index}`,
        now: new Date(`2026-06-28T0${index}:00:00.000Z`),
      });
    }

    const boundary = await seedQualifyingEvent({
      repoRoot: root,
      conversationId: 'new-1',
      generationId: 'new-g-1',
      now: new Date('2026-07-01T01:00:00.000Z'),
    });

    expect(boundary.reviewTriggered).toBe(true);
    expect(boundary.reason).toMatch(/month-boundary/i);

    const paths = getWorkflowPaths(root);
    const state = loadWorkflowReviewState(paths.statePath);
    expect(state.unreviewedEventIds).toHaveLength(1);
  });

  it('ignores loop follow-ups and duplicate generations, and prefers model_id', async () => {
    const root = makeTempRoot('dedupe');
    const transcriptPath = path.join(root, 't.jsonl');
    writeJsonl(transcriptPath, [
      {
        role: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { path: 'token-efficient-engineering/SKILL.md' },
            },
            { type: 'text', text: renderWorkflowCompletionMarker(marker()) },
          ],
        },
      },
    ]);

    const loopResult = await processWorkflowStopEvent(
      {
        conversation_id: 'c1',
        generation_id: 'g1',
        model: 'composer-2.5',
        model_id: 'composer-2.5-fast',
        transcript_path: transcriptPath,
        status: 'completed',
        loop_count: 1,
      },
      { repoRoot: root, now: () => new Date('2026-07-29T12:00:00.000Z') }
    );
    expect(loopResult.createdEvent).toBe(false);

    const first = await processWorkflowStopEvent(
      {
        conversation_id: 'c1',
        generation_id: 'g1',
        model: 'composer-2.5',
        model_id: 'composer-2.5-fast',
        transcript_path: transcriptPath,
        status: 'completed',
        loop_count: 0,
      },
      { repoRoot: root, now: () => new Date('2026-07-29T12:00:00.000Z') }
    );
    expect(first.createdEvent).toBe(true);

    const duplicate = await processWorkflowStopEvent(
      {
        conversation_id: 'c1',
        generation_id: 'g1',
        model_id: 'composer-2.5-fast',
        transcript_path: transcriptPath,
        status: 'completed',
        loop_count: 0,
      },
      { repoRoot: root, now: () => new Date('2026-07-29T12:01:00.000Z') }
    );
    expect(duplicate.reason).toBe('duplicate-generation');

    const events = listWorkflowEvents(getWorkflowPaths(root).eventsDirectory);
    expect(events[0]?.selectedModel).toBe('composer-2.5-fast');
    expect(events[0]?.selectedModelSource).toBe('model_id');
    expect(events[0]?.selectedModelTier).toBe('economical');
  });

  it('creates unique pending follow-up paths and does not persist forbidden fields', async () => {
    const root = makeTempRoot('pending');
    const pending = writeMonthlyAutomationPendingFollowUp({
      scriptName: 'workflow-review',
      monthKey: '2026-07',
      reviewPath: path.join(root, 'review.md'),
      suggestionsPath: path.join(root, 'suggestions.json'),
      suggestions: [
        {
          id: 'workflow-review-demo',
          scriptName: 'workflow-review',
          title: 'Tighten explore dedupe',
          reason: 'Duplicate broad searches after explore.',
          evidence: ['transcript:duplicate-broad-search-after-explore'],
          createdMonth: '2026-07',
          lastSeenMonth: '2026-07',
          status: 'pending',
          source: 'advisor',
        },
      ],
      knowledgeDirectory: path.join(root, 'docs_private', 'automation', 'knowledge'),
      repoRoot: root,
      reviewWindowId: '202607-window1',
      promptMode: 'skip',
    });

    expect(pending.pendingPath).toContain(`${path.join('follow-ups', 'workflow-review', '2026-07', '202607-window1')}`);
    const pendingJson = JSON.parse(readFileSync(pending.pendingPath!, 'utf8')) as Record<string, unknown>;
    expect(pendingJson.reviewWindowId).toBe('202607-window1');
    expect(assertNoForbiddenPayload(pendingJson)).toEqual([]);
  });

  it('WORKSTREAM-001: carries reviewed workstreams through pending follow-up, plan, and completion state', async () => {
    const root = makeTempRoot('workstream-lineage');
    const sourceWorkstreamIds = ['ws-source-a', 'ws-source-a', 'ws-source-b', 'ws-source-c', 'ws-source-d'];
    let reviewResult: Awaited<ReturnType<typeof seedQualifyingEvent>> | undefined;
    for (const [index, workstreamId] of sourceWorkstreamIds.entries()) {
      reviewResult = await seedQualifyingEvent({
        repoRoot: root,
        conversationId: `lineage-${index}`,
        generationId: `lineage-g-${index}`,
        workstreamId,
        commit: 'pending',
        now: new Date(`2026-07-29T0${index + 1}:00:00.000Z`),
      });
    }

    expect(reviewResult?.reviewTriggered).toBe(true);
    expect(reviewResult?.pendingPath).toBeTruthy();
    const pending = JSON.parse(
      readFileSync(reviewResult!.pendingPath!, 'utf8')
    ) as PendingMonthlyFollowUp;
    expect(pending.sourceWorkstreamIds).toEqual([
      'ws-source-a',
      'ws-source-b',
      'ws-source-c',
      'ws-source-d',
    ]);

    const followUp = await runMonthlyAutomationFollowUp({
      ...pending,
      decisionProvider: (suggestion) => ({
        suggestionId: suggestion.id,
        action: 'approve',
      }),
    });
    expect(followUp.planPath).toBeTruthy();
    const planContract = extractPlanContractMarker(
      readFileSync(followUp.planPath!, 'utf8')
    ).contract;
    expect(planContract?.sourceWorkstreamIds).toEqual(pending.sourceWorkstreamIds);

    const paths = getWorkflowPaths(root);
    saveWorkflowReviewState(paths.statePath, {
      ...loadWorkflowReviewState(paths.statePath),
      pendingFollowUpPath: null,
    });
    rmSync(reviewResult!.pendingPath!, { force: true });
    const completionTranscript = path.join(root, 'transcripts', 'follow-up.jsonl');
    writeJsonl(completionTranscript, [
      {
        role: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { path: 'token-efficient-engineering/SKILL.md' },
            },
            {
              type: 'text',
              text: renderWorkflowCompletionMarker(
                markerV3({
                  taskId: planContract!.taskId,
                  workstreamId: planContract!.workstreamId,
                  sourceWorkstreamIds: planContract!.sourceWorkstreamIds,
                })
              ),
            },
          ],
        },
      },
    ]);
    await processWorkflowStopEvent(
      {
        conversation_id: 'follow-up-lineage',
        generation_id: 'follow-up-lineage-generation',
        model_id: 'gpt-5.6-sol-high',
        transcript_path: completionTranscript,
        status: 'completed',
        loop_count: 0,
      },
      { repoRoot: root, now: () => new Date('2026-07-30T01:00:00.000Z') }
    );

    expect(
      loadWorkflowReviewState(paths.statePath).workstreams?.[planContract!.workstreamId]
        ?.sourceWorkstreamIds
    ).toEqual(pending.sourceWorkstreamIds);
  });

  it('keeps event files immutable and clears stale pending follow-up blockers', async () => {
    const root = makeTempRoot('immutable');
    const paths = getWorkflowPaths(root);
    for (let index = 1; index <= WORKFLOW_REVIEW_THRESHOLD; index += 1) {
      await seedQualifyingEvent({
        repoRoot: root,
        conversationId: `imm-${index}`,
        generationId: `imm-g-${index}`,
        now: new Date(`2026-07-29T0${index}:00:00.000Z`),
      });
    }

    const before = listWorkflowEvents(paths.eventsDirectory);
    const beforeRaw = before.map((event) =>
      readFileSync(path.join(paths.eventsDirectory, `${event.generationHash}.json`), 'utf8')
    );
    const after = listWorkflowEvents(paths.eventsDirectory);
    const afterRaw = after.map((event) =>
      readFileSync(path.join(paths.eventsDirectory, `${event.generationHash}.json`), 'utf8')
    );
    expect(afterRaw).toEqual(beforeRaw);

    const state = loadWorkflowReviewState(paths.statePath);
    saveWorkflowReviewState(paths.statePath, {
      ...state,
      pendingFollowUpPath: path.join(root, 'missing-pending.json'),
      unreviewedEventIds: [],
    });

    const resumed = await seedQualifyingEvent({
      repoRoot: root,
      conversationId: 'imm-6',
      generationId: 'imm-g-6',
      now: new Date('2026-07-29T06:00:00.000Z'),
    });
    expect(resumed.reason).not.toBe('pending-follow-up-unresolved');
    expect(loadWorkflowReviewState(paths.statePath).pendingFollowUpPath).toBeNull();
  });

  it('supports thresholds 6/9/10 and unavailable model fallback', async () => {
    const root = makeTempRoot('thresholds');
    for (let index = 1; index <= 10; index += 1) {
      const result = await seedQualifyingEvent({
        repoRoot: root,
        conversationId: ` thr-${index} `,
        generationId: `thr-g-${index}`,
        now: new Date(`2026-07-${String(10 + Math.floor((index - 1) / 5)).padStart(2, '0')}T${String(index).padStart(2, '0')}:00:00.000Z`),
      });
      if (index === 5 || index === 10) {
        expect(result.reviewTriggered).toBe(true);
      } else if (index === 6 || index === 9) {
        expect(result.reviewTriggered).toBe(false);
      }
    }

    const unavailableRoot = makeTempRoot('model');
    const transcriptPath = path.join(unavailableRoot, 't.jsonl');
    writeJsonl(transcriptPath, [
      {
        role: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { path: 'token-efficient-engineering/SKILL.md' },
            },
            { type: 'text', text: renderWorkflowCompletionMarker(marker()) },
          ],
        },
      },
    ]);
    await processWorkflowStopEvent(
      {
        conversation_id: 'c-model',
        generation_id: 'g-model',
        transcript_path: transcriptPath,
        status: 'completed',
        loop_count: 0,
      },
      { repoRoot: unavailableRoot, now: () => new Date('2026-07-29T08:00:00.000Z') }
    );
    const events = listWorkflowEvents(getWorkflowPaths(unavailableRoot).eventsDirectory);
    expect(events[0]?.selectedModel).toBe('unavailable');
    expect(events[0]?.selectedModelSource).toBe('unavailable');
    expect(events[0]?.selectedModelTier).toBe('unknown');
  });

  it('rejects oversized transcripts as unknown parse errors', async () => {
    const root = makeTempRoot('oversized');
    const transcriptPath = path.join(root, 'huge.jsonl');
    writeFileSync(transcriptPath, `${'x'.repeat(8_000_001)}\n`, 'utf8');
    const parsed = await parseWorkflowTranscript(transcriptPath);
    expect(parsed.signals.parseErrors[0]).toMatch(/exceeds/i);
  });

  it('does not steal a live lock and only unlocks the owned token', () => {
    const root = makeTempRoot('live-lock');
    const paths = getWorkflowPaths(root);
    mkdirSync(path.dirname(paths.lockPath), { recursive: true });
    writeFileSync(
      paths.lockPath,
      JSON.stringify({
        pid: process.pid,
        token: 'live-owner',
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      }),
      'utf8'
    );

    expect(() =>
      withWorkflowLock(paths.lockPath, () => 1, { staleMs: 1_000, now: () => Date.now() })
    ).toThrow(/Timed out waiting for workflow-review lock/i);
    expect(existsSync(paths.lockPath)).toBe(true);
    expect(JSON.parse(readFileSync(paths.lockPath, 'utf8')).token).toBe('live-owner');

    rmSync(paths.lockPath, { force: true });
    const result = withWorkflowLock(paths.lockPath, () => {
      const owner = JSON.parse(readFileSync(paths.lockPath, 'utf8')) as { token?: string };
      expect(owner.token).toBeTruthy();
      expect(owner.token).not.toBe('live-owner');
      return 'owned';
    }, { staleMs: 1_000 });
    expect(result).toBe('owned');
    expect(existsSync(paths.lockPath)).toBe(false);
  });

  it('resolver clears workflow pending state after decisions', () => {
    const root = makeTempRoot('resolver');
    const paths = getWorkflowPaths(root);
    const pending = writeMonthlyAutomationPendingFollowUp({
      scriptName: 'workflow-review',
      monthKey: '2026-07',
      reviewPath: path.join(root, 'review.md'),
      suggestionsPath: path.join(root, 'suggestions.json'),
      suggestions: [
        {
          id: 'workflow-review-demo',
          scriptName: 'workflow-review',
          title: 'Demo',
          reason: 'Demo reason',
          evidence: ['test'],
          createdMonth: '2026-07',
          lastSeenMonth: '2026-07',
          status: 'pending',
          source: 'advisor',
        },
      ],
      knowledgeDirectory: paths.knowledgeDirectory,
      repoRoot: root,
      reviewWindowId: 'window-resolve',
      promptMode: 'skip',
    });

    saveWorkflowReviewState(paths.statePath, {
      ...loadWorkflowReviewState(paths.statePath),
      pendingFollowUpPath: pending.pendingPath!,
    });

    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.join(process.cwd(), 'scripts', 'automation', 'resolve-monthly-follow-up.ts'),
        '--pending',
        pending.pendingPath!,
        '--decision',
        'workflow-review-demo=skip',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
      }
    );
    expect(result.status).toBe(0);
    expect(existsSync(pending.pendingPath!)).toBe(false);
    expect(existsSync(`${pending.pendingPath!}.resolved`)).toBe(true);
    expect(loadWorkflowReviewState(paths.statePath).pendingFollowUpPath).toBeNull();
  });
});

describe('TEE telemetry v3 coverage', () => {
  function emptySignals(): WorkflowTranscriptSignals {
    return {
      adapterVersion: '2',
      skillRead: false,
      architectureGateTask: false,
      finalDiffReviewerTask: false,
      exploreTask: false,
      truncatedShellEvidence: false,
      bulkInsertionScriptEvidence: false,
      duplicateBroadSearchAfterExplore: false,
      gitCommitEvidence: false,
      markerPresent: true,
      planContractPresent: false,
      planPathSource: 'unavailable',
      planPathRef: null,
      parseErrors: [],
    };
  }

  it('EVENT-002: event v2 writes are additive and leave existing event bytes immutable', () => {
    const root = makeTempRoot('event-v2');
    const paths = getWorkflowPaths(root);
    const v1: WorkflowStopEvent = {
      schemaVersion: '1',
      eventId: 'event-v1',
      recordedAt: '2026-08-01T00:00:00.000Z',
      conversationHash: 'c1',
      generationHash: 'gen-v1',
      selectedModel: 'composer-2.5',
      selectedModelSource: 'model',
      selectedModelTier: 'economical',
      status: 'completed',
      loopCount: 0,
      qualifies: true,
      qualificationReasons: ['marker'],
      marker: marker({ taskId: 'legacy' }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
      findings: [],
      monthKey: '2026-08',
    };
    const first = writeWorkflowEvent(paths.eventsDirectory, v1);
    expect(first.created).toBe(true);
    const before = readFileSync(first.path, 'utf8');

    const v2: WorkflowStopEvent = {
      ...v1,
      schemaVersion: '2',
      eventId: 'event-v2',
      generationHash: 'gen-v2',
      workstreamId: 'ws_event',
      planRecommendationAdherence: 'unknown',
      registryVersion: '2',
    };
    writeWorkflowEvent(paths.eventsDirectory, v2);
    const secondWrite = writeWorkflowEvent(paths.eventsDirectory, {
      ...v1,
      marker: marker({ taskId: 'mutated' }),
    });
    expect(secondWrite.created).toBe(false);
    expect(readFileSync(first.path, 'utf8')).toBe(before);
    expect(listWorkflowEvents(paths.eventsDirectory).map((event) => event.schemaVersion).sort()).toEqual([
      '1',
      '2',
    ]);
  });

  it('MODEL-ADHERENCE-001: matched, deviated, mismatch, and unknown routing are distinguished', () => {
    const recommendedEconomical = markerV3({
      recommendedBuildModel: {
        implementation: {
          role: 'economical-default',
          tier: 'economical',
          family: 'cursor-grok',
        },
        premiumGates: [],
        switchTiming: 'after_plan_approval',
        rationale: 'Use economical implementation.',
        fallbackEscalation: 'Escalate on repeated failure.',
      },
    });
    expect(computePlanRecommendationAdherence(recommendedEconomical, 'economical')).toBe('matched');
    expect(computePlanRecommendationAdherence(recommendedEconomical, 'premium')).toBe('deviated');
    expect(computePlanRecommendationAdherence(recommendedEconomical, 'unknown')).toBe('unknown');

    const mismatchFindings = buildWorkflowFindings({
      marker: markerV3({
        executionParentTier: 'premium',
        recommendedBuildModel: recommendedEconomical.recommendedBuildModel,
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
      observedParentTier: 'economical',
      planRecommendationAdherence: 'matched',
    });
    expect(mismatchFindings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(['parent-tier-mismatch'])
    );

    const deviationFindings = buildWorkflowFindings({
      marker: recommendedEconomical,
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
      observedParentTier: 'premium',
      planRecommendationAdherence: 'deviated',
    });
    expect(deviationFindings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(['plan-model-mismatch'])
    );
  });

  it('REVIEW-CHURN-001: deduplicates premium re-review passes and flags more than two advisories', () => {
    const findings = buildWorkflowFindings({
      marker: markerV3({
        reviewPasses: [
          {
            passId: 'final-1',
            stage: 'final-diff-reviewer',
            source: 'independent_subagent',
            tier: 'premium',
            iteration: 2,
            result: 'failed',
          },
          {
            passId: 'final-1',
            stage: 'final-diff-reviewer',
            source: 'independent_subagent',
            tier: 'premium',
            iteration: 2,
            result: 'failed',
          },
          {
            passId: 'final-2',
            stage: 'final-diff-reviewer',
            source: 'independent_subagent',
            tier: 'premium',
            iteration: 3,
            result: 'failed',
          },
          {
            passId: 'final-3',
            stage: 'final-diff-reviewer',
            source: 'independent_subagent',
            tier: 'premium',
            iteration: 4,
            result: 'failed',
          },
        ],
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
      observedParentTier: 'economical',
    });
    const churn = findings.find((finding) => finding.id === 'excessive-premium-rereviews');
    expect(churn).toBeTruthy();
    expect(churn?.severity).toBe('warning');
    expect(churn?.detail).toMatch(/advisory/i);
  });

  it('MONTHLY-002: metrics report adherence and churn while treating legacy evidence as unknown', () => {
    const legacy: WorkflowStopEvent = {
      schemaVersion: '1',
      eventId: 'legacy',
      recordedAt: '2026-08-01T00:00:00.000Z',
      conversationHash: 'c',
      generationHash: 'g-legacy',
      selectedModel: 'composer-2.5',
      selectedModelSource: 'model',
      selectedModelTier: 'economical',
      status: 'completed',
      loopCount: 0,
      qualifies: true,
      qualificationReasons: ['marker'],
      marker: marker({ taskType: 'planning', taskId: 'legacy-plan' }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
      findings: [],
      monthKey: '2026-08',
    };
    const modern: WorkflowStopEvent = {
      ...legacy,
      schemaVersion: '2',
      eventId: 'modern',
      generationHash: 'g-modern',
      planRecommendationAdherence: 'matched',
      registryVersion: '2',
      reviewPasses: [
        {
          passId: 'a',
          stage: 'final-diff-reviewer',
          source: 'independent_subagent',
          tier: 'premium',
          iteration: 2,
          result: 'failed',
        },
        {
          passId: 'b',
          stage: 'final-diff-reviewer',
          source: 'independent_subagent',
          tier: 'premium',
          iteration: 3,
          result: 'failed',
        },
        {
          passId: 'c',
          stage: 'final-diff-reviewer',
          source: 'independent_subagent',
          tier: 'premium',
          iteration: 4,
          result: 'failed',
        },
      ],
      marker: markerV3({ taskType: 'planning', taskId: 'modern-plan' }),
      transcriptSignals: {
        ...emptySignals(),
        planContractPresent: true,
      },
    };

    const metrics = buildWorkflowReviewMetrics([legacy, modern]);
    expect(metrics.recommendationAdherenceCounts?.unknown).toBe(1);
    expect(metrics.recommendationAdherenceCounts?.matched).toBe(1);
    expect(metrics.premiumReReviewFlagCount).toBe(1);
    expect(metrics.registryVersionCounts?.unknown).toBe(1);
    expect(metrics.registryVersionCounts?.['2']).toBe(1);
    expect(metrics.planContractPresentCount).toBe(1);
    expect(metrics.planContractMissingCount).toBe(1);
  });

  it('FINAL-REVIEW-001: high-risk markers without independent final review remain failed findings', () => {
    const findings = buildWorkflowFindings({
      marker: markerV3({
        risk: 'high',
        finalReviewRequired: true,
        finalReview: 'skipped',
        finalReviewSource: 'independent_subagent',
        architectureGate: 'approved',
        architectureReviewSource: 'independent_subagent',
        independentReviewRequired: true,
        independentReviewReasons: ['broad-regression'],
        requiredTests: [{ id: 'FINAL-REVIEW-001', status: 'completed' }],
        executionParentTier: 'economical',
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
      observedParentTier: 'economical',
    });
    expect(findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(['missing-final-review'])
    );
  });
});