import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  invalidateQueries: vi.fn(),
  fetch: vi.fn(),
  assertUnlocked: vi.fn(),
  directDelete: vi.fn(),
  absenceExists: true,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: unknown) => options,
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
  }),
}));
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: true, isSuperAdmin: false }),
}));
vi.mock('@/lib/hooks/useRealtime', () => ({ useAbsenceRealtime: vi.fn() }));
vi.mock('@/lib/utils/absence-timesheet-impact', () => ({
  resolveAbsenceTimesheetImpacts: async () => [],
  assertNoLockedAbsenceTimesheetImpacts: mocks.assertUnlocked,
}));

import { useDeleteAbsence } from '@/lib/hooks/useAbsence';

const absence = {
  profile_id: 'employee', date: '2099-05-04', end_date: null, reason_id: 'reason',
  duration_days: 1, is_half_day: false, half_day_session: null, status: 'processed',
  notes: null, allow_timesheet_work_on_leave: false, is_bank_holiday: false,
  auto_generated: false, bulk_batch_id: null, updated_at: '2026-11-16T20:00:00Z',
  absence_reasons: { name: 'Annual Leave' }, profile: { full_name: 'Fixture employee' },
};

function DeleteAbsenceHarness() {
  // useMutation is replaced with its options so the actual hook mutation runs without React.
  return useDeleteAbsence() as unknown as {
    mutationFn: (id: string) => Promise<void>;
    onSuccess: () => void;
  };
}

describe('absence deletion mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.absenceExists = true;
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/timesheet-effects')) {
        return { ok: mocks.absenceExists, json: async () => ({ error: 'Absence not found' }) };
      }
      return { ok: true };
    });
    mocks.rpc.mockImplementation(async () => {
      mocks.absenceExists = false;
      return { data: 'absence', error: null };
    });
    mocks.from.mockImplementation((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        single: vi.fn(async () => ({ data: absence, error: null })),
        maybeSingle: vi.fn(async () => ({
          data: table === 'absence_financial_year_closures' ? null
            : table === 'profiles' ? { super_admin: true } : absence,
          error: null,
        })),
        delete: mocks.directDelete.mockImplementation(() => ({
          eq: vi.fn(async () => {
            mocks.absenceExists = false;
            return { error: null };
          }),
        })),
      };
      return query;
    });
  });

  it('deletes and reconciles through one version-bound RPC, then notifies', async () => {
    const options = DeleteAbsenceHarness();
    await options.mutationFn('absence');
    expect(mocks.rpc).toHaveBeenCalledWith('delete_absence_with_timesheet_effects', {
      p_absence_id: 'absence',
      p_expected_updated_at: absence.updated_at,
    });
    expect(mocks.directDelete).not.toHaveBeenCalled();
    expect(mocks.absenceExists).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe('/api/absence/absence/processed-change-notification');
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({
      action: 'deleted',
      previousAbsence: { id: 'absence', status: 'processed' },
    });
    options.onSuccess();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['absences'] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['absence-summary'] });
  });

  it('propagates transaction failure without notification or a non-atomic fallback', async () => {
    const error = { code: '40001', message: 'This absence has changed. Refresh and try again.' };
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(DeleteAbsenceHarness().mutationFn('absence')).rejects.toEqual(error);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.directDelete).not.toHaveBeenCalled();
    expect(mocks.absenceExists).toBe(true);
  });

  it('does not treat an RLS-filtered zero-row delete as success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(DeleteAbsenceHarness().mutationFn('absence')).rejects.toThrow(/not deleted/i);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('retains the client-side payroll-lock preflight', async () => {
    mocks.assertUnlocked.mockImplementationOnce(() => { throw new Error('This booking affects locked timesheets'); });
    await expect(DeleteAbsenceHarness().mutationFn('absence')).rejects.toThrow(/locked timesheets/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('keeps notification failure non-fatal after the transaction commits', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.fetch.mockRejectedValueOnce(new Error('Fixture notification unavailable'));
    try {
      await expect(DeleteAbsenceHarness().mutationFn('absence')).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith('Failed to notify processed absence change:', expect.any(Error));
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
