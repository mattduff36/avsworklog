import { describe, expect, it } from 'vitest';
import {
  WORKSHOP_TASK_ARCHIVE_AFTER_MONTHS,
  getWorkshopActiveTaskOrFilter,
  getWorkshopAssetTabColumn,
  getWorkshopTaskArchiveCutoff,
  getWorkshopTaskArchiveCutoffIso,
  getWorkshopVehicleOrFilter,
  isArchivedWorkshopTask,
  shouldFetchArchivedWorkshopRows,
  shouldIncludeWorkshopTaskInActiveList,
  takeLatestArchivedCount,
} from '@/lib/workshop-tasks/archive';

const NOW = new Date('2026-09-07T12:00:00.000Z');

describe('workshop task archive clock', () => {
  it('uses a 3 calendar month cutoff from actioned_at', () => {
    expect(WORKSHOP_TASK_ARCHIVE_AFTER_MONTHS).toBe(3);
    expect(getWorkshopTaskArchiveCutoff(NOW).toISOString()).toBe('2026-06-07T12:00:00.000Z');
    expect(getWorkshopTaskArchiveCutoffIso(NOW)).toBe('2026-06-07T12:00:00.000Z');
  });

  it('archives completed tasks older than the cutoff', () => {
    expect(isArchivedWorkshopTask({
      status: 'completed',
      actioned_at: '2026-06-07T11:59:59.999Z',
    }, NOW)).toBe(true);
  });

  it('keeps a task completed at the exact cutoff in Completed', () => {
    expect(isArchivedWorkshopTask({
      status: 'completed',
      actioned_at: '2026-06-07T12:00:00.000Z',
    }, NOW)).toBe(false);
  });

  it('keeps recent completed tasks in Completed', () => {
    expect(isArchivedWorkshopTask({
      status: 'completed',
      actioned_at: '2026-08-01T09:00:00.000Z',
    }, NOW)).toBe(false);
  });

  it('keeps completed tasks without actioned_at in Completed', () => {
    expect(isArchivedWorkshopTask({
      status: 'completed',
      actioned_at: null,
    }, NOW)).toBe(false);
  });

  it('treats a missing task as not archived', () => {
    expect(isArchivedWorkshopTask(undefined, NOW)).toBe(false);
    expect(isArchivedWorkshopTask(null, NOW)).toBe(false);
  });

  it('does not archive non-completed tasks even with an old actioned_at', () => {
    expect(isArchivedWorkshopTask({
      status: 'logged',
      actioned_at: '2025-01-01T00:00:00.000Z',
    }, NOW)).toBe(false);
  });

  it('builds a quoted PostgREST filter that excludes archived completed rows', () => {
    expect(getWorkshopActiveTaskOrFilter(NOW)).toBe(
      'status.neq.completed,actioned_at.is.null,actioned_at.gte."2026-06-07T12:00:00.000Z"'
    );
  });

  it('excludes archived rows from the active workshop list', () => {
    expect(shouldIncludeWorkshopTaskInActiveList({
      status: 'completed',
      actioned_at: '2026-06-07T11:59:59.999Z',
    }, NOW)).toBe(false);
    expect(shouldIncludeWorkshopTaskInActiveList({
      status: 'completed',
      actioned_at: '2026-06-07T12:00:00.000Z',
    }, NOW)).toBe(true);
    expect(shouldIncludeWorkshopTaskInActiveList({
      status: 'pending',
      actioned_at: null,
    }, NOW)).toBe(true);
  });

  it('loads archived rows only on expand or cache-key change', () => {
    expect(shouldFetchArchivedWorkshopRows({
      showArchived: false,
      loadedKey: '',
      cacheKey: 'all|all',
    })).toBe(false);
    expect(shouldFetchArchivedWorkshopRows({
      showArchived: true,
      loadedKey: '',
      cacheKey: 'all|all',
    })).toBe(true);
    expect(shouldFetchArchivedWorkshopRows({
      showArchived: true,
      loadedKey: 'all|all',
      cacheKey: 'all|all',
    })).toBe(false);
    expect(shouldFetchArchivedWorkshopRows({
      showArchived: true,
      loadedKey: 'all|all',
      cacheKey: 'vehicle-1|van',
    })).toBe(true);
  });

  it('discards stale archived counts', () => {
    expect(takeLatestArchivedCount(1, 2, 40)).toBeNull();
    expect(takeLatestArchivedCount(2, 2, 12)).toBe(12);
  });

  it('builds vehicle and asset-tab filters', () => {
    expect(getWorkshopVehicleOrFilter('all')).toBeNull();
    expect(getWorkshopVehicleOrFilter('vehicle-1')).toBe(
      'van_id.eq.vehicle-1,plant_id.eq.vehicle-1,hgv_id.eq.vehicle-1'
    );
    expect(getWorkshopAssetTabColumn('all')).toBeNull();
    expect(getWorkshopAssetTabColumn('van')).toBe('van_id');
    expect(getWorkshopAssetTabColumn('plant')).toBe('plant_id');
    expect(getWorkshopAssetTabColumn('hgv')).toBe('hgv_id');
  });
});
