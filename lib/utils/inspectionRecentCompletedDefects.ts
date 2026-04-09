import { extractInspectionDefectSignature } from '@/lib/utils/inspectionDefectSignature';

export interface CompletedDefectActionSummary {
  description?: string | null;
  actioned_at?: string | null;
  updated_at?: string | null;
}

export interface RecentCompletedDefectSummary {
  completedAt: string;
}

export function buildRecentCompletedDefectMap(
  actions: CompletedDefectActionSummary[],
  options?: {
    lookbackDays?: number;
    now?: Date;
  }
): Map<string, RecentCompletedDefectSummary> {
  const lookbackDays = options?.lookbackDays ?? 7;
  const now = options?.now ?? new Date();
  const cutoffMs = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const recentCompleted = new Map<string, RecentCompletedDefectSummary>();

  actions.forEach((action) => {
    const signature = extractInspectionDefectSignature(action.description);
    const completedAt = action.actioned_at || action.updated_at || null;

    if (!signature || !completedAt) {
      return;
    }

    const completedAtMs = new Date(completedAt).getTime();
    if (Number.isNaN(completedAtMs) || completedAtMs < cutoffMs) {
      return;
    }

    const existing = recentCompleted.get(signature);
    if (!existing || new Date(existing.completedAt).getTime() < completedAtMs) {
      recentCompleted.set(signature, { completedAt });
    }
  });

  return recentCompleted;
}
