import { spawnSync } from 'child_process';
import type {
  WorkflowFinaliseCorrelation,
  WorkflowReviewState,
  WorkflowWorkstreamRecord,
} from './types';
import {
  listOpenWorkstreamsForBranch,
  upsertWorkstreamRecord,
} from './workflow-events';

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
  const openOnBranch = listOpenWorkstreamsForBranch(params.state, params.branchName);
  const matched = openOnBranch.filter((record) => {
    if (!record.headCommit) return true;
    return isGitAncestor({
      repoRoot: params.repoRoot,
      ancestorCommit: record.headCommit,
      descendantCommit: params.headCommit,
    });
  });

  let matchedBy: WorkflowFinaliseCorrelation['matchedBy'] = 'none';
  if (matched.length === 1) matchedBy = 'branch_ancestry';
  if (matched.length > 1) matchedBy = 'multiple';

  return {
    matched,
    correlation: {
      workstreamIds: matched.map((record) => record.workstreamId),
      matchedBy,
      branchName: params.branchName,
      headCommit: params.headCommit,
      resultingCommit: null,
    },
  };
}

export function applyFinaliseCorrelationToState(params: {
  state: WorkflowReviewState;
  matched: WorkflowWorkstreamRecord[];
  finaliseRunId: string;
  finaliseOutcome: 'passed' | 'failed' | 'unknown';
  resultingCommit: string | null;
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
    }),
    correlation: {
      ...correlation,
      resultingCommit,
    },
  };
}
