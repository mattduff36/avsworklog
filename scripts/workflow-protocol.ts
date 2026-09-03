#!/usr/bin/env tsx
import {
  WORKFLOW_ROUTING_REQUIRED_EXIT_CODE,
  applyProtocolTransition,
  type WorkflowProtocolCommand,
} from './automation/workflow-review-protocol';
import {
  formatFinaliseProtocolReadinessReport,
  getFinaliseProtocolReadiness,
} from './automation/workflow-finalise-correlation';
import { applyLegacyReconciliation } from './automation/workflow-legacy-reconciliation';
import type {
  WorkflowProtocolReviewPass,
  WorkflowRouteDispositionTarget,
} from './automation/types';

function printUsage(): void {
  process.stdout.write(`Usage:
  npx tsx scripts/workflow-protocol.ts <command> [options]

Commands:
  init --workstream <id> [--plan <path>] [--base-commit <sha>]
  preflight-record --workstream <id> --manifest <path>
  review-start --workstream <id> --pass first|closure|delta
  review-record --workstream <id> --token <token> --result passed|failed \\
    [--blocker-families a,b] [--blocker-ids a,b] [--sibling-surfaces a,b]
  fix-record --workstream <id> --manifest <path> [--closed-blocker-ids a,b]
  fix-delta-refresh --workstream <id> --manifest <path> --closed-blocker-ids a,b
  exhaustion-acknowledge --workstream <id>
  # leftover route uses --disposition already_in_release; it is not approval or finalise
  split --workstream <id> --new-workstream <id> [--narrower-partition] [--has-fix-delta]
  route --workstream <id> --disposition removed_from_release|reverted|superseded|rehomed|already_in_release \\
    --reason <text> [--implementation-commits a,b] [--revert-commit <sha>] \\
    [--supersede-commit <sha>] [--successor-repo <path>] [--successor-branch <name>] \\
    [--successor-baseline <sha>] [--predecessor-head <sha>]
  rehome-bind --workstream <id> --predecessor-root <id> --predecessor-descendant <id> \\
    --predecessor-head <sha> --predecessor-release-context <text> \\
    --successor-baseline <sha> --successor-branch <name> \\
    --source-patch-sha256 <hex> --source-fingerprint <hex> \\
    --source-release-context <path#branch> --source-head <sha> --source-baseline <sha> \\
    --source-review-workstream <id>
  finalise-start --workstream <id>
  reconcile-legacy --workstream <id> --kind released|reconstruct-lineage \\
    [--released-ref <sha>] [--child-workstream <id>] [--reason <text>] [--dry-run]
  status --workstream <id>
  status --blocking [--json]

Exit codes:
  0 success
  2 routing_required
  1 other failure
`);
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] as WorkflowProtocolCommand | undefined;
  if (!command || command === ('help' as WorkflowProtocolCommand) || args.includes('--help')) {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  const repoRoot = readFlag(args, '--repo-root') ?? process.cwd();
  if (command === 'status' && hasFlag(args, '--blocking')) {
    const readiness = getFinaliseProtocolReadiness(repoRoot);
    if (hasFlag(args, '--json')) {
      process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatFinaliseProtocolReadinessReport(readiness)}\n`);
    }
    process.exit(readiness.allowed ? 0 : 1);
  }

  if (command === 'reconcile-legacy') {
    const result = applyLegacyReconciliation({
      repoRoot,
      workstreamId: readFlag(args, '--workstream') ?? '',
      kind: readFlag(args, '--kind') ?? '',
      releasedRef: readFlag(args, '--released-ref'),
      childWorkstreamId: readFlag(args, '--child-workstream'),
      reason: readFlag(args, '--reason'),
      dryRun: hasFlag(args, '--dry-run'),
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: result.ok,
          exitCode: result.exitCode,
          message: result.message,
          dryRun: result.dryRun,
          wrote: result.wrote,
          record: result.record
            ? {
                workstreamId: result.record.workstreamId,
                phase: result.record.phase,
                nextAction: result.record.nextAction,
                sourceWorkstreamIds: result.record.sourceWorkstreamIds ?? null,
                activeCheckpointId: result.record.activeCheckpointId,
                legacyReconciliation: result.record.legacyReconciliation ?? null,
              }
            : null,
          closure: result.closure
            ? {
                workstreamId: result.closure.workstreamId,
                disposition: result.closure.disposition,
                kind: result.closure.kind,
                registryId: result.closure.registryId,
                implementationCommit: result.closure.identityAnchor.implementationCommit,
              }
            : null,
        },
        null,
        2
      )}\n`
    );
    process.exit(result.ok ? 0 : 1);
  }

  const result = applyProtocolTransition({
    repoRoot,
    command,
    workstreamId: readFlag(args, '--workstream'),
    planPath: readFlag(args, '--plan'),
    baseCommit: readFlag(args, '--base-commit'),
    manifestPath: readFlag(args, '--manifest'),
    pass: readFlag(args, '--pass') as WorkflowProtocolReviewPass | undefined,
    token: readFlag(args, '--token'),
    result: readFlag(args, '--result') as 'passed' | 'failed' | undefined,
    blockerFamilies: splitCsv(readFlag(args, '--blocker-families')),
    blockerIds: splitCsv(readFlag(args, '--blocker-ids')),
    siblingSurfaces: splitCsv(readFlag(args, '--sibling-surfaces')),
    closedBlockerIds: splitCsv(readFlag(args, '--closed-blocker-ids')),
    newWorkstreamId: readFlag(args, '--new-workstream'),
    narrowerPartition: hasFlag(args, '--narrower-partition'),
    hasFixDelta: hasFlag(args, '--has-fix-delta'),
    sourceWorkstreamIds: splitCsv(readFlag(args, '--source-workstreams')),
    disposition: readFlag(args, '--disposition') as WorkflowRouteDispositionTarget | undefined,
    reason: readFlag(args, '--reason'),
    implementationCommits: splitCsv(readFlag(args, '--implementation-commits')),
    revertCommit: readFlag(args, '--revert-commit'),
    supersedeCommit: readFlag(args, '--supersede-commit'),
    successorRepo: readFlag(args, '--successor-repo'),
    successorBranch: readFlag(args, '--successor-branch'),
    successorBaseline: readFlag(args, '--successor-baseline'),
    predecessorRootWorkstreamId: readFlag(args, '--predecessor-root'),
    predecessorDescendantWorkstreamId: readFlag(args, '--predecessor-descendant'),
    predecessorHeadCommit: readFlag(args, '--predecessor-head'),
    predecessorReleaseContext: readFlag(args, '--predecessor-release-context'),
    successorBaselineCommit: readFlag(args, '--successor-baseline'),
    successorBranchName: readFlag(args, '--successor-branch'),
    sourcePatchSha256: readFlag(args, '--source-patch-sha256'),
    sourceProductTreeFingerprint: readFlag(args, '--source-fingerprint'),
    sourceReleaseContext: readFlag(args, '--source-release-context'),
    sourceHeadCommit: readFlag(args, '--source-head'),
    sourceBaselineCommit: readFlag(args, '--source-baseline'),
    sourceReviewWorkstreamId: readFlag(args, '--source-review-workstream'),
  });

  const payload = {
    ok: result.ok,
    exitCode: result.exitCode,
    message: result.message,
    reviewToken: result.reviewToken,
    checkpointId: result.checkpointId,
    splitWorkstreamId: result.splitWorkstreamId,
    record: result.record
      ? {
          workstreamId: result.record.workstreamId,
          phase: result.record.phase,
          nextAction: result.record.nextAction,
          failedPremiumReviewCount: result.record.failedPremiumReviewCount,
          evidenceManifestPath: result.record.evidenceManifestPath,
          fixDeltaManifestPath: result.record.fixDeltaManifestPath,
          activeCheckpointId: result.record.activeCheckpointId,
          blockerFamilies: result.record.blockerFamilies,
          openBlockerIds: result.record.openBlockerIds,
          headCommit: result.record.headCommit,
        }
      : null,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(result.exitCode === WORKFLOW_ROUTING_REQUIRED_EXIT_CODE ? 2 : result.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
