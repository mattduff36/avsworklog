import { existsSync, readdirSync, readFileSync, lstatSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type {
  WorkflowFinaliseCorrelation,
  WorkflowProtocolPhase,
  WorkflowProtocolRecord,
  WorkflowReviewState,
  WorkflowWorkstreamRecord,
} from './types';
import {
  extractPlanContractMarker,
  isCriticalPlanContract,
  pathHasSymlinkComponent,
} from './workflow-plan-contract';
import {
  createEmptyWorkflowReviewState,
  getWorkflowPaths,
  loadWorkflowReviewStateStrict,
  upsertWorkstreamRecord,
} from './workflow-events';
import {
  applyFinaliseProtocolOutcome,
  getActiveFinaliseContext,
  getProtocolRecordPath,
  isWorkflowProtocolRecord,
  readProtocolRecord,
  resolveProtocolPlanAbsolutePath,
  reviewAllowsFinaliseStart,
} from './workflow-review-protocol';
import { getCurrentTreeFingerprint } from './workflow-evidence-manifest';
import {
  lastOwnedCommit,
  readWorkflowGitBinding,
} from './workflow-git-binding';
import {
  inspectCommitAncestry,
  isNonReleaseDispositionPhase,
  lineageBudgetExhausted,
  revalidateRouteDisposition,
} from './workflow-v24-disposition';
import {
  hasMeaningfulExecutionEvidence,
  inspectLegacyClosure,
  protocolDiskStateDiverges,
  readValidLegacyClosure,
} from './workflow-legacy-reconciliation';
import {
  LIVE_LEGACY_RECONCILIATION_REGISTRY,
  type LegacyReconciliationRegistryEntry,
} from './legacy-reconciliation-registry';

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
  if (!params.ancestorCommit || !params.descendantCommit) {
    throw new Error('git ancestry inspection requires commit identities');
  }
  const inspection = inspectCommitAncestry(
    params.repoRoot,
    params.ancestorCommit,
    params.descendantCommit
  );
  if (inspection.status === 'error') {
    throw new Error(inspection.message);
  }
  return inspection.status === 'ancestor';
}

function isSafeWorkstreamDirName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name);
}

function resolveProtocolRecordFromDisk(
  repoRoot: string,
  workstreamId: string
): WorkflowProtocolRecord | null {
  const fromDisk = readProtocolRecord(repoRoot, workstreamId);
  return fromDisk && isWorkflowProtocolRecord(fromDisk) ? fromDisk : null;
}

export function listDiskProtocolInventory(repoRoot: string): {
  ids: string[];
  unsafeDirectoryNames: string[];
} {
  const root = path.join(repoRoot, 'docs_private', 'automation', 'workstreams');
  if (!existsSync(root)) return { ids: [], unsafeDirectoryNames: [] };
  const ids: string[] = [];
  const unsafeDirectoryNames: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const directory = path.join(root, entry.name);
    let stat;
    try {
      stat = lstatSync(directory);
    } catch {
      unsafeDirectoryNames.push(entry.name);
      continue;
    }
    if (
      entry.isSymbolicLink() ||
      stat.isSymbolicLink() ||
      pathHasSymlinkComponent(directory) ||
      !isSafeWorkstreamDirName(entry.name)
    ) {
      unsafeDirectoryNames.push(entry.name);
      continue;
    }
    if (!stat.isDirectory() || !entry.isDirectory()) continue;
    if (!existsSync(path.join(directory, 'protocol.json'))) continue;
    ids.push(entry.name);
  }
  return { ids, unsafeDirectoryNames };
}

export function listDiskProtocolWorkstreamIds(repoRoot: string): string[] {
  return listDiskProtocolInventory(repoRoot).ids;
}

function collectProtocolWorkstreamIds(
  repoRoot: string,
  state: WorkflowReviewState
): string[] {
  const fromState = Object.keys(state.protocolRecords ?? {});
  const fromDisk = listDiskProtocolInventory(repoRoot).ids;
  return [...new Set([...fromState, ...fromDisk])].sort();
}

function workstreamRecordFromProtocol(
  protocol: WorkflowProtocolRecord,
  fallbackBranch: string,
  fallbackHead: string
): WorkflowWorkstreamRecord {
  return {
    workstreamId: protocol.workstreamId,
    branchName: protocol.branchName ?? fallbackBranch,
    headCommit: protocol.headCommit ?? fallbackHead,
    taskIds: [],
    eventIds: [],
    status: 'open',
    updatedAt: protocol.updatedAt,
  };
}

export function isCriticalProtocolWorkstream(
  repoRoot: string,
  protocol: WorkflowProtocolRecord
): boolean {
  if (!protocol.planPath) return true;
  const absolutePlanPath = resolveProtocolPlanAbsolutePath(repoRoot, protocol.planPath);
  if (!existsSync(absolutePlanPath)) return true;
  try {
    const parsed = extractPlanContractMarker(readFileSync(absolutePlanPath, 'utf8'));
    if (parsed.status !== 'present' || !parsed.contract) return true;
    return isCriticalPlanContract(parsed.contract);
  } catch {
    return true;
  }
}

export type WorkflowProtocolLineageRole =
  | 'active_leaf'
  | 'parked_split_ancestor'
  | 'parked_unstarted'
  | 'orphan_split'
  | 'finalised'
  | 'non_critical'
  | 'other_branch'
  | 'historically_closed'
  | 'non_release_disposition'
  | 'malformed';

export interface WorkflowProtocolHeadDrift {
  workstreamId: string;
  reviewedHeadCommit: string | null;
  currentHead: string | null;
  extraCommits: string[];
}

export interface WorkflowProtocolReadinessBlocker {
  workstreamId: string;
  role: WorkflowProtocolLineageRole;
  phase: WorkflowProtocolPhase | 'unknown';
  message: string;
  lineageRootWorkstreamId: string | null;
  parentWorkstreamId: string | null;
  childWorkstreamIds: string[];
  nextAction: string | null;
  openBlockerIds: string[];
  suggestedCommands: string[];
}

export interface WorkflowFinaliseProtocolReadiness {
  allowed: boolean;
  currentHead: string | null;
  currentBranch: string | null;
  lineages: WorkflowProtocolReadinessBlocker[];
  blockingWorkstreams: WorkflowProtocolReadinessBlocker[];
  warnings: string[];
  headDrift: WorkflowProtocolHeadDrift[];
  suggestedActions: string[];
}

function immediateParentId(record: WorkflowProtocolRecord): string | null {
  return record.sourceWorkstreamIds?.[0] ?? null;
}

function indexImmediateChildren(
  records: Iterable<WorkflowProtocolRecord>
): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const record of records) {
    const parentId = immediateParentId(record);
    if (!parentId) continue;
    const existing = children.get(parentId) ?? [];
    existing.push(record.workstreamId);
    children.set(parentId, existing);
  }
  return children;
}

function lineageRootId(
  record: WorkflowProtocolRecord,
  byId: Map<string, WorkflowProtocolRecord>
): string {
  const seen = new Set<string>();
  let current: WorkflowProtocolRecord | undefined = record;
  while (current) {
    if (seen.has(current.workstreamId)) return current.workstreamId;
    seen.add(current.workstreamId);
    const parentId = immediateParentId(current);
    if (!parentId) return current.workstreamId;
    current = byId.get(parentId);
    if (!current) return parentId;
  }
  return record.workstreamId;
}

function hasAncestorCycle(
  record: WorkflowProtocolRecord,
  byId: Map<string, WorkflowProtocolRecord>
): boolean {
  const seen = new Set<string>();
  let current: WorkflowProtocolRecord | undefined = record;
  while (current) {
    if (seen.has(current.workstreamId)) return true;
    seen.add(current.workstreamId);
    const parentId = immediateParentId(current);
    if (!parentId) return false;
    current = byId.get(parentId);
  }
  return false;
}

export function listCommitsAfter(params: {
  repoRoot: string;
  fromCommit: string;
  toCommit: string;
}): string[] {
  if (!params.fromCommit || !params.toCommit || params.fromCommit === params.toCommit) {
    return [];
  }
  const output = runGit(params.repoRoot, [
    'log',
    '--format=%H',
    `${params.fromCommit}..${params.toCommit}`,
  ]);
  if (!output) return [];
  return output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function protocolCommand(workstreamId: string, command: string, extra = ''): string {
  return `npx tsx scripts/workflow-protocol.ts ${command} --workstream ${workstreamId}${extra}`;
}

function loadGatedProtocol(
  repoRoot: string,
  state: WorkflowReviewState,
  workstreamId: string
):
  | { status: 'missing' }
  | { status: 'unreadable' }
  | { status: 'malformed' }
  | { status: 'divergence'; protocol: WorkflowProtocolRecord }
  | { status: 'ok'; protocol: WorkflowProtocolRecord } {
  const diskPath = getProtocolRecordPath(repoRoot, workstreamId);
  const fromState = state.protocolRecords?.[workstreamId];
  if (existsSync(diskPath)) {
    try {
      const parsed = JSON.parse(readFileSync(diskPath, 'utf8')) as unknown;
      if (!isWorkflowProtocolRecord(parsed)) return { status: 'malformed' };
      if (
        fromState &&
        isWorkflowProtocolRecord(fromState) &&
        protocolDiskStateDiverges(parsed, fromState)
      ) {
        return { status: 'divergence', protocol: parsed };
      }
      return { status: 'ok', protocol: parsed };
    } catch {
      return { status: 'unreadable' };
    }
  }
  if (fromState && isWorkflowProtocolRecord(fromState)) {
    return { status: 'divergence', protocol: fromState };
  }
  if (fromState) return { status: 'malformed' };
  return { status: 'missing' };
}

function isUnstartedInitializedProtocol(protocol: WorkflowProtocolRecord): boolean {
  return (
    protocol.phase === 'initialized' &&
    protocol.activeCheckpointId == null &&
    protocol.activeReviewToken == null &&
    protocol.reviewAttempts.length === 0
  );
}

function hasMatchingFinaliseReadyContext(
  active: { workstreamId: string; checkpointId: string } | null,
  byId: Map<string, WorkflowProtocolRecord>
): boolean {
  if (!active) return false;
  const ready = byId.get(active.workstreamId);
  return Boolean(
    ready &&
      ready.phase === 'finalise_ready' &&
      ready.activeCheckpointId === active.checkpointId
  );
}

function makeBlocker(params: {
  workstreamId: string;
  role: WorkflowProtocolLineageRole;
  phase: WorkflowProtocolPhase | 'unknown';
  message: string;
  protocol?: WorkflowProtocolRecord | null;
  byId?: Map<string, WorkflowProtocolRecord>;
  childWorkstreamIds?: string[];
  suggestedCommands?: string[];
}): WorkflowProtocolReadinessBlocker {
  const parentWorkstreamId = params.protocol ? immediateParentId(params.protocol) : null;
  return {
    workstreamId: params.workstreamId,
    role: params.role,
    phase: params.phase,
    message: params.message,
    lineageRootWorkstreamId:
      params.protocol && params.byId
        ? lineageRootId(params.protocol, params.byId)
        : params.workstreamId,
    parentWorkstreamId,
    childWorkstreamIds: params.childWorkstreamIds ?? [],
    nextAction: params.protocol?.nextAction ?? null,
    openBlockerIds: params.protocol?.openBlockerIds ?? [],
    suggestedCommands: params.suggestedCommands ?? [],
  };
}

function currentBranchName(repoRoot: string): string | null {
  return readWorkflowGitBinding(repoRoot).branchName;
}

/**
 * Read-only protocol gate evaluation. Reports every relevant lineage/blocker.
 * Does not mutate protocol JSON or workflow state.
 */
export function getFinaliseProtocolReadiness(
  repoRoot: string,
  options?: { legacyRegistry?: readonly LegacyReconciliationRegistryEntry[] }
): WorkflowFinaliseProtocolReadiness {
  const legacyRegistry = options?.legacyRegistry ?? LIVE_LEGACY_RECONCILIATION_REGISTRY;
  const paths = getWorkflowPaths(repoRoot);
  const loadedState = loadWorkflowReviewStateStrict(paths.statePath);
  const git = readWorkflowGitBinding(repoRoot);
  const currentHead = git.headCommit;
  const currentBranch = git.branchName;
  const lineages: WorkflowProtocolReadinessBlocker[] = [];
  const blockingWorkstreams: WorkflowProtocolReadinessBlocker[] = [];
  const warnings: string[] = [];
  const headDrift: WorkflowProtocolHeadDrift[] = [];
  const suggestedActions: string[] = [];

  const pushBlocker = (blocker: WorkflowProtocolReadinessBlocker): void => {
    lineages.push(blocker);
    blockingWorkstreams.push(blocker);
    suggestedActions.push(...blocker.suggestedCommands);
  };

  if (git.detached || !currentBranch) {
    pushBlocker(
      makeBlocker({
        workstreamId: 'git-binding',
        role: 'malformed',
        phase: 'unknown',
        message: 'HEAD is detached or the current branch is missing; refuse finalise',
      })
    );
  }

  if (!loadedState.ok) {
    pushBlocker(
      makeBlocker({
        workstreamId: 'workflow-state',
        role: 'malformed',
        phase: 'unknown',
        message: `workflow review state is ${loadedState.reason}; refuse finalise`,
      })
    );
  }

  const state = loadedState.ok ? loadedState.state : createEmptyWorkflowReviewState();
  const diskInventory = listDiskProtocolInventory(repoRoot);
  for (const unsafeName of diskInventory.unsafeDirectoryNames) {
    pushBlocker(
      makeBlocker({
        workstreamId: unsafeName,
        role: 'malformed',
        phase: 'unknown',
        message: `protocol directory ${unsafeName} is unsafe or a symlink; refuse finalise`,
      })
    );
  }
  const active = getActiveFinaliseContext(state);
  const loaded: Array<{
    workstreamId: string;
    protocol: WorkflowProtocolRecord | null;
    loadStatus: 'ok' | 'missing' | 'unreadable' | 'malformed' | 'divergence';
  }> = [];
  for (const workstreamId of collectProtocolWorkstreamIds(repoRoot, state)) {
    const loadedRecord = loadGatedProtocol(repoRoot, state, workstreamId);
    if (loadedRecord.status === 'ok' || loadedRecord.status === 'divergence') {
      loaded.push({
        workstreamId,
        protocol: loadedRecord.protocol,
        loadStatus: loadedRecord.status,
      });
    } else {
      loaded.push({
        workstreamId,
        protocol: null,
        loadStatus: loadedRecord.status,
      });
    }
  }

  const byId = new Map<string, WorkflowProtocolRecord>();
  for (const row of loaded) {
    if (row.protocol) byId.set(row.workstreamId, row.protocol);
  }
  const children = indexImmediateChildren(byId.values());

  if (active) {
    const protocol = byId.get(active.workstreamId);
    if (
      !protocol ||
      protocol.phase !== 'finalise_ready' ||
      protocol.activeCheckpointId !== active.checkpointId
    ) {
      pushBlocker(
        makeBlocker({
          workstreamId: active.workstreamId,
          role: 'active_leaf',
          phase: protocol?.phase ?? 'unknown',
          message: `active finalise context is stale or not finalise_ready (workstream=${active.workstreamId}, phase=${protocol?.phase ?? 'missing'})`,
          protocol,
          byId,
          childWorkstreamIds: children.get(active.workstreamId) ?? [],
        })
      );
    } else if (!protocol.branchName || protocol.branchName !== currentBranch) {
      pushBlocker(
        makeBlocker({
          workstreamId: active.workstreamId,
          role: 'active_leaf',
          phase: protocol.phase,
          message: `active finalise context branch ${protocol.branchName ?? 'null'} does not match current branch ${currentBranch ?? 'detached'}`,
          protocol,
          byId,
          childWorkstreamIds: children.get(active.workstreamId) ?? [],
        })
      );
    }
  }

  for (const row of loaded) {
    if (row.loadStatus === 'unreadable') {
      pushBlocker(
        makeBlocker({
          workstreamId: row.workstreamId,
          role: 'malformed',
          phase: 'unknown',
          message: `protocol record for ${row.workstreamId} exists but is unreadable; refuse finalise`,
        })
      );
      continue;
    }
    if (row.loadStatus === 'malformed') {
      pushBlocker(
        makeBlocker({
          workstreamId: row.workstreamId,
          role: 'malformed',
          phase: 'unknown',
          message: `protocol record for ${row.workstreamId} exists but is malformed; refuse finalise`,
        })
      );
      continue;
    }
    if (row.loadStatus === 'divergence') {
      pushBlocker(
        makeBlocker({
          workstreamId: row.workstreamId,
          role: 'malformed',
          phase: row.protocol?.phase ?? 'unknown',
          message: `protocol disk/state disagreement for ${row.workstreamId}; refuse finalise`,
          protocol: row.protocol,
          byId,
        })
      );
      continue;
    }
    const protocol = row.protocol;
    if (!protocol) continue;

    const childWorkstreamIds = (children.get(protocol.workstreamId) ?? []).filter((id) =>
      byId.has(id)
    );
    const parentId = immediateParentId(protocol);
    if (hasAncestorCycle(protocol, byId)) {
      pushBlocker(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'orphan_split',
          phase: protocol.phase,
          message: `CRITICAL workstream ${protocol.workstreamId} has a cyclic lineage; protocol integrity error`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }
    if (parentId && !byId.has(parentId)) {
      pushBlocker(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'malformed',
          phase: protocol.phase,
          message: `CRITICAL workstream ${protocol.workstreamId} has dangling parent ${parentId}; protocol integrity error`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    const inspectedClosure = inspectLegacyClosure(repoRoot, protocol.workstreamId);
    if (inspectedClosure.status === 'malformed') {
      pushBlocker(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'malformed',
          phase: protocol.phase,
          message: `legacy closure for ${protocol.workstreamId} is malformed: ${inspectedClosure.message}`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }
    if (inspectedClosure.status === 'ok') {
      const valid = readValidLegacyClosure({
        repoRoot,
        protocol,
        registry: legacyRegistry,
      });
      if (!valid.ok) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'malformed',
            phase: protocol.phase,
            message: `legacy closure for ${protocol.workstreamId} is invalid: ${valid.message}`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'historically_closed',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} has a registry-valid ${valid.closure.disposition} closure at ${valid.closure.identityAnchor.implementationCommit}; it does not authorise finalise-start`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    if (protocol.phase === 'finalised') {
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'finalised',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is finalised`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }
    if (protocol.phase === 'reconciled') {
      pushBlocker(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'malformed',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is reconciled without a registry-valid closure; refuse finalise`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    const boundToOtherBranch = Boolean(
      protocol.branchName && currentBranch && protocol.branchName !== currentBranch
    );
    if (boundToOtherBranch && active?.workstreamId !== protocol.workstreamId) {
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'other_branch',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is bound to branch ${protocol.branchName}; current branch is ${currentBranch}`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    if (protocol.phase === 'split') {
      if (childWorkstreamIds.length > 1) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'orphan_split',
            phase: protocol.phase,
            message: `CRITICAL workstream ${protocol.workstreamId} is in phase split with ambiguous children ${childWorkstreamIds.join(', ')}; protocol integrity error`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      if (childWorkstreamIds.length === 0) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'orphan_split',
            phase: protocol.phase,
            message: `CRITICAL workstream ${protocol.workstreamId} is in phase split with no valid child continuation (orphan split); protocol integrity error`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      const parked = makeBlocker({
        workstreamId: protocol.workstreamId,
        role: 'parked_split_ancestor',
        phase: protocol.phase,
        message: `split ancestor ${protocol.workstreamId} is parked historical state; continuation ${childWorkstreamIds.join(', ')} owns completion`,
        protocol,
        byId,
        childWorkstreamIds,
      });
      lineages.push(parked);
      if (protocol.openBlockerIds.length > 0) {
        warnings.push(
          `parked split ancestor ${protocol.workstreamId} retains audit blockers ${protocol.openBlockerIds.join(', ')}; they do not independently block finalise`
        );
      }
      continue;
    }

    if (!isCriticalProtocolWorkstream(repoRoot, protocol)) {
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'non_critical',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is not CRITICAL`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    if (
      isUnstartedInitializedProtocol(protocol) &&
      !hasMeaningfulExecutionEvidence(repoRoot, protocol.workstreamId) &&
      active &&
      hasMatchingFinaliseReadyContext(active, byId) &&
      active.workstreamId !== protocol.workstreamId
    ) {
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'parked_unstarted',
          phase: protocol.phase,
          message: `unstarted CRITICAL workstream ${protocol.workstreamId} is parked historical init-only state; ${active.workstreamId} owns the current finalise. It was not marked finalised.`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      warnings.push(
        `parked unstarted workstream ${protocol.workstreamId} remains phase initialized; complete or abandon it after this release`
      );
      continue;
    }

    if (protocol.phase === 'finalise_ready') {
      if (!reviewAllowsFinaliseStart(protocol)) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'active_leaf',
            phase: protocol.phase,
            message: `finalise_ready workstream ${protocol.workstreamId} does not have a successful review with empty blockers; run review-start --pass delta`,
            protocol,
            byId,
            childWorkstreamIds,
            suggestedCommands: [
              protocolCommand(protocol.workstreamId, 'review-start', ' --pass delta'),
            ],
          })
        );
        continue;
      }
      const contextMatches = Boolean(
        active &&
          active.workstreamId === protocol.workstreamId &&
          active.checkpointId === protocol.activeCheckpointId &&
          protocol.activeCheckpointId
      );
      if (!contextMatches) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'active_leaf',
            phase: protocol.phase,
            message: `finalise_ready workstream ${protocol.workstreamId} requires matching activeFinaliseContext (checkpoint=${protocol.activeCheckpointId ?? 'missing'})`,
            protocol,
            byId,
            childWorkstreamIds,
            suggestedCommands: [protocolCommand(protocol.workstreamId, 'finalise-start')],
          })
        );
        continue;
      }
      const expectedHead =
        lastOwnedCommit(active?.ownedCommits, active?.activatedHeadCommit ?? protocol.headCommit) ??
        protocol.headCommit;
      if (currentHead && expectedHead && expectedHead !== currentHead) {
        const extraCommits = listCommitsAfter({
          repoRoot,
          fromCommit: protocol.headCommit ?? expectedHead,
          toCommit: currentHead,
        });
        headDrift.push({
          workstreamId: protocol.workstreamId,
          reviewedHeadCommit: protocol.headCommit,
          currentHead,
          extraCommits,
        });
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'active_leaf',
            phase: protocol.phase,
            message: `HEAD has moved since the reviewed commit ${protocol.headCommit}; current HEAD is ${currentHead}; extra commits: ${extraCommits.join(', ') || 'unable to list'}. Run ${protocolCommand(protocol.workstreamId, 'review-start', ' --pass delta')} then retry finalise-start. Do not rewrite review metadata to the current HEAD.`,
            protocol,
            byId,
            childWorkstreamIds,
            suggestedCommands: [
              protocolCommand(protocol.workstreamId, 'review-start', ' --pass delta'),
            ],
          })
        );
        continue;
      }
      const currentTree = getCurrentTreeFingerprint(repoRoot).inputFingerprint;
      const expectedTree = protocol.reviewedTreeFingerprint;
      if (expectedTree && expectedTree !== currentTree) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'active_leaf',
            phase: protocol.phase,
            message: `working tree fingerprint moved since the reviewed tree; run ${protocolCommand(protocol.workstreamId, 'review-start', ' --pass delta')}`,
            protocol,
            byId,
            childWorkstreamIds,
            suggestedCommands: [
              protocolCommand(protocol.workstreamId, 'review-start', ' --pass delta'),
            ],
          })
        );
        continue;
      }
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'active_leaf',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} is finalise_ready with matching activeFinaliseContext`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    if (isNonReleaseDispositionPhase(protocol.phase)) {
      const valid = revalidateRouteDisposition({ repoRoot, record: protocol });
      if (!valid.ok) {
        pushBlocker(
          makeBlocker({
            workstreamId: protocol.workstreamId,
            role: 'malformed',
            phase: protocol.phase,
            message: `non-release disposition for ${protocol.workstreamId} failed revalidation: ${valid.message}`,
            protocol,
            byId,
            childWorkstreamIds,
          })
        );
        continue;
      }
      lineages.push(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'non_release_disposition',
          phase: protocol.phase,
          message: `workstream ${protocol.workstreamId} has a Git-proven ${protocol.phase} disposition; it is not finalised and does not authorise finalise-start`,
          protocol,
          byId,
          childWorkstreamIds,
        })
      );
      continue;
    }

    if (protocol.phase === 'routing_required' || lineageBudgetExhausted(protocol)) {
      pushBlocker(
        makeBlocker({
          workstreamId: protocol.workstreamId,
          role: 'active_leaf',
          phase: protocol.phase,
          message: `CRITICAL workstream ${protocol.workstreamId} has exhausted its lineage-scoped premium review budget and remains a release blocker while its implementation is in this history. Route, isolate/re-home, remove-from-release, revert, or evidence-backed supersede. Do not review-start --pass first.`,
          protocol,
          byId,
          childWorkstreamIds,
          suggestedCommands: [
            protocolCommand(protocol.workstreamId, 'route', ' --disposition removed_from_release'),
            protocolCommand(protocol.workstreamId, 'route', ' --disposition reverted'),
            protocolCommand(protocol.workstreamId, 'route', ' --disposition superseded'),
          ],
        })
      );
      continue;
    }

    const suggestedCommands: string[] = [];
    if (protocol.phase === 'review_closed') {
      if (
        !reviewAllowsFinaliseStart(protocol) ||
        (currentHead && protocol.headCommit && protocol.headCommit !== currentHead)
      ) {
        if (currentHead && protocol.headCommit && protocol.headCommit !== currentHead) {
          const extraCommits = listCommitsAfter({
            repoRoot,
            fromCommit: protocol.headCommit,
            toCommit: currentHead,
          });
          headDrift.push({
            workstreamId: protocol.workstreamId,
            reviewedHeadCommit: protocol.headCommit,
            currentHead,
            extraCommits,
          });
        }
        suggestedCommands.push(
          protocolCommand(protocol.workstreamId, 'review-start', ' --pass delta')
        );
      } else {
        suggestedCommands.push(protocolCommand(protocol.workstreamId, 'finalise-start'));
      }
    }

    pushBlocker(
      makeBlocker({
        workstreamId: protocol.workstreamId,
        role: 'active_leaf',
        phase: protocol.phase,
        message: `CRITICAL workstream ${protocol.workstreamId} is in phase ${protocol.phase}; complete review and run finalise-start before finalise`,
        protocol,
        byId,
        childWorkstreamIds,
        suggestedCommands,
      })
    );
  }

  return {
    allowed: blockingWorkstreams.length === 0,
    currentHead,
    currentBranch,
    lineages,
    blockingWorkstreams,
    warnings,
    headDrift,
    suggestedActions: [...new Set(suggestedActions)],
  };
}

export function formatFinaliseProtocolReadinessReport(
  readiness: WorkflowFinaliseProtocolReadiness
): string {
  const lines: string[] = [
    `Protocol readiness: ${readiness.allowed ? 'allowed' : 'blocked'}`,
  ];
  if (readiness.currentHead) {
    lines.push(`Current HEAD: ${readiness.currentHead}`);
  }
  if (readiness.currentBranch) {
    lines.push(`Current branch: ${readiness.currentBranch}`);
  }
  const parked = readiness.lineages.filter((row) => row.role === 'parked_split_ancestor');
  if (parked.length > 0) {
    lines.push('Parked split ancestors (historical, not independent finalise blockers):');
    for (const row of parked) {
      lines.push(
        `- ${row.workstreamId} phase=${row.phase} parent=${row.parentWorkstreamId ?? 'none'} children=${row.childWorkstreamIds.join(',') || 'none'} next=${row.nextAction ?? 'n/a'}`
      );
    }
  }
  const historicallyClosed = readiness.lineages.filter((row) => row.role === 'historically_closed');
  if (historicallyClosed.length > 0) {
    lines.push('Historically closed workstreams (separate closure records, not finalise-start):');
    for (const row of historicallyClosed) {
      lines.push(`- ${row.workstreamId} phase=${row.phase} ${row.message}`);
    }
  }
  const parkedUnstarted = readiness.lineages.filter((row) => row.role === 'parked_unstarted');
  if (parkedUnstarted.length > 0) {
    lines.push('Parked unstarted workstreams (init-only, not independent finalise blockers):');
    for (const row of parkedUnstarted) {
      lines.push(`- ${row.workstreamId} phase=${row.phase} next=${row.nextAction ?? 'n/a'}`);
    }
  }
  const otherBranch = readiness.lineages.filter((row) => row.role === 'other_branch');
  if (otherBranch.length > 0) {
    lines.push('Other-branch workstreams (reported, not current-branch blockers):');
    for (const row of otherBranch) {
      lines.push(`- ${row.workstreamId} phase=${row.phase} ${row.message}`);
    }
  }
  if (readiness.blockingWorkstreams.length > 0) {
    lines.push('Blockers:');
    for (const blocker of readiness.blockingWorkstreams) {
      lines.push(
        `- ${blocker.workstreamId} role=${blocker.role} phase=${blocker.phase} root=${blocker.lineageRootWorkstreamId ?? blocker.workstreamId} parent=${blocker.parentWorkstreamId ?? 'none'} next=${blocker.nextAction ?? 'n/a'}`
      );
      lines.push(`  ${blocker.message}`);
      if (blocker.suggestedCommands.length > 0) {
        lines.push(`  ${blocker.suggestedCommands.join(' ; ')}`);
      }
    }
  }
  for (const drift of readiness.headDrift) {
    lines.push(
      `HEAD drift for ${drift.workstreamId}: reviewed=${drift.reviewedHeadCommit ?? 'missing'} current=${drift.currentHead ?? 'missing'} extra=${drift.extraCommits.join(', ') || 'unable to list'}`
    );
  }
  for (const warning of readiness.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  return lines.join('\n');
}

export function assertFinaliseAllowedForProtocol(repoRoot: string): void {
  const readiness = getFinaliseProtocolReadiness(repoRoot);
  if (!readiness.allowed) {
    throw new Error(formatFinaliseProtocolReadinessReport(readiness));
  }
}

function explicitContextIsValid(
  repoRoot: string,
  state: WorkflowReviewState,
  workstreamId: string,
  checkpointId: string
): { ok: true; protocol: WorkflowProtocolRecord } | { ok: false; reason: string } {
  const protocol = resolveProtocolRecordFromDisk(repoRoot, workstreamId);
  if (!protocol) return { ok: false, reason: 'protocol-missing' };
  if (protocol.phase !== 'finalise_ready') return { ok: false, reason: `phase=${protocol.phase}` };
  if (protocol.activeCheckpointId !== checkpointId) return { ok: false, reason: 'checkpoint-mismatch' };
  if (!reviewAllowsFinaliseStart(protocol)) return { ok: false, reason: 'review-not-passed' };
  const git = readWorkflowGitBinding(repoRoot);
  if (!protocol.branchName || protocol.branchName !== git.branchName) {
    return { ok: false, reason: 'branch-mismatch' };
  }
  const active = getActiveFinaliseContext(state);
  const expectedHead =
    lastOwnedCommit(active?.ownedCommits, active?.activatedHeadCommit ?? protocol.headCommit) ??
    protocol.headCommit;
  if (expectedHead && git.headCommit && expectedHead !== git.headCommit) {
    return { ok: false, reason: 'head-mismatch' };
  }
  return { ok: true, protocol };
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
    const validity = explicitContextIsValid(
      params.repoRoot,
      params.state,
      active.workstreamId,
      active.checkpointId
    );
    if (!validity.ok) {
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
    const record =
      params.state.workstreams?.[active.workstreamId] ??
      workstreamRecordFromProtocol(validity.protocol, params.branchName, params.headCommit);
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

    if (params.repoRoot) {
      const protocolResult = applyFinaliseProtocolOutcome({
        repoRoot: params.repoRoot,
        state: next,
        workstreamId: record.workstreamId,
        outcome: params.finaliseOutcome,
        now: () => new Date(now),
      });
      next = protocolResult.state;
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

export function shouldApplyFinaliseCorrelation(params: {
  scriptName: string;
  mode?: string;
  args?: string[];
}): boolean {
  if (params.scriptName !== 'finalise') return false;
  const args = params.args ?? [];
  if (args.includes('--help') || args.includes('-h') || args.includes('--dry-run')) {
    return false;
  }
  if (params.mode === 'dry-run' || params.mode === 'help') {
    return false;
  }
  return true;
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
  const git = readWorkflowGitBinding(params.repoRoot);
  const branchName = git.branchName ?? 'unknown';
  const headCommit = git.headCommit ?? '';
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

export { currentBranchName };
