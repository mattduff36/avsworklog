import { spawnSync } from 'child_process';
import type {
  WorkflowFinaliseCorrelation,
  WorkflowReviewState,
  WorkflowWorkstreamRecord,
} from './types';
import {
  upsertWorkstreamRecord,
  writeJsonAtomic,
} from './workflow-events';
import {
  getActiveFinaliseContext,
  getProtocolRecordPath,
  isWorkflowProtocolRecord,
  readProtocolRecord,
} from './workflow-review-protocol';

function runGit(repoRoot: string, args: string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim();
}

export function isGitAncestor(params: {
  repoRoot: string;
  ancestorCommit: string;
  descendantCommit: string;
}): boolean {
  if (!params.ancestorCommit || !params.descendantCommit) return false;
  if (params.ancestorCommit === params.descendantCommit) return true;
  const result = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', params.ancestorCommit, params.descendantCommit],
    {
      cwd: params.repoRoot,
      encoding: 'utf8',
      shell: false,
    }
  );
  return result.status === 0;
}

export function resolveFinaliseWorkstreamMatches(params: {
  state: WorkflowReviewState;
  repoRoot: string;
  branchName: string;
  headCommit: string;
}): {
  correlation: WorkflowFinaliseCorrelation;
  matched: WorkflowWorkstreamRecord[];
} {
  const active = getActiveFinaliseContext(params.state);
  if (active) {
    const record = params.state.workstreams?.[active.workstreamId];
    if (record) {
      return {
        matched: [record],
        correlation: {
          workstreamIds: [record.workstreamId],
          matchedBy: 'explicit_context',
          branchName: params.branchName,
          headCommit: params.headCommit,
          resultingCommit: null,
          identityStatus: 'present',
          checkpointId: active.checkpointId,
        },
      };
    }
    return {
      matched: [],
      correlation: {
        workstreamIds: [],
        matchedBy: 'none',
        branchName: params.branchName,
        headCommit: params.headCommit,
        resultingCommit: null,
        identityStatus: 'missing',
        checkpointId: active.checkpointId,
      },
    };
  }

  // No branch/ancestry heuristics. Without an explicit active finalise context,
  // finalise remains uncorrelated.
  return {
    matched: [],
    correlation: {
      workstreamIds: [],
      matchedBy: 'none',
      branchName: params.branchName,
      headCommit: params.headCommit,
      resultingCommit: null,
      identityStatus: 'missing',
      checkpointId: null,
    },
  };
}

export function applyFinaliseCorrelationToState(params: {
  state: WorkflowReviewState;
  matched: WorkflowWorkstreamRecord[];
  finaliseRunId: string;
  finaliseOutcome: 'passed' | 'failed' | 'unknown';
  resultingCommit: string | null;
  repoRoot?: string;
}): WorkflowReviewState {
  let next = params.state;
  const now = new Date().toISOString();
  for (const record of params.matched) {
    next = upsertWorkstreamRecord(next, {
      ...record,
      status: params.finaliseOutcome === 'passed' ? 'finalised' : record.status,
      finaliseRunId: params.finaliseRunId,
      finaliseOutcome: params.finaliseOutcome,
      finaliseCommit: params.resultingCommit ?? undefined,
      updatedAt: now,
    });

    if (params.finaliseOutcome === 'passed' && params.repoRoot) {
      const protocol = readProtocolRecord(params.repoRoot, record.workstreamId);
      if (protocol && isWorkflowProtocolRecord(protocol)) {
        const finalized = {
          ...protocol,
          phase: 'finalised' as const,
          nextAction: 'done',
          activeCheckpointId: null,
          updatedAt: now,
        };
        writeJsonAtomic(getProtocolRecordPath(params.repoRoot, record.workstreamId), finalized);
        next = {
          ...next,
          protocolRecords: {
            ...(next.protocolRecords ?? {}),
            [record.workstreamId]: finalized,
          },
        };
      }
    }
  }

  if (
    params.finaliseOutcome === 'passed' &&
    next.activeFinaliseContext &&
    params.matched.some(
      (record) => record.workstreamId === next.activeFinaliseContext?.workstreamId
    )
  ) {
    next = {
      ...next,
      activeFinaliseContext: null,
    };
  }

  return next;
}

export function correlateFinaliseRun(params: {
  state: WorkflowReviewState;
  repoRoot: string;
  finaliseRunId: string;
  finaliseOutcome: 'passed' | 'failed' | 'unknown';
  resultingCommit?: string | null;
}): {
  state: WorkflowReviewState;
  correlation: WorkflowFinaliseCorrelation;
} {
  const branchName =
    runGit(params.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown';
  const headCommit = runGit(params.repoRoot, ['rev-parse', 'HEAD']) ?? '';
  const resultingCommit = params.resultingCommit ?? headCommit;
  const { matched, correlation } = resolveFinaliseWorkstreamMatches({
    state: params.state,
    repoRoot: params.repoRoot,
    branchName,
    headCommit,
  });

  return {
    state: applyFinaliseCorrelationToState({
      state: params.state,
      matched,
      finaliseRunId: params.finaliseRunId,
      finaliseOutcome: params.finaliseOutcome,
      resultingCommit,
      repoRoot: params.repoRoot,
    }),
    correlation: {
      ...correlation,
      resultingCommit,
    },
  };
}
