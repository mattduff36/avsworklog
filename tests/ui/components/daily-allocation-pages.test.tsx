/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DailyAllocationBoardPage from '@/app/(dashboard)/daily-allocation/page';
import DailyAllocationJobSheetPage from '@/app/(dashboard)/daily-allocation/jobs/[code]/page';
import MyDailyAllocationPage from '@/app/(dashboard)/daily-allocation/my/page';
import type { DailyAllocationBoardPayload, DailyJobSheetPayload } from '@/types/daily-allocation';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  randomUUID: vi.fn(),
  accessLevel: 5,
}));

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ code: 'JOB-100' }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: () => ({ hasPermission: true, loading: false }),
}));

vi.mock('@/lib/hooks/usePermissionSnapshot', () => ({
  usePermissionSnapshot: () => ({ permissionLevels: { 'daily-allocation': 5 } }),
}));

vi.mock('@/lib/hooks/useModuleAccessLevel', () => ({
  useModuleAccessLevel: () => ({
    accessLevel: mocks.accessLevel,
    canUseLevel: (minimumLevel: number) => mocks.accessLevel >= minimumLevel,
    isLoading: false,
  }),
}));

vi.mock('@/components/layout/AppPageShell', () => ({
  AppPageShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppPageHeader: ({
    title,
    titleMeta,
    description,
    actions,
  }: {
    title: string;
    titleMeta?: ReactNode;
    description?: string;
    actions?: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      {titleMeta}
      {description ? <p>{description}</p> : null}
      {actions}
    </header>
  ),
}));

vi.mock('@/components/layout/AppPageLoadingShell', () => ({
  AppPageLoadingShell: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock('@/components/daily-allocation/JobCataloguePicker', () => ({
  JobCataloguePicker: ({ value, disabled }: { value: string | null; disabled?: boolean }) => (
    <button type="button" disabled={disabled}>{value || 'Select job code'}</button>
  ),
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) => (
    open ? <div role="alertdialog">{children}</div> : null
  ),
  AlertDialogAction: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} />,
  AlertDialogCancel: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} />,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildBoard(): DailyAllocationBoardPayload {
  return {
    work_date: '2026-08-14',
    context: {
      user_id: 'manager-1',
      access_level: 5,
      is_manager: true,
      is_admin: true,
      team_id: 'team-1',
      team_name: 'Team One',
    },
    labour: [{
      profile_id: 'employee-1',
      full_name: 'Alex Worker',
      employee_id: 'E001',
      team_id: 'team-1',
      team_name: 'Team One',
      availability: 'available',
      blocking_absence: null,
      pending_absence: null,
      draft: {
        id: 'draft-1',
        work_date: '2026-08-14',
        profile_id: 'employee-1',
        job_source_type: 'live_quote',
        job_source_id: 'quote-1',
        job_code: 'JOB-100',
        site_address: '1 Test Street',
        instructions: {
          start_time: '07:30',
          meeting_point: 'Yard',
          meet_person: 'Sam',
          notes: null,
        },
        row_version: 3,
        updated_at: '2026-08-13T08:00:00.000Z',
      },
      latest_issued: null,
      can_manage: true,
      publish_ready: true,
      warnings: [],
    }],
    plant: [{
      draft: {
        id: 'plant-draft-1',
        work_date: '2026-08-14',
        plant_kind: 'registered',
        plant_id: 'plant-1',
        hired_serial: null,
        hired_description: null,
        hired_company: null,
        owner_team_id: 'team-2',
        job_source_type: 'live_quote',
        job_source_id: 'quote-1',
        job_code: 'JOB-100',
        site_address: '1 Test Street',
        notes: null,
        row_version: 1,
        updated_at: '2026-08-13T08:00:00.000Z',
      },
      plant_label: 'EX-01',
      owned_by_other_team: true,
      can_reassign: true,
      publish_ready: true,
      warnings: [],
    }],
    latest_publication: {
      id: 'publication-1',
      revision_no: 1,
      published_at: '2026-08-13T08:00:00.000Z',
      published_by_name: 'Manager One',
    },
    publication_history: [{
      id: 'publication-1',
      revision_no: 1,
      published_at: '2026-08-13T08:00:00.000Z',
      published_by_name: 'Manager One',
      scope_team_id: 'team-1',
    }],
    available_plant: [],
    available_teams: [
      { id: 'team-1', name: 'Team One' },
      { id: 'team-2', name: 'Team Two' },
    ],
  };
}

describe('daily allocation manager board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessLevel = 5;
    window.sessionStorage.clear();
    mocks.randomUUID
      .mockReturnValueOnce('attempt-one')
      .mockReturnValueOnce('attempt-two');
    vi.stubGlobal('crypto', { randomUUID: mocks.randomUUID });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reuses an idempotency key after a lost response and rotates it after success', async () => {
    const board = buildBoard();
    let publishCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) return jsonResponse(board);
      if (url === '/api/daily-allocation/publish') {
        publishCount += 1;
        if (publishCount === 1) throw new TypeError('Publish response was lost');
        return jsonResponse({ publication: { id: `publication-${publishCount}` } });
      }
      throw new Error(`Unexpected request: ${url} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const firstRender = render(<DailyAllocationBoardPage />);
    const openPublish = await screen.findByRole('button', { name: 'Publish' });
    fireEvent.click(openPublish);

    let dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Publish response was lost'));
    expect(window.sessionStorage.getItem('daily-allocation:publish-attempt')).toContain('attempt-one');

    firstRender.unmount();
    render(<DailyAllocationBoardPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(window.sessionStorage.getItem('daily-allocation:publish-attempt')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishCount).toBe(3));

    const publishBodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === '/api/daily-allocation/publish')
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotency_key: string });
    expect(publishBodies[0].idempotency_key).toBe(publishBodies[1].idempotency_key);
    expect(publishBodies[2].idempotency_key).not.toBe(publishBodies[1].idempotency_key);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(2);
  });

  it('PERM-PAGE-01 does not request the manager board below Level 4', async () => {
    mocks.accessLevel = 2;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<DailyAllocationBoardPage />);

    expect(await screen.findByText(/Level 4 manager access is required/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the labour DELETE endpoint and preserves a stale server message', async () => {
    const board = buildBoard();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) return jsonResponse(board);
      if (url.startsWith('/api/daily-allocation/labour?') && init?.method === 'DELETE') {
        return jsonResponse({
          error: 'Alex allocation changed on the server.',
          code: 'STALE_DRAFT_VERSION',
        }, 409);
      }
      throw new Error(`Unexpected request: ${url} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DailyAllocationBoardPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear allocation for Alex Worker' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/daily-allocation\/labour\?date=.+&profileId=employee-1$/),
        { method: 'DELETE' },
      );
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Alex allocation changed on the server.',
        expect.objectContaining({
          description: expect.stringContaining('board may be stale'),
          action: expect.objectContaining({ label: 'Refresh board' }),
        }),
      );
    });
  });

  it('clears the previous board when a new date fails to load', async () => {
    let boardLoads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).startsWith('/api/daily-allocation/board')) {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
      boardLoads += 1;
      return boardLoads === 1
        ? jsonResponse(buildBoard())
        : jsonResponse({ error: 'Selected date is temporarily unavailable.' }, 500);
    }));

    render(<DailyAllocationBoardPage />);
    expect(await screen.findByText('Alex Worker')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('2026-08-14'), {
      target: { value: '2026-08-15' },
    });

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Selected date is temporarily unavailable.');
      expect(screen.queryByText('Alex Worker')).not.toBeInTheDocument();
    });
  });

  it('lets level-5 users transfer plant ownership without recreating the draft', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) return jsonResponse(buildBoard());
      if (url === '/api/daily-allocation/plant' && init?.method === 'PUT') {
        return jsonResponse({ draft: buildBoard().plant[0].draft });
      }
      throw new Error(`Unexpected request: ${url} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DailyAllocationBoardPage />);

    expect(await screen.findByText('Owned by another team')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ownership team'), { target: { value: 'team-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() => {
      const transfer = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/daily-allocation/plant' && init?.method === 'PUT'
      );
      expect(transfer).toBeDefined();
      expect(JSON.parse(String(transfer?.[1]?.body))).toMatchObject({
        id: 'plant-draft-1',
        owner_team_id: 'team-1',
        row_version: 1,
      });
    });
    expect(await screen.findByText('Publication history')).toBeInTheDocument();
    expect(screen.getByText('Revision 1')).toBeInTheDocument();
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
  });
});

describe('daily allocation job sheet', () => {
  beforeEach(() => {
    mocks.accessLevel = 5;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('links reconciled plant rows to their inspection detail', async () => {
    const sheet: DailyJobSheetPayload = {
      job_code: 'JOB-100',
      source_type: 'live_quote',
      source_id: 'quote-1',
      customer_name: 'Test Customer',
      title: 'Test Job',
      site_address: '1 Test Street',
      source_href: '/quotes/quote-1',
      labour: [],
      plant: [{
        work_date: '2026-08-14',
        plant_kind: 'registered',
        plant_id: 'plant-1',
        hired_serial: null,
        plant_label: 'EX-01',
        planned_job_code: 'JOB-100',
        actual_job_code: 'JOB-100',
        inspection_id: 'inspection/with space',
        status: 'matched',
      }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(sheet)));

    render(<DailyAllocationJobSheetPage />);

    const link = await screen.findByRole('link', { name: 'View inspection' });
    expect(link).toHaveAttribute('href', '/plant-inspections/inspection%2Fwith%20space');
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
  });

  it('PERM-PAGE-01 does not request a job sheet below Level 4', async () => {
    mocks.accessLevel = 2;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<DailyAllocationJobSheetPage />);

    expect(await screen.findByText(/Level 4 manager access is required/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('my daily allocation', () => {
  beforeEach(() => {
    mocks.accessLevel = 2;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('PERM-PAGE-01 does not request issued work below Level 2', async () => {
    mocks.accessLevel = 1;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<MyDailyAllocationPage />);

    expect(await screen.findByText(/Level 2 Daily Allocation access is required/))
      .toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests issued work at Level 2', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ current: null, history: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<MyDailyAllocationPage />);

    expect(await screen.findByText('No published allocation is available yet.'))
      .toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/daily-allocation/me', { cache: 'no-store' });
  });
});
