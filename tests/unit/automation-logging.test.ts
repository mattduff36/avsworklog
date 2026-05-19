import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { renderAutomationAdvisorReview } from '@/scripts/automation/advisor-review';
import { redactSensitiveText } from '@/scripts/automation/logger';
import { updateAutomationMemory } from '@/scripts/automation/memory';
import { reviewAutomationRun } from '@/scripts/automation/self-review';
import type { AutomationMemory, AutomationMemorySuggestion, AutomationRunLog } from '@/scripts/automation/types';

function createRunLog(overrides: Partial<AutomationRunLog> = {}): AutomationRunLog {
  return {
    id: overrides.id ?? 'run-1',
    scriptName: overrides.scriptName ?? 'test-script',
    mode: overrides.mode ?? 'test',
    args: overrides.args ?? [],
    startedAt: overrides.startedAt ?? '2026-05-01T00:00:00.000Z',
    endedAt: overrides.endedAt ?? '2026-05-01T00:00:01.000Z',
    durationMs: overrides.durationMs ?? 1000,
    status: overrides.status ?? 'passed',
    metadata: {
      branch: 'feature/test',
      commit: 'abc123',
      dirtyFileCount: 0,
      nodeVersion: 'v20.0.0',
      npmVersion: '10.0.0',
      platform: 'test',
    },
    expectedArtifacts: [],
    artifacts: overrides.artifacts ?? [],
    steps: overrides.steps ?? [
      {
        name: 'sample step',
        status: overrides.status ?? 'passed',
        startedAt: '2026-05-01T00:00:00.000Z',
        endedAt: '2026-05-01T00:00:01.000Z',
        durationMs: 1000,
      },
    ],
    error: overrides.error,
  };
}

describe('automation logging helpers', () => {
  it('redacts common secrets from command output', () => {
    const output = redactSensitiveText([
      'POSTGRES_URL_NON_POOLING=postgres://user:secret-password@example.com/db',
      'Authorization: Bearer abc.def.ghi',
      'SUPABASE_SERVICE_ROLE_KEY=super-secret',
      'password: plain-text',
    ].join('\n'));

    expect(output).not.toContain('secret-password');
    expect(output).not.toContain('abc.def.ghi');
    expect(output).not.toContain('super-secret');
    expect(output).not.toContain('plain-text');
    expect(output).toContain('[REDACTED]');
  });

  it('creates a monthly review and suggests action for repeated failures', () => {
    const root = path.join(tmpdir(), `automation-review-${process.pid}-${Date.now()}`);
    const runDirectory = path.join(root, 'runs');
    const reviewsDirectory = path.join(root, 'reviews');
    mkdirSync(runDirectory, { recursive: true });

    const logs = [
      createRunLog({ id: 'run-1', status: 'failed', startedAt: '2026-05-03T00:00:00.000Z', error: 'one' }),
      createRunLog({ id: 'run-2', status: 'failed', startedAt: '2026-05-02T00:00:00.000Z', error: 'two' }),
      createRunLog({ id: 'run-3', status: 'failed', startedAt: '2026-05-01T00:00:00.000Z', error: 'three' }),
    ];

    for (const log of logs) {
      writeFileSync(path.join(runDirectory, `${log.id}.json`), JSON.stringify(log), 'utf8');
    }

    try {
      const summary = reviewAutomationRun({
        runDirectory,
        reviewsDirectory,
        latestLog: logs[0],
      });

      expect(summary.recentFailureCount).toBe(3);
      expect(summary.monthlyReviewGenerated).toBe(true);
      expect(summary.monthlyReviewPath).toBeTruthy();
      expect(summary.monthlyPromptPath).toBeTruthy();
      expect(summary.advisorReviewPath).toBeTruthy();
      expect(summary.suggestions.some((suggestion) => suggestion.severity === 'action')).toBe(true);
      expect(existsSync(summary.monthlyPromptPath!)).toBe(true);
      expect(existsSync(path.join(path.dirname(summary.monthlyReviewPath!), 'review-prompt.md'))).toBe(true);
      expect(existsSync(path.join(path.dirname(summary.monthlyReviewPath!), 'metrics.json'))).toBe(true);
      expect(existsSync(path.join(path.dirname(summary.monthlyReviewPath!), 'suggestions.json'))).toBe(true);
      expect(existsSync(path.join(root, 'knowledge', 'test-script-memory.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders finalise advisor sections with mode and slow step guidance', () => {
    const review = renderAutomationAdvisorReview({
      advisorDirectory: '/tmp/not-used',
      scriptName: 'finalise',
      generatedAt: '2026-05-19T00:00:00.000Z',
      monthKey: '2026-05',
      logs: [
        createRunLog({
          id: 'finalise-1',
          scriptName: 'finalise',
          mode: 'standard',
          startedAt: '2026-05-19T00:00:00.000Z',
          durationMs: 180_000,
          steps: [
            {
              name: 'npm run build',
              status: 'passed',
              startedAt: '2026-05-19T00:00:00.000Z',
              endedAt: '2026-05-19T00:03:00.000Z',
              durationMs: 180_000,
              command: 'npm run build',
            },
          ],
        }),
        createRunLog({
          id: 'finalise-2',
          scriptName: 'finalise',
          mode: 'dry-run',
          args: ['--dry-run'],
          startedAt: '2026-05-19T00:05:00.000Z',
          durationMs: 1000,
          steps: [],
        }),
      ],
    });

    expect(review).toContain('## Executive Summary');
    expect(review).toContain('## Suggested Script Improvements');
    expect(review).toContain('standard: 1 run(s)');
    expect(review).toContain('dry-run: 1 run(s)');
    expect(review).toContain('Builds average 3.0m');
    expect(review).toContain('## Copy/Paste Cursor Prompt');
  });

  it('renders fixerrors advisor sections with fetch and pattern guidance', () => {
    const topPattern = {
      errorType: 'Error',
      component: 'Console',
      normalizedMessage: 'Repeated production failure',
      occurrences: 3,
      sourceFiles: ['app/api/example/route.ts'],
    };
    const review = renderAutomationAdvisorReview({
      advisorDirectory: '/tmp/not-used',
      scriptName: 'fixerrors',
      generatedAt: '2026-05-19T00:00:00.000Z',
      monthKey: '2026-05',
      logs: [
        createRunLog({
          id: 'fixerrors-1',
          scriptName: 'fixerrors',
          mode: 'analysis',
          startedAt: '2026-05-19T00:00:00.000Z',
          steps: [
            {
              name: 'Write error analysis report',
              status: 'passed',
              startedAt: '2026-05-19T00:00:00.000Z',
              endedAt: '2026-05-19T00:00:01.000Z',
              durationMs: 1000,
              metadata: {
                totalFetched: 200,
                filteredOut: 190,
                afterFiltering: 10,
                patternsFound: 2,
                topPatterns: [topPattern],
              },
            },
            {
              name: 'Summarise historical error fix log',
              status: 'passed',
              startedAt: '2026-05-19T00:00:01.000Z',
              endedAt: '2026-05-19T00:00:01.000Z',
              durationMs: 0,
              metadata: {
                totalEntries: 4,
                statusCounts: { untriaged: 2, stale: 1, resolved: 1 },
              },
            },
          ],
        }),
      ],
    });

    expect(review).toContain('Total fetched: 200');
    expect(review).toContain('The 200-log fetch limit was hit');
    expect(review).toContain('filtered more than 75%');
    expect(review).toContain('untriaged');
    expect(review).toContain('## Copy/Paste Cursor Prompt');
  });

  it('preserves human-edited suggestion statuses when memory is updated', () => {
    const existingSuggestion: AutomationMemorySuggestion = {
      id: 'finalise-record-commit-outcome-metadata',
      scriptName: 'finalise',
      title: 'Record explicit commit created/skipped metadata',
      reason: 'Human approved this suggestion.',
      evidence: ['manual review'],
      createdMonth: '2026-05',
      lastSeenMonth: '2026-05',
      status: 'approved',
      statusReason: 'Worth doing',
      source: 'advisor',
    };
    const memory: AutomationMemory = {
      version: '1.0.0',
      scriptName: 'finalise',
      updatedAt: '2026-05-01T00:00:00.000Z',
      suggestions: [existingSuggestion],
      prompts: [],
      monthlyMetrics: [],
    };

    const updated = updateAutomationMemory({
      memory,
      metrics: {
        scriptName: 'finalise',
        month: '2026-06',
        generatedAt: '2026-06-01T00:00:00.000Z',
        runCount: 1,
        failureCount: 0,
        averageDurationMs: 1000,
        modeCounts: { standard: 1 },
      },
      prompt: {
        month: '2026-06',
        focusAreas: ['commit metadata'],
        deprioritizedAreas: [],
        prompt: 'Focus on commit metadata.',
      },
      suggestions: [{
        ...existingSuggestion,
        reason: 'Generated again from logs.',
        evidence: ['No git commit command steps found in reviewed logs.'],
        createdMonth: '2026-06',
        lastSeenMonth: '2026-06',
        status: 'pending',
      }],
    });

    expect(updated.suggestions[0].status).toBe('approved');
    expect(updated.suggestions[0].statusReason).toBe('Worth doing');
    expect(updated.suggestions[0].createdMonth).toBe('2026-05');
    expect(updated.suggestions[0].lastSeenMonth).toBe('2026-06');
    expect(updated.suggestions[0].evidence).toContain('manual review');
    expect(updated.suggestions[0].evidence).toContain('No git commit command steps found in reviewed logs.');
  });

  it('uses previous prompt context in evolved review prompts', () => {
    const review = renderAutomationAdvisorReview({
      advisorDirectory: '/tmp/not-used',
      scriptName: 'finalise',
      generatedAt: '2026-06-01T00:00:00.000Z',
      monthKey: '2026-06',
      previousPromptText: 'Previous prompt focused on build timing.',
      previousMetrics: {
        scriptName: 'finalise',
        month: '2026-05',
        generatedAt: '2026-05-01T00:00:00.000Z',
        runCount: 2,
        failureCount: 1,
        averageDurationMs: 1000,
        modeCounts: { standard: 2 },
      },
      logs: [
        createRunLog({
          id: 'finalise-2',
          scriptName: 'finalise',
          mode: 'standard',
          startedAt: '2026-06-01T00:00:00.000Z',
          steps: [],
        }),
      ],
    });

    expect(review).toContain('## Previous Advice And Outcomes');
    expect(review).toContain('Review the advisor report for finalise');
  });
});
