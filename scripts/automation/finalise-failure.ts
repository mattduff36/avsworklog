import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import type { FinaliseTaskKey } from '../finalise-recent-tasks';
import {
  type FinaliseModeKey,
  getFinaliseRepairSafetyFingerprint,
  getFinaliseTaskFingerprint,
} from './finalise-checkpoint';
import { writeJsonAtomic } from './workflow-events';

export interface FinaliseFailureArtifact {
  schemaVersion: '1';
  originalMode: FinaliseModeKey;
  failedStep: FinaliseTaskKey | 'other';
  command: string;
  inputFingerprint: string;
  safetyFingerprint: string;
  workstreamId: string | null;
  createdAt: string;
  repairAttemptCount: number;
}

interface FinaliseRepairHistory {
  schemaVersion: '1';
  attempts: Array<{
    safetyFingerprint: string;
    originalMode: FinaliseModeKey;
    failedStep: FinaliseTaskKey;
    attemptedAt: string;
  }>;
}

export function getFinaliseFailurePath(repoRoot: string): string {
  return path.join(repoRoot, 'docs_private', 'automation', 'finalise-last-failure.json');
}

function getFinaliseRepairHistoryPath(repoRoot: string): string {
  return path.join(repoRoot, 'docs_private', 'automation', 'finalise-repair-history.json');
}

export function writeFinaliseFailureArtifact(params: {
  repoRoot: string;
  originalMode: FinaliseModeKey;
  failedStep: FinaliseTaskKey;
  command: string;
  workstreamId?: string | null;
}): FinaliseFailureArtifact {
  const artifact: FinaliseFailureArtifact = {
    schemaVersion: '1',
    originalMode: params.originalMode,
    failedStep: params.failedStep,
    command: params.command,
    inputFingerprint: getFinaliseTaskFingerprint({
      repoRoot: params.repoRoot,
      task: params.failedStep,
      mode: params.originalMode,
      command: params.command,
    }),
    safetyFingerprint: getFinaliseRepairSafetyFingerprint({
      repoRoot: params.repoRoot,
      task: params.failedStep,
      mode: params.originalMode,
      command: params.command,
    }),
    workstreamId: params.workstreamId ?? null,
    createdAt: new Date().toISOString(),
    repairAttemptCount: 0,
  };
  writeJsonAtomic(getFinaliseFailurePath(params.repoRoot), artifact);
  return artifact;
}

export function readFinaliseFailureArtifact(repoRoot: string): FinaliseFailureArtifact | null {
  const filePath = getFinaliseFailurePath(repoRoot);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as FinaliseFailureArtifact;
    if (
      parsed.schemaVersion !== '1' ||
      !['finalise', 'finalise-full', 'fap', 'ffap'].includes(parsed.originalMode) ||
      typeof parsed.failedStep !== 'string' ||
      typeof parsed.command !== 'string' ||
      typeof parsed.inputFingerprint !== 'string' ||
      typeof parsed.safetyFingerprint !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      (parsed.repairAttemptCount !== undefined &&
        (!Number.isInteger(parsed.repairAttemptCount) || parsed.repairAttemptCount < 0))
    ) {
      return null;
    }
    return { ...parsed, repairAttemptCount: parsed.repairAttemptCount ?? 0 };
  } catch {
    return null;
  }
}

export function incrementFinaliseRepairAttempt(
  repoRoot: string
): FinaliseFailureArtifact | null {
  const artifact = readFinaliseFailureArtifact(repoRoot);
  if (!artifact) return null;
  const next = {
    ...artifact,
    repairAttemptCount: artifact.repairAttemptCount + 1,
  };
  writeJsonAtomic(getFinaliseFailurePath(repoRoot), next);
  return next;
}

export function recordFinaliseRepairHistory(
  repoRoot: string,
  artifact: FinaliseFailureArtifact
): number {
  const historyPath = getFinaliseRepairHistoryPath(repoRoot);
  let history: FinaliseRepairHistory = { schemaVersion: '1', attempts: [] };
  if (existsSync(historyPath)) {
    try {
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8')) as FinaliseRepairHistory;
      if (parsed.schemaVersion === '1' && Array.isArray(parsed.attempts)) {
        history = parsed;
      }
    } catch {
      history = { schemaVersion: '1', attempts: [] };
    }
  }
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const attempts = history.attempts
    .filter((attempt) => Number.isFinite(Date.parse(attempt.attemptedAt)))
    .filter((attempt) => Date.parse(attempt.attemptedAt) >= cutoff)
    .slice(-99);
  attempts.push({
    safetyFingerprint: artifact.safetyFingerprint,
    originalMode: artifact.originalMode,
    failedStep: artifact.failedStep as FinaliseTaskKey,
    attemptedAt: new Date(now).toISOString(),
  });
  writeJsonAtomic(historyPath, { schemaVersion: '1', attempts } satisfies FinaliseRepairHistory);
  return attempts.filter(
    (attempt) =>
      attempt.safetyFingerprint === artifact.safetyFingerprint &&
      attempt.originalMode === artifact.originalMode &&
      attempt.failedStep === artifact.failedStep
  ).length;
}

export function clearFinaliseFailureArtifact(repoRoot: string): void {
  rmSync(getFinaliseFailurePath(repoRoot), { force: true });
}
