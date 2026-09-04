/**
 * Compact premium-review-packet collection.
 * Independent READ-ONLY evidence may overlap; assembly is SERIAL for one candidate.
 * Not review authority and not finalise authority.
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { writeJsonAtomic } from './workflow-events';
import { readWorkflowGitBinding } from './workflow-git-binding';
import { readProtocolRecord } from './workflow-review-protocol';
import { extractPlanContractMarker, resolvePlanPath } from './workflow-plan-contract';
import { getCurrentTreeFingerprint, listBaseToHeadChangedFiles } from './workflow-evidence-manifest';
import {
  assertFrozenCandidate,
  captureFrozenVerifyCandidate,
  runVerifyBatch,
  type FrozenVerifyCandidate,
} from './tee-parallel-verify';

export interface PremiumReviewPacket {
  schemaVersion: '1';
  kind: 'premium-review-packet';
  workstreamId: string;
  pass: 'first' | 'closure' | 'delta';
  headCommit: string;
  fingerprint: string;
  createdAt: string;
  git: {
    branchName: string | null;
    headCommit: string | null;
    detached: boolean;
  };
  changedFiles: string[];
  protocol: {
    phase: string | null;
    nextAction: string | null;
    failedPremiumReviewCount: number | null;
    evidenceManifestPath: string | null;
    fixDeltaManifestPath: string | null;
  };
  plan: {
    path: string | null;
    risk: string | null;
    requiredTestIds: string[];
    architectureConditions: string[];
  };
  verification: {
    manifestStatus: string | null;
    commandNames: string[];
    requiredTestIds: string[];
    typecheck: string | null;
    lint: string | null;
  };
  contentHash: string;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function readJsonIfPresent(absolutePath: string): Record<string, unknown> | null {
  if (!existsSync(absolutePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function collectPremiumPacketEvidence(params: {
  repoRoot: string;
  workstreamId: string;
  pass?: 'first' | 'closure' | 'delta';
  candidate?: FrozenVerifyCandidate;
  persist?: boolean;
}): Promise<
  | { ok: true; packet: PremiumReviewPacket; relativePath: string | null }
  | { ok: false; message: string }
> {
  const captured = params.candidate
    ? { ok: true as const, candidate: params.candidate }
    : captureFrozenVerifyCandidate({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
      });
  if (!captured.ok) return captured;
  const candidate = captured.candidate;
  if (candidate.workstreamId && candidate.workstreamId !== params.workstreamId) {
    return { ok: false, message: 'packet workstream does not match the frozen candidate' };
  }

  const batch = await runVerifyBatch<unknown>({
    candidate,
    readCandidate: () => {
      const current = captureFrozenVerifyCandidate({
        repoRoot: params.repoRoot,
        workstreamId: params.workstreamId,
      });
      return current.ok ? current.candidate : { error: current.message };
    },
    jobs: [
      {
        id: 'git-scope',
        label: 'Git scope',
        kind: 'read_only',
        run: () => readWorkflowGitBinding(params.repoRoot),
      },
      {
        id: 'changed-files',
        label: 'Changed files',
        kind: 'read_only',
        run: () => {
          const tree = getCurrentTreeFingerprint(params.repoRoot);
          const protocol = readProtocolRecord(params.repoRoot, params.workstreamId);
          const base = protocol?.baseCommit ?? tree.headCommit;
          const named = listBaseToHeadChangedFiles(params.repoRoot, base, tree.headCommit);
          return [...new Set([...named, ...tree.changedFiles])].sort();
        },
      },
      {
        id: 'protocol-state',
        label: 'Protocol state',
        kind: 'read_only',
        run: () => readProtocolRecord(params.repoRoot, params.workstreamId),
      },
      {
        id: 'plan-contract',
        label: 'Plan contract',
        kind: 'read_only',
        run: () => {
          const protocol = readProtocolRecord(params.repoRoot, params.workstreamId);
          if (!protocol?.planPath) return null;
          const resolved = resolvePlanPath({
            candidatePath: protocol.planPath,
            repoRoot: params.repoRoot,
          });
          if (resolved.status !== 'ok' || !resolved.absolutePath) return null;
          return extractPlanContractMarker(readFileSync(resolved.absolutePath, 'utf8'));
        },
      },
      {
        id: 'manifest-summary',
        label: 'Verification summary',
        kind: 'read_only',
        run: () => {
          const protocol = readProtocolRecord(params.repoRoot, params.workstreamId);
          const relative =
            params.pass === 'closure'
              ? protocol?.fixDeltaManifestPath ?? protocol?.evidenceManifestPath
              : protocol?.evidenceManifestPath;
          if (!relative) return null;
          return readJsonIfPresent(path.join(params.repoRoot, relative));
        },
      },
    ],
  });

  if (batch.foundational) {
    return { ok: false, message: batch.foundationalMessage ?? 'packet candidate drifted' };
  }
  if (!batch.ok) {
    return { ok: false, message: 'packet evidence collection failed' };
  }

  const after = captureFrozenVerifyCandidate({
    repoRoot: params.repoRoot,
    workstreamId: params.workstreamId,
  });
  if (!after.ok) return after;
  const same = assertFrozenCandidate({ expected: candidate, actual: after.candidate });
  if (!same.ok) return same;

  const git = batch.results.find((row) => row.id === 'git-scope')?.value as
    | ReturnType<typeof readWorkflowGitBinding>
    | undefined;
  const changedFiles = (batch.results.find((row) => row.id === 'changed-files')?.value as
    | string[]
    | undefined) ?? [];
  const protocol = batch.results.find((row) => row.id === 'protocol-state')?.value as
    | ReturnType<typeof readProtocolRecord>
    | undefined;
  const plan = batch.results.find((row) => row.id === 'plan-contract')?.value as
    | ReturnType<typeof extractPlanContractMarker>
    | null
    | undefined;
  const manifest = batch.results.find((row) => row.id === 'manifest-summary')?.value as
    | Record<string, unknown>
    | null
    | undefined;
  const commands = Array.isArray(manifest?.commands)
    ? (manifest.commands as Array<Record<string, unknown>>)
    : [];
  const typecheck = commands.find((command) => command.name === 'typecheck');
  const oxlint = commands.find((command) => command.name === 'oxlint-changed');
  const eslint = commands.find((command) => command.name === 'eslint-changed');

  const draft: Omit<PremiumReviewPacket, 'contentHash'> = {
    schemaVersion: '1',
    kind: 'premium-review-packet',
    workstreamId: params.workstreamId,
    pass: params.pass ?? 'first',
    headCommit: candidate.headCommit,
    fingerprint: candidate.fingerprint,
    createdAt: new Date().toISOString(),
    git: {
      branchName: git?.branchName ?? null,
      headCommit: git?.headCommit ?? null,
      detached: git?.detached ?? true,
    },
    changedFiles: changedFiles.slice(0, 500),
    protocol: {
      phase: protocol?.phase ?? null,
      nextAction: protocol?.nextAction ?? null,
      failedPremiumReviewCount: protocol?.failedPremiumReviewCount ?? null,
      evidenceManifestPath: protocol?.evidenceManifestPath ?? null,
      fixDeltaManifestPath: protocol?.fixDeltaManifestPath ?? null,
    },
    plan: {
      path: protocol?.planPath ?? null,
      risk: plan && plan.status === 'present' ? plan.contract?.risk ?? null : null,
      requiredTestIds:
        plan && plan.status === 'present'
          ? (plan.contract?.requiredTests ?? []).map((test) => test.id)
          : [],
      architectureConditions:
        plan && plan.status === 'present'
          ? [
              ...(plan.contract?.independentReviewReasons ?? []),
              ...(plan.contract?.implementationContract?.invariants ?? []),
            ]
          : [],
    },
    verification: {
      manifestStatus: typeof manifest?.status === 'string' ? manifest.status : null,
      commandNames: commands
        .map((command) => (typeof command.name === 'string' ? command.name : ''))
        .filter(Boolean),
      requiredTestIds: Array.isArray(manifest?.requiredTests)
        ? (manifest.requiredTests as Array<{ id?: string }>)
            .map((test) => test.id)
            .filter((id): id is string => typeof id === 'string')
        : [],
      typecheck: typeof typecheck?.status === 'string' ? typecheck.status : null,
      lint:
        typeof oxlint?.status === 'string' && typeof eslint?.status === 'string'
          ? `${oxlint.status}+${eslint.status}`
          : null,
    },
  };
  const packet: PremiumReviewPacket = {
    ...draft,
    contentHash: hashText(JSON.stringify(draft)),
  };

  if (params.persist === false) {
    return { ok: true, packet, relativePath: null };
  }
  const relativePath = path
    .join(
      'docs_private',
      'automation',
      'workstreams',
      params.workstreamId,
      `premium-review-packet-${packet.contentHash}.json`
    )
    .replace(/\\/g, '/');
  writeJsonAtomic(path.join(params.repoRoot, relativePath), packet);
  return { ok: true, packet, relativePath };
}
