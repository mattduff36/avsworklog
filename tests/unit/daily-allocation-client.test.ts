import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DailyAllocationApiError,
  assignDailyAllocationLabour,
  convertDailyAllocationPlanDay,
  createDailyAllocationVisit,
  deleteDailyAllocationVisit,
  fetchDailyAllocationBoardRange,
  fetchDailyAllocationRuntime,
  isDailyAllocationStaleOrConflictError,
  moveDailyAllocationVisit,
  publishDailyAllocationPlanV2,
  updateDailyAllocationVisit,
} from '@/lib/client/daily-allocation';
import { getErrorStatus } from '@/lib/utils/http-error';

describe('daily allocation client wrappers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a range board with primitive start and end query params', async () => {
    const payload = { start_date: '2026-08-10', end_date: '2026-08-16', visits: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchDailyAllocationBoardRange('2026-08-10', '2026-08-16')).resolves.toEqual(payload);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/daily-allocation/board?start=2026-08-10&end=2026-08-16'
    );
  });

  it('throws DailyAllocationApiError with HTTP status and code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Plan is stale', code: 'STALE_PLAN_VERSION' }),
    }));

    try {
      await publishDailyAllocationPlanV2({
        snapshot_version: 2,
        plan_day_id: 'plan-1',
        expected_plan_version: 3,
        idempotency_key: 'idem-1',
      });
      throw new Error('expected publish to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DailyAllocationApiError);
      expect((error as DailyAllocationApiError).status).toBe(409);
      expect((error as DailyAllocationApiError).code).toBe('STALE_PLAN_VERSION');
      expect(getErrorStatus(error)).toBe(409);
      expect(isDailyAllocationStaleOrConflictError(error)).toBe(true);
    }
  });

  it('blocks mutations that still carry provisional ids', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      updateDailyAllocationVisit('optimistic:op:visit', {
        plan_day_id: 'plan-1',
        expected_plan_version: 1,
        job_source_type: 'project_number',
        job_source_id: 'job-1',
        job_code: 'J-1',
        starts_at: '2026-08-13T08:00:00.000Z',
        ends_at: '2026-08-13T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ code: 'PROVISIONAL_ID', status: 409 });

    await expect(
      assignDailyAllocationLabour({
        visit_id: 'optimistic:op:visit',
        profile_id: 'profile-1',
        expected_plan_version: 1,
      })
    ).rejects.toThrow('finish saving');

    await expect(
      deleteDailyAllocationVisit({
        visit_id: 'optimistic:op:visit',
        expected_plan_version: 1,
        expected_row_version: 1,
      })
    ).rejects.toThrow('finish saving');

    await expect(
      createDailyAllocationVisit({
        plan_day_id: 'optimistic:op:plan',
        expected_plan_version: 1,
        job_source_type: 'project_number',
        job_source_id: 'job-1',
        job_code: 'J-1',
        starts_at: '2026-08-13T08:00:00.000Z',
        ends_at: '2026-08-13T10:00:00.000Z',
      })
    ).rejects.toThrow('finish saving');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the authoritative convert plan id, version, team, and date', async () => {
    const payload = {
      plan_day_id: 'plan-existing-v7',
      plan_version: 7,
      team_id: 'team-1',
      work_date: '2026-08-15',
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      convertDailyAllocationPlanDay({ work_date: '2026-08-15', team_id: 'team-1' })
    ).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/daily-allocation/convert',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('fetches the v2 runtime gate and posts cross-plan visit moves', async () => {
    const runtime = { board_enabled: false, writes_enabled: false };
    const moveResult = {
      visit_id: 'visit-1',
      plan_day_id: 'plan-2',
      plan_version: 4,
      source_plan_day_id: 'plan-1',
      source_plan_version: 3,
      target_plan_day_id: 'plan-2',
      target_plan_version: 4,
      visit: { id: 'visit-1', plan_day_id: 'plan-2', row_version: 2 },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => runtime })
      .mockResolvedValueOnce({ ok: true, json: async () => moveResult });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchDailyAllocationRuntime()).resolves.toEqual(runtime);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/daily-allocation/runtime');

    await expect(moveDailyAllocationVisit({
      visit_id: 'visit-1',
      target_plan_day_id: 'plan-2',
      expected_source_plan_version: 2,
      expected_target_plan_version: 3,
      expected_row_version: 1,
      starts_at: '2026-08-15T08:00:00.000Z',
      ends_at: '2026-08-15T10:00:00.000Z',
    })).resolves.toEqual(moveResult);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/daily-allocation/visits/visit-1/move');
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
  });
});
