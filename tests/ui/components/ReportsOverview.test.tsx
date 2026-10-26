/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { useSyncExternalStore, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReportsPage from '@/app/(dashboard)/reports/page';

const reportsGate = vi.hoisted(() => ({ hasPermission: true, loading: false }));
const permissionSnapshot = vi.hoisted(() => ({
  permissionSnapshotState: 'ready' as 'loading' | 'error' | 'ready',
  permissionLevels: null as Record<string, number> | null,
  moduleMinimumAccessLevels: null as Record<string, number> | null,
}));

const ACCESS_MODULES = ['reports', 'timesheets', 'daily-allocation', 'absence', 'inspections', 'plant-inspections', 'hgv-inspections'] as const;

function grantSnapshot(levels: Record<string, number> = {}, minima: Record<string, number> = {}) {
  permissionSnapshot.permissionSnapshotState = 'ready';
  permissionSnapshot.permissionLevels = Object.fromEntries(ACCESS_MODULES.map((name) => [name, levels[name] ?? 5]));
  permissionSnapshot.moduleMinimumAccessLevels = Object.fromEntries(ACCESS_MODULES.map((name) => [name, minima[name] ?? 1]));
}

const store = vi.hoisted(() => {
  let tab = 'reports';
  let reportTab = 'all';
  const listeners = new Set<() => void>();
  return {
    get tab() { return tab; },
    get reportTab() { return reportTab; },
    set(key: 'tab' | 'reportTab', value: string) {
      if (key === 'tab') tab = value;
      else reportTab = value;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset(next?: { tab?: string; reportTab?: string }) {
      tab = next?.tab ?? 'reports';
      reportTab = next?.reportTab ?? 'all';
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock('nuqs', () => ({
  useQueryState: (key: 'tab' | 'reportTab') => {
    const value = useSyncExternalStore(
      (listener) => store.subscribe(listener),
      () => (key === 'tab' ? store.tab : store.reportTab),
      () => (key === 'tab' ? store.tab : store.reportTab),
    );
    return [value, (next: string) => store.set(key, next)] as const;
  },
}));

vi.mock('@/components/providers/NuqsClientAdapter', () => ({
  NuqsClientAdapter: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: () => ({ hasPermission: reportsGate.hasPermission, loading: reportsGate.loading }),
}));

vi.mock('@/lib/hooks/usePermissionSnapshot', () => ({
  usePermissionSnapshot: () => permissionSnapshot,
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('@/components/reports/JobLabourReport', () => ({
  JobLabourReport: ({ dateFrom, dateTo, accessDeniedReason }: { dateFrom: string; dateTo: string; accessDeniedReason?: string | null }) => (
    <div data-testid="job-labour">{accessDeniedReason || `Job labour ${dateFrom} to ${dateTo}`}</div>
  ),
}));

const fetchMock = vi.fn();
const downloads: string[] = [];

function renderReports() {
  return render(<ReportsPage />);
}

describe('Reports module overview', () => {
  beforeEach(() => {
    reportsGate.hasPermission = true;
    reportsGate.loading = false;
    grantSnapshot();
    store.reset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(new Blob(['xlsx']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    downloads.length = 0;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows four canonical modules, ten reports, and no quotes or suggestions', () => {
    renderReports();
    for (const heading of ['Timesheets', 'Daily Allocation', 'Daily Checks', 'Absence & Leave']) {
      const title = screen.getByRole('heading', { name: heading, level: 2 });
      expect(title.closest('section')?.querySelector('svg')).toBeTruthy();
    }
    expect(screen.queryByRole('heading', { name: 'Quotes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Quotes Conversion Funnel')).not.toBeInTheDocument();
    expect(screen.queryByText(/Review the working week/i)).not.toBeInTheDocument();
    expect(screen.queryByText('More Reports')).not.toBeInTheDocument();
    expect(screen.queryByText(/suggestion/i)).not.toBeInTheDocument();
    for (const title of [
      'Weekly Timesheet Summary',
      'Payroll Export',
      'Plant Usage',
      'Job Labour',
      'Daily Checks Compliance Summary',
      'Daily Checks Defects Log',
      'Bulk Daily Check PDFs',
      'Absence & Leave Bookings',
      'Absence Allowance Snapshot',
      'Absence Weekly Print Sheet',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(title) })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /Download Excel for/ })).not.toBeInTheDocument();
  });

  it('toggles report details and arrow direction, and switches between reports', () => {
    renderReports();
    const labour = screen.getByRole('button', { name: /Job Labour/ });
    expect(labour).toHaveAttribute('aria-expanded', 'false');
    expect(labour.querySelector('.lucide-arrow-right')).toBeTruthy();
    fireEvent.click(labour);
    expect(labour).toHaveAttribute('aria-expanded', 'true');
    expect(labour.querySelector('.lucide-arrow-down')).toBeTruthy();
    expect(screen.getByTestId('job-labour')).toBeInTheDocument();
    fireEvent.click(labour);
    expect(labour).toHaveAttribute('aria-expanded', 'false');
    expect(labour.querySelector('.lucide-arrow-right')).toBeTruthy();
    expect(screen.queryByTestId('job-labour')).not.toBeInTheDocument();
    fireEvent.click(labour);
    const payroll = screen.getByRole('button', { name: /Payroll Export/ });
    fireEvent.click(payroll);
    expect(labour).toHaveAttribute('aria-expanded', 'false');
    expect(payroll).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByTestId('job-labour')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close report setup' }));
    expect(payroll).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps module links and falls retired quotes, future, and settings links back to all reports', () => {
    act(() => store.reset({ reportTab: 'timesheets' }));
    const { rerender } = renderReports();
    expect(screen.getByRole('button', { name: /Payroll Export/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plant Usage/ })).not.toBeInTheDocument();

    act(() => store.reset({ tab: 'inspections' }));
    rerender(<ReportsPage />);
    expect(screen.getByRole('button', { name: /Daily Checks Defects Log/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Payroll Export/ })).not.toBeInTheDocument();

    act(() => store.reset({ reportTab: 'quotes', tab: 'quotes' }));
    rerender(<ReportsPage />);
    expect(screen.getByRole('heading', { name: 'Timesheets', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Plant Usage/ })).toBeInTheDocument();
    expect(screen.queryByText('Quotes Conversion Funnel')).not.toBeInTheDocument();

    act(() => store.reset({ reportTab: 'future', tab: 'settings' }));
    rerender(<ReportsPage />);
    expect(screen.getByRole('button', { name: /Absence Allowance Snapshot/ })).toBeInTheDocument();
    expect(screen.queryByText('No settings for this module yet.')).not.toBeInTheDocument();
  });

  it('downloads the selected report and blocks an invalid range', async () => {
    renderReports();
    fireEvent.click(screen.getByRole('button', { name: /Payroll Export/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });
    const payroll = screen.getByRole('button', { name: 'Download Excel for Payroll Export' });
    expect(screen.getByRole('alert')).toHaveTextContent('The end date must be on or after the start date.');
    expect(payroll).toBeDisabled();
    fireEvent.click(payroll);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Choose both a start date and an end date.');

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel for Payroll Export' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/reports/timesheets/payroll?');
    expect(url).toContain('dateFrom=2026-10-01');
    expect(url).toContain('dateTo=2026-10-07');
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
  });

  it('limits plant usage to 62 days and sends the allowance snapshot start date only', async () => {
    renderReports();
    fireEvent.click(screen.getByRole('button', { name: /Plant Usage/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-04-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a range of 62 days or fewer.');
    expect(screen.getByRole('button', { name: 'Download Excel for Plant Usage' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Absence Allowance Snapshot/ }));
    expect(screen.getByLabelText('As at')).toHaveValue('2026-01-01');
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('As at'), { target: { value: '2026-03-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel for Absence Allowance Snapshot' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/reports/absence-leave/allowance-totals?dateFrom=2026-03-15&dateTo=2026-03-15');
    expect(downloads).toEqual(['Absence_Allowance_Snapshot_2026-03-15.xlsx']);
  });

  it('places Job Labour setup beside Daily Allocation and searches the whole catalogue', () => {
    renderReports();
    fireEvent.click(screen.getByRole('button', { name: /Job Labour/ }));
    const setup = screen.getByTestId('job-labour');
    expect(setup.closest('section')).toContainElement(screen.getByRole('heading', { name: 'Daily Allocation', level: 2 }));
    expect(screen.queryByRole('button', { name: 'Download Excel for Job Labour' })).not.toBeInTheDocument();
    expect(screen.queryByText('Sample preview')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search reports'), { target: { value: 'no-such-report' } });
    expect(screen.getByText('No reports match this search.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('button', { name: /Payroll Export/ })).toBeInTheDocument();
  });

  it('keeps absence rows visible and disables download at the configured level', () => {
    grantSnapshot({ absence: 0 }, { absence: 2 });
    renderReports();
    expect(screen.getAllByRole('button', { name: /Excel|PDF/ })).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: /Absence & Leave Bookings/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });
    const download = screen.getByRole('button', { name: 'Download Excel for Absence & Leave Bookings' });
    expect(download).toBeDisabled();
    expect(download.parentElement).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Requires Absence & Leave level 2 or higher.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The end date must be on or after the start date.');
    fireEvent.click(download);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides the catalogue without Reports access', () => {
    reportsGate.hasPermission = false;
    renderReports();
    expect(screen.queryByRole('heading', { name: 'Timesheets', level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Payroll Export/ })).not.toBeInTheDocument();
  });

  it('fails closed while the snapshot is loading, missing, or stale after an error', () => {
    permissionSnapshot.permissionSnapshotState = 'loading';
    grantSnapshot();
    permissionSnapshot.permissionSnapshotState = 'loading';
    const { rerender } = renderReports();
    fireEvent.click(screen.getByRole('button', { name: /Payroll Export/ }));
    expect(screen.getByRole('button', { name: 'Download Excel for Payroll Export' })).toBeDisabled();
    expect(screen.getByText('Permissions are still loading.')).toBeInTheDocument();

    permissionSnapshot.permissionSnapshotState = 'ready';
    permissionSnapshot.permissionLevels = null;
    permissionSnapshot.moduleMinimumAccessLevels = null;
    rerender(<ReportsPage />);
    expect(screen.getByRole('button', { name: 'Download Excel for Payroll Export' })).toBeDisabled();
    expect(screen.getByText('Report permissions could not be confirmed.')).toBeInTheDocument();

    grantSnapshot();
    permissionSnapshot.permissionSnapshotState = 'error';
    rerender(<ReportsPage />);
    expect(screen.getByRole('button', { name: 'Download Excel for Payroll Export' })).toBeDisabled();
    expect(screen.getByText('Report permissions could not be confirmed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel for Payroll Export' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a daily check when any one inspection module is open and blocks Plant Usage below level 4', () => {
    grantSnapshot({ inspections: 2, 'plant-inspections': 0, 'hgv-inspections': 0 });
    const { rerender } = renderReports();
    fireEvent.click(screen.getByRole('button', { name: /Daily Checks Compliance Summary/ }));
    expect(screen.getByRole('button', { name: 'Download Excel for Daily Checks Compliance Summary' })).toBeEnabled();

    grantSnapshot({ inspections: 0, 'plant-inspections': 0, 'hgv-inspections': 0 });
    rerender(<ReportsPage />);
    expect(screen.getByRole('button', { name: 'Download Excel for Daily Checks Compliance Summary' })).toBeDisabled();
    expect(screen.getByText(/Requires one of Van Daily Checks level 1 or higher, Plant Daily Checks level 1 or higher, or HGV Daily Checks level 1 or higher/)).toBeInTheDocument();

    grantSnapshot({ 'daily-allocation': 3 });
    rerender(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Plant Usage/ }));
    expect(screen.getByRole('button', { name: 'Download Excel for Plant Usage' })).toBeDisabled();
    expect(screen.getByText('Requires Daily Allocation level 4 or higher.')).toBeInTheDocument();

    grantSnapshot({ 'daily-allocation': 4 });
    rerender(<ReportsPage />);
    expect(screen.getByRole('button', { name: 'Download Excel for Plant Usage' })).toBeEnabled();
  });

  it('gates Job Labour on Timesheets rather than Daily Allocation', () => {
    grantSnapshot({ timesheets: 0, 'daily-allocation': 5 }, { timesheets: 2 });
    renderReports();
    fireEvent.click(screen.getByRole('button', { name: /Job Labour/ }));
    expect(screen.getByTestId('job-labour')).toHaveTextContent('Requires Timesheets level 2 or higher.');
    fireEvent.click(screen.getByRole('button', { name: /Weekly Timesheet Summary/ }));
    expect(screen.getByRole('button', { name: 'Download Excel for Weekly Timesheet Summary' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Plant Usage/ }));
    expect(screen.getByRole('button', { name: 'Download Excel for Plant Usage' })).toBeEnabled();
  });

  it('clears a Job Labour preview and blocks both actions when access is revoked', async () => {
    const { JobLabourReport: ActualJobLabourReport } = await vi.importActual<typeof import('@/components/reports/JobLabourReport')>('@/components/reports/JobLabourReport');
    const preview = {
      filters: { dateFrom: '2026-06-01', dateTo: '2026-06-07', hoursPerDay: 8, jobCodes: [] },
      summary: [{ jobCode: '40065-GH', allocatedHours: 8, manDays: 1, entryCount: 1 }],
      detail: [],
      totals: { allocatedHours: 8, manDays: 1, entryCount: 1 },
      unmatchedJobCodes: [],
    };
    let resolveFetch: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const { rerender } = render(<ActualJobLabourReport dateFrom="2026-06-01" dateTo="2026-06-07" />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    rerender(<ActualJobLabourReport dateFrom="2026-06-01" dateTo="2026-06-07" accessDeniedReason="Requires Timesheets level 2 or higher." />);
    await act(async () => resolveFetch(new Response(JSON.stringify(preview))));
    expect(screen.queryByRole('table', { name: 'Job labour summary' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate report' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download Excel' })).toBeDisabled();
    expect(screen.getByText('Requires Timesheets level 2 or higher.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate report' }).parentElement).toHaveAttribute('tabindex', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
