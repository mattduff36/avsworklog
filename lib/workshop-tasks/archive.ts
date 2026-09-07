import { subMonths } from 'date-fns';

export const WORKSHOP_TASK_ARCHIVE_AFTER_MONTHS = 3;

export type WorkshopArchiveAssetTab = 'all' | 'van' | 'plant' | 'hgv';

export function getWorkshopTaskArchiveCutoff(now: Date = new Date()): Date {
  return subMonths(now, WORKSHOP_TASK_ARCHIVE_AFTER_MONTHS);
}

export function getWorkshopTaskArchiveCutoffIso(now: Date = new Date()): string {
  return getWorkshopTaskArchiveCutoff(now).toISOString();
}

export function isArchivedWorkshopTask(
  task?: { status?: string | null; actioned_at?: string | null } | null,
  now: Date = new Date()
): boolean {
  if (!task || task.status !== 'completed' || !task.actioned_at) {
    return false;
  }

  const completedAt = Date.parse(task.actioned_at);
  if (!Number.isFinite(completedAt)) {
    return false;
  }

  return completedAt < getWorkshopTaskArchiveCutoff(now).getTime();
}

export function getWorkshopActiveTaskOrFilter(now: Date = new Date()): string {
  const cutoffIso = getWorkshopTaskArchiveCutoffIso(now);
  return `status.neq.completed,actioned_at.is.null,actioned_at.gte."${cutoffIso}"`;
}

export function getWorkshopVehicleOrFilter(vehicleFilter: string): string | null {
  if (!vehicleFilter || vehicleFilter === 'all') {
    return null;
  }

  return `van_id.eq.${vehicleFilter},plant_id.eq.${vehicleFilter},hgv_id.eq.${vehicleFilter}`;
}

export function shouldIncludeWorkshopTaskInActiveList(
  task?: { status?: string | null; actioned_at?: string | null } | null,
  now: Date = new Date()
): boolean {
  return !isArchivedWorkshopTask(task, now);
}

export function shouldFetchArchivedWorkshopRows(args: {
  showArchived: boolean;
  loadedKey: string;
  cacheKey: string;
}): boolean {
  return args.showArchived && args.loadedKey !== args.cacheKey;
}

export function takeLatestArchivedCount(
  requestId: number,
  currentRequestId: number,
  count: number | null
): number | null {
  if (requestId !== currentRequestId) {
    return null;
  }
  return count;
}

export function getWorkshopAssetTabColumn(
  assetTab: WorkshopArchiveAssetTab
): 'van_id' | 'plant_id' | 'hgv_id' | null {
  if (assetTab === 'van') return 'van_id';
  if (assetTab === 'plant') return 'plant_id';
  if (assetTab === 'hgv') return 'hgv_id';
  return null;
}
