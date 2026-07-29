import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { writeMonthlyAutomationPendingFollowUp } from '@/scripts/automation/monthly-follow-up';
import {
  WORKFLOW_REVIEW_THRESHOLD,
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
import { assertNoForbiddenPayload, hashIdentifier, sanitizeEvidenceLabel } from '@/scripts/automation/workflow-privacy';
import { parseWorkflowTranscript } from '@/scripts/automation/workflow-transcript';
import { processWorkflowStopEvent } from '@/scripts/automation/workflow-review';
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
  return {
    schemaVersion: '1',
    taskId: overrides.taskId ?? 'task-1',
    taskType: overrides.taskType ?? 'change',
    risk: overrides.risk ?? 'routine',
    exploreCanonical: overrides.exploreCanonical ?? true,
    architectureGate: overrides.architectureGate ?? 'skipped',
    requiredTests: overrides.requiredTests ?? [],
    unresolvedRisks: overrides.unresolvedRisks ?? [],
    verification: overrides.verification ?? 'passed',
    finalReview: overrides.finalReview ?? 'skipped',
    commit: overrides.commit ?? 'completed',
    handoff: overrides.handoff ?? 'completed',
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

  it('rejects malformed markers and missing markers', () => {
    expect(extractWorkflowCompletionMarker('no marker here').status).toBe('missing');
    expect(validateWorkflowCompletionMarker({ schemaVersion: '1' }).status).toBe('malformed');
    expect(
      extractWorkflowCompletionMarker('<!-- workflow-completion-marker:v1\n{not-json}\n-->').status
    ).toBe('malformed');
  });
});

describe('workflow-privacy', () => {
  it('hashes identifiers and redacts sensitive labels', () => {
    expect(hashIdentifier('conversation-a')).toBe(
      createHash('sha256').update('conversation-a').digest('hex').slice(0, 32)
    );
    expect(sanitizeEvidenceLabel('email user@example.com path C:\\Users\\mattd\\secret')).not.toContain(
      'user@example.com'
    );
    expect(assertNoForbiddenPayload({ user_email: 'x@y.com' })).toContain('user_email must not be persisted');
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
});

describe('workflow-findings', () => {
  const emptySignals = (): WorkflowTranscriptSignals => ({
    adapterVersion: '1',
    skillRead: false,
    architectureGateTask: false,
    finalDiffReviewerTask: false,
    exploreTask: false,
    truncatedShellEvidence: false,
    bulkInsertionScriptEvidence: false,
    duplicateBroadSearchAfterExplore: false,
    gitCommitEvidence: false,
    markerPresent: false,
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
      marker: marker({
        taskType: 'planning',
        commit: 'not_applicable',
        handoff: 'completed',
        verification: 'passed',
      }),
      markerStatus: 'present',
      transcriptSignals: emptySignals(),
    });
    expect(findings.some((finding) => finding.id === 'incomplete-commit')).toBe(false);
    expect(findings.some((finding) => finding.id === 'no-issues')).toBe(true);

    const estimate = estimatePremiumTokenReduction([
      { marker: marker({ risk: 'high' }) },
      { marker: marker({ risk: 'routine' }) },
      { marker: null },
    ]);
    expect(estimate.confidence).toBe('low');
    expect(estimate.highPercent).toBeGreaterThanOrEqual(estimate.lowPercent);
  });
});

describe('workflow events and lock', () => {
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
                  risk: params.risk ?? 'routine',
                  architectureGate: params.risk === 'high' ? 'approved' : 'skipped',
                  finalReview: params.risk === 'high' ? 'passed' : 'skipped',
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
