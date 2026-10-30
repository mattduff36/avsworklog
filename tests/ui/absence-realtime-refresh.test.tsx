/** @vitest-environment happy-dom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AllowancesContent } from '@/app/(dashboard)/absence/manage/components/AllowancesContent';
import { useAbsenceRealtimeQueryInvalidation } from '@/lib/hooks/useAbsence';
import { getFinancialYear } from '@/lib/utils/date';
import { toast } from 'sonner';

type DirectoryProfile = {
  id: string;
  full_name: string;
  employee_id: string | null;
  annual_holiday_allowance_days: number | null;
  team: { id: string; name: string } | null;
  role: { id: string; name: string; display_name: string } | null;
};

type DirectoryWaiter = {
  resolve: (rows: DirectoryProfile[]) => void;
  reject: (error: unknown) => void;
};

const navigation = vi.hoisted(() => ({ tab: 'allowances' }));

const realtime = vi.hoisted(() => {
  const listeners: Array<(payload: { eventType: string }) => void> = [];
  const channelNames: string[] = [];
  const channel = vi.fn((name: string) => {
    channelNames.push(name);
    return {
      on: (_event: string, _opts: unknown, callback: (payload: { eventType: string }) => void) => {
        listeners.push(callback);
        return { subscribe: () => ({}) };
      },
    };
  });
  return { listeners, channelNames, channel, removeChannel: vi.fn() };
});

const control = vi.hoisted(() => ({
  deferDirectory: false,
  directoryCalls: 0,
  directoryWaiters: [] as DirectoryWaiter[],
  profiles: [] as DirectoryProfile[],
  reasons: [] as Array<{ id: string; name: string; is_active: boolean; color: string | null }>,
  absenceRows: [] as Array<{
    profile_id: string;
    reason_id: string;
    status: string;
    duration_days: number;
    date: string;
  }>,
  carryoverRows: [] as Array<{ profile_id: string; carried_days: number }>,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/absence/manage',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`tab=${navigation.tab}`),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children?: unknown }) => children,
  DialogContent: ({ children }: { children?: unknown }) => children,
  DialogDescription: ({ children }: { children?: unknown }) => children,
  DialogFooter: ({ children }: { children?: unknown }) => children,
  DialogHeader: ({ children }: { children?: unknown }) => children,
  DialogTitle: ({ children }: { children?: unknown }) => children,
}));

vi.mock('@/lib/client/user-directory', () => ({
  fetchUserDirectory: () => {
    control.directoryCalls += 1;
    if (control.deferDirectory) {
      return new Promise<DirectoryProfile[]>((resolve, reject) => {
        control.directoryWaiters.push({ resolve, reject });
      });
    }
    return Promise.resolve(control.profiles);
  },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: realtime.channel,
    removeChannel: realtime.removeChannel,
    from: (table: string) => {
      const builder = {
        select: () => builder,
        order: () => builder,
        gte: () => builder,
        lte: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (
          onFulfilled: (value: { data: unknown; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) =>
          Promise.resolve().then(() => {
            if (table === 'absence_reasons') return { data: control.reasons, error: null };
            if (table === 'absences') return { data: control.absenceRows, error: null };
            if (table === 'absence_allowance_carryovers') return { data: control.carryoverRows, error: null };
            return { data: [], error: null };
          }).then(onFulfilled, onRejected),
      };
      return builder;
    },
  }),
}));

function financialYearStart() {
  return getFinancialYear(new Date()).start;
}

function isoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function profile(id: string, name: string, teamId: string): DirectoryProfile {
  return {
    id,
    full_name: name,
    employee_id: id === 'profile-1' ? 'E001' : 'E002',
    annual_holiday_allowance_days: 20,
    team: { id: teamId, name: teamId === 'team-a' ? 'Alpha' : 'Beta' },
    role: { id: 'role-1', name: 'driver', display_name: 'Driver' },
  };
}

function absence(profileId: string, duration: number) {
  return {
    profile_id: profileId,
    reason_id: 'reason-annual',
    status: 'approved',
    duration_days: duration,
    date: isoDate(financialYearStart()),
  };
}

function generationPayload() {
  const startYear = financialYearStart().getFullYear();
  return {
    currentFinancialYearStartYear: startYear,
    latestGeneratedFinancialYearStartYear: startYear,
    latestGeneratedFinancialYearLabel: `${startYear}/${String(startYear + 1).slice(-2)}`,
    latestGeneratedFinancialYearEndDate: `${startYear + 1}-03-31`,
    nextFinancialYearStartYear: startYear + 1,
    nextFinancialYearLabel: `${startYear + 1}/${String(startYear + 2).slice(-2)}`,
    closedFinancialYearStartYears: [],
  };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function emitAbsenceChange() {
  if (realtime.listeners.length !== 1) {
    throw new Error(`expected one absence listener, found ${realtime.listeners.length}`);
  }
  act(() => {
    realtime.listeners[0]({ eventType: 'INSERT' });
  });
}

function AbsenceOwner({
  childMounted = true,
  initialRefreshKey = 0,
  scopeTeamOnly = false,
  actorTeamId = null as string | null,
}) {
  const [refreshKey, setRefreshKey] = useState(initialRefreshKey);
  useAbsenceRealtimeQueryInvalidation(true, () => {
    setRefreshKey((current) => current + 1);
  });
  if (!childMounted) return null;
  return (
    <AllowancesContent
      refreshKey={refreshKey}
      scopeTeamOnly={scopeTeamOnly}
      actorTeamId={actorTeamId}
    />
  );
}

function renderOwner(props: Partial<ComponentProps<typeof AbsenceOwner>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AbsenceOwner {...props} />
    </QueryClientProvider>
  );
  return { ...view, invalidateQueries, queryClient };
}

describe('absence allowance realtime ownership', () => {
  beforeEach(() => {
    navigation.tab = 'allowances';
    control.deferDirectory = false;
    control.directoryCalls = 0;
    control.directoryWaiters = [];
    control.profiles = [profile('profile-1', 'Alex Able', 'team-a')];
    control.reasons = [{ id: 'reason-annual', name: 'Annual Leave', is_active: true, color: '#8b5cf6' }];
    control.absenceRows = [absence('profile-1', 2)];
    control.carryoverRows = [];
    realtime.listeners.length = 0;
    realtime.channelNames.length = 0;
    realtime.channel.mockClear();
    realtime.removeChannel.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/api/absence/generation/status')) {
          return jsonResponse(generationPayload());
        }
        if (url.includes('/api/absence/shutdown')) {
          return jsonResponse({
            success: true,
            batches: [
              {
                id: 'batch-1',
                reasonId: 'reason-annual',
                reasonName: 'Shutdown Leave',
                startDate: isoDate(financialYearStart()),
                endDate: isoDate(financialYearStart()),
                notes: null,
                applyToAll: true,
                roleNames: [],
                explicitProfileIds: [],
                targetedEmployees: 1,
                createdCount: 1,
                duplicateCount: 0,
                createdAt: '2026-10-01T00:00:00.000Z',
                createdByName: 'Manager',
              },
            ],
          });
        }
        return jsonResponse({});
      })
    );
  });

  it('uses one parent subscription and reloads the allowance total once per event', async () => {
    const { invalidateQueries } = renderOwner();

    await screen.findAllByText('Alex Able');
    expect(screen.getAllByText('18').length).toBeGreaterThan(0);
    expect(realtime.channelNames).toEqual(['absences_changes']);
    expect(control.directoryCalls).toBe(1);
    expect(invalidateQueries).not.toHaveBeenCalled();

    control.absenceRows = [absence('profile-1', 5)];
    emitAbsenceChange();

    await waitFor(() => {
      expect(screen.getAllByText('15').length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText('18')).toHaveLength(0);
    expect(realtime.channelNames).toEqual(['absences_changes']);
    expect(realtime.listeners).toHaveLength(1);
    expect(control.directoryCalls).toBe(2);
    expect(invalidateQueries.mock.calls.map((call) => call[0])).toEqual([
      { queryKey: ['absences'] },
      { queryKey: ['absence-summary'] },
    ]);
  });

  it('loads once for a hidden tab, a remount, and a nonzero refresh key', async () => {
    navigation.tab = 'overview';
    const { rerender, queryClient } = renderOwner({ initialRefreshKey: 4, childMounted: true });

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/api/absence/generation/status'))).toBe(true);
    });
    expect(control.directoryCalls).toBe(0);
    expect(realtime.channelNames).toEqual(['absences_changes']);

    navigation.tab = 'allowances';
    rerender(
      <QueryClientProvider client={queryClient}>
        <AbsenceOwner initialRefreshKey={4} childMounted />
      </QueryClientProvider>
    );
    await screen.findAllByText('Alex Able');
    expect(control.directoryCalls).toBe(1);
    expect(screen.getAllByText('18').length).toBeGreaterThan(0);

    rerender(
      <QueryClientProvider client={queryClient}>
        <AbsenceOwner initialRefreshKey={4} childMounted={false} />
      </QueryClientProvider>
    );
    control.absenceRows = [absence('profile-1', 5)];
    emitAbsenceChange();
    expect(control.directoryCalls).toBe(1);
    expect(realtime.channelNames).toEqual(['absences_changes']);

    rerender(
      <QueryClientProvider client={queryClient}>
        <AbsenceOwner initialRefreshKey={4} childMounted />
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getAllByText('15').length).toBeGreaterThan(0);
    });
    expect(control.directoryCalls).toBe(2);
    expect(realtime.channelNames).toEqual(['absences_changes']);
  });

  it('ignores an older in-flight allowance response and its error', async () => {
    control.deferDirectory = true;
    renderOwner();

    await waitFor(() => expect(control.directoryWaiters).toHaveLength(1));
    emitAbsenceChange();
    await waitFor(() => expect(control.directoryWaiters).toHaveLength(2));

    await act(async () => {
      control.directoryWaiters[0].reject(new Error('older allowance load failed'));
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(screen.queryAllByText('Alex Able')).toHaveLength(0);

    control.absenceRows = [absence('profile-1', 5)];
    await act(async () => {
      control.directoryWaiters[1].resolve(control.profiles);
    });

    await waitFor(() => {
      expect(screen.getAllByText('15').length).toBeGreaterThan(0);
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(screen.queryAllByText('18')).toHaveLength(0);
  });

  it('ignores an older response when the scope changes and drops it on unmount', async () => {
    control.deferDirectory = true;
    const { rerender, unmount, queryClient } = renderOwner({
      scopeTeamOnly: true,
      actorTeamId: 'team-a',
    });

    await waitFor(() => expect(control.directoryWaiters).toHaveLength(1));
    rerender(
      <QueryClientProvider client={queryClient}>
        <AbsenceOwner scopeTeamOnly actorTeamId="team-b" />
      </QueryClientProvider>
    );
    await waitFor(() => expect(control.directoryWaiters).toHaveLength(2));

    control.absenceRows = [absence('profile-2', 5)];
    await act(async () => {
      control.directoryWaiters[1].resolve([profile('profile-2', 'Blake Bright', 'team-b')]);
    });
    await screen.findAllByText('Blake Bright');

    control.absenceRows = [absence('profile-1', 9)];
    await act(async () => {
      control.directoryWaiters[0].resolve([profile('profile-1', 'Alex Able', 'team-a')]);
    });
    await waitFor(() => {
      expect(screen.getAllByText('15').length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText('Alex Able')).toHaveLength(0);
    expect(screen.queryAllByText('11')).toHaveLength(0);

    rerender(
      <QueryClientProvider client={queryClient}>
        <AbsenceOwner scopeTeamOnly actorTeamId="team-a" />
      </QueryClientProvider>
    );
    await waitFor(() => expect(control.directoryWaiters).toHaveLength(3));
    unmount();
    await act(async () => {
      control.directoryWaiters[2].reject(new Error('unmounted allowance load'));
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(realtime.removeChannel).toHaveBeenCalled();
  });

  it('reloads open bulk undo history from the parent refresh without a second subscription', async () => {
    renderOwner();
    await screen.findAllByText('Alex Able');

    fireEvent.click(screen.getByRole('button', { name: 'Undo Bulk Absence' }));
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/api/absence/shutdown'))).toHaveLength(1);
    });
    expect(realtime.channelNames).toEqual(['absences_changes']);

    control.absenceRows = [absence('profile-1', 5)];
    emitAbsenceChange();

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/api/absence/shutdown'))).toHaveLength(2);
    });
    await waitFor(() => {
      expect(screen.getAllByText('15').length).toBeGreaterThan(0);
    });
    expect(realtime.channelNames).toEqual(['absences_changes']);
    expect(screen.getAllByText('Shutdown Leave').length).toBeGreaterThan(0);
  });
});
