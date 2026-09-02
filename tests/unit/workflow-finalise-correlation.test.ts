import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import {
  applyFinaliseCorrelationToState,
  correlateFinaliseRun,
  resolveFinaliseWorkstreamMatches,
  shouldApplyFinaliseCorrelation,
} from '@/scripts/automation/workflow-finalise-correlation';
import {
  createEmptyWorkflowReviewState,
  upsertWorkstreamRecord,
} from '@/scripts/automation/workflow-events';
import type { WorkflowWorkstreamRecord } from '@/scripts/automation/types';
import {
  classifyWorkflowModelTier,
  getWorkflowModelRole,
  resolveWorkflowModelRoleKey,
  WORKFLOW_MODEL_TIER_REGISTRY_VERSION,
} from '@/scripts/automation/workflow-model-tier';
import {
  correlateFinaliseAutomationRun,
  readPostRunGitIdentity,
} from '@/scripts/automation/logger';

function openWorkstream(
  workstreamId: string,
  branchName: string,
  headCommit: string | null = null
): WorkflowWorkstreamRecord {
  return {
    workstreamId,
    branchName,
    headCommit,
    taskIds: [`task-${workstreamId}`],
    eventIds: [`event-${workstreamId}`],
    status: 'open',
    updatedAt: new Date().toISOString(),
  };
}

describe('workflow finalise correlation and registry', () => {
  it('REGISTRY-001: role keys resolve and unknown IDs stay unknown', () => {
    expect(WORKFLOW_MODEL_TIER_REGISTRY_VERSION).toBe('2');
    expect(getWorkflowModelRole('economical-default')?.defaultModelId).toBe('cursor-grok-4.5');
    expect(getWorkflowModelRole('premium-fix-routing')?.tier).toBe('premium');
    expect(classifyWorkflowModelTier('cursor-grok-4.5')).toBe('economical');
    expect(classifyWorkflowModelTier('gpt-5.6-sol-high')).toBe('premium');
    expect(classifyWorkflowModelTier('brand-new-model-xyz')).toBe('unknown');
    expect(resolveWorkflowModelRoleKey('unknown-model')).toBe('unknown');
  });

  it('FINALISE-CORR-001: correlates zero, one, and multiple open workstreams and records resulting commit', () => {
    let state = createEmptyWorkflowReviewState();
    state = upsertWorkstreamRecord(state, openWorkstream('ws-a', 'main', 'abc'));
    state = upsertWorkstreamRecord(state, openWorkstream('ws-b', 'main', 'abc'));
    state = upsertWorkstreamRecord(state, openWorkstream('ws-other', 'feature/x', 'abc'));

    const none = resolveFinaliseWorkstreamMatches({
      state: createEmptyWorkflowReviewState(),
      repoRoot: process.cwd(),
      branchName: 'main',
      headCommit: 'abc',
    });
    expect(none.correlation.matchedBy).toBe('none');
    expect(none.matched).toHaveLength(0);

    // Null headCommit must not match any finish-time HEAD (no branch-wide inference).
    const nullHeadState = upsertWorkstreamRecord(
      createEmptyWorkflowReviewState(),
      openWorkstream('ws-null', 'main', null)
    );
    const nullHead = resolveFinaliseWorkstreamMatches({
      state: nullHeadState,
      repoRoot: process.cwd(),
      branchName: 'main',
      headCommit: 'abc',
    });
    expect(nullHead.correlation.matchedBy).toBe('none');

    // Ancestry heuristics are disabled: without explicit activeFinaliseContext, no match.
    const singleState = upsertWorkstreamRecord(
      createEmptyWorkflowReviewState(),
      openWorkstream('ws-only', 'main', 'abc')
    );
    const single = resolveFinaliseWorkstreamMatches({
      state: singleState,
      repoRoot: process.cwd(),
      branchName: 'main',
      headCommit: 'abc',
    });
    expect(single.correlation.matchedBy).toBe('none');
    expect(single.correlation.identityStatus).toBe('missing');
    expect(single.correlation.workstreamIds).toEqual([]);

    const multiple = resolveFinaliseWorkstreamMatches({
      state,
      repoRoot: process.cwd(),
      branchName: 'main',
      headCommit: 'abc',
    });
    expect(multiple.correlation.matchedBy).toBe('none');
    expect(multiple.correlation.workstreamIds).toEqual([]);

    const applied = applyFinaliseCorrelationToState({
      state,
      matched: [
        openWorkstream('ws-a', 'main', 'abc'),
        openWorkstream('ws-b', 'main', 'abc'),
      ],
      finaliseRunId: 'run-1',
      finaliseOutcome: 'passed',
      resultingCommit: 'def456',
    });
    expect(applied.workstreams?.['ws-a']?.status).toBe('finalised');
    expect(applied.workstreams?.['ws-b']?.finaliseRunId).toBe('run-1');
    expect(applied.workstreams?.['ws-a']?.finaliseCommit).toBe('def456');
    expect(applied.workstreams?.['ws-other']?.status).toBe('open');

    const staleStartCommit = '0000000000000000000000000000000000000000';
    const identity = readPostRunGitIdentity();
    const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: false,
    });
    expect(gitHead.status).toBe(0);
    const currentHead = (gitHead.stdout ?? '').trim();
    expect(identity.headCommit).toBe(currentHead);
    expect(identity.headCommit).not.toBe(staleStartCommit);

    const correlated = correlateFinaliseRun({
      state: singleState,
      repoRoot: process.cwd(),
      finaliseRunId: 'run-finish',
      finaliseOutcome: 'passed',
      // Logger must omit constructor-time commit so correlation reads finish-time HEAD.
    });
    expect(correlated.correlation.resultingCommit).toBe(currentHead);
    expect(correlated.correlation.resultingCommit).not.toBe(staleStartCommit);

    expect(
      correlateFinaliseAutomationRun({
        scriptName: 'fixerrors',
        status: 'passed',
        runId: 'not-finalise',
        state: singleState,
      })
    ).toBeUndefined();
    const loggerCorrelation = correlateFinaliseAutomationRun({
      scriptName: 'finalise',
      status: 'passed',
      runId: 'logger-finish',
      state: singleState,
    });
    expect(loggerCorrelation?.resultingCommit).toBe(currentHead);
    expect(loggerCorrelation?.resultingCommit).not.toBe(staleStartCommit);
  });

  it('WORKSTREAM-001: workstream records preserve task and event lineage', () => {
    let state = createEmptyWorkflowReviewState();
    state = upsertWorkstreamRecord(state, openWorkstream('ws-1', 'main', 'aaa'));
    state = upsertWorkstreamRecord(state, {
      ...openWorkstream('ws-1', 'main', 'bbb'),
      taskIds: ['task-2'],
      eventIds: ['event-2'],
      sourceWorkstreamIds: ['ws-source'],
    });
    expect(state.workstreams?.['ws-1']?.taskIds.sort()).toEqual(['task-2', 'task-ws-1']);
    expect(state.workstreams?.['ws-1']?.eventIds.sort()).toEqual(['event-2', 'event-ws-1']);
    expect(state.workstreams?.['ws-1']?.sourceWorkstreamIds).toEqual(['ws-source']);
    expect(state.schemaVersion).toBe('2');
  });

  it('skips correlation on dry-run', () => {
    expect(
      shouldApplyFinaliseCorrelation({
        scriptName: 'finalise',
        mode: 'dry-run',
        args: ['--dry-run'],
      })
    ).toBe(false);
    expect(shouldApplyFinaliseCorrelation({ scriptName: 'finalise' })).toBe(true);
  });
});
