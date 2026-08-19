/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DailyAllocationBoardPage from '@/app/(dashboard)/daily-allocation/page';
import DailyAllocationJobSheetPage from '@/app/(dashboard)/daily-allocation/jobs/[code]/page';
import MyDailyAllocationPage from '@/app/(dashboard)/daily-allocation/my/page';
import type {
  DailyAllocationIssuedItem,
  DailyAllocationRangeBoardPayload,
  DailyJobSheetPayload,
} from '@/types/daily-allocation';
import type { JobCatalogueOption } from '@/types/job-catalogue';
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  randomUUID: vi.fn(),
  accessLevel: 5,
  onDragEnd: null as ((event: unknown) => void) | null,
  searchParams: '',
  fetchRuntime: vi.fn(async () => ({ board_enabled: true, writes_enabled: true })),
}));

vi.mock('@/lib/client/daily-allocation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/daily-allocation')>();
  return {
    ...actual,
    fetchDailyAllocationRuntime: () => mocks.fetchRuntime(),
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ code: 'JOB-100' }),
  useSearchParams: () => new URLSearchParams(mocks.searchParams),
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
    footer,
  }: {
    title: string;
    titleMeta?: ReactNode;
    description?: string;
    actions?: ReactNode;
    footer?: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      {titleMeta}
      {description ? <p>{description}</p> : null}
      {actions}
      {footer}
    </header>
  ),
}));

vi.mock('@/components/layout/AppPageLoadingShell', () => ({
  AppPageLoadingShell: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock('@/components/daily-allocation/JobCataloguePicker', () => ({
  JobCataloguePicker: ({
    value,
    disabled,
    onSelect,
  }: {
    value: string | null;
    disabled?: boolean;
    onSelect: (option: JobCatalogueOption | null) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect({
        value: 'JOB-100',
        label: 'JOB-100',
        customerName: 'Test Customer',
        quoteTitle: 'Site works',
        source: 'live_quote',
        sourceId: 'quote-1',
        siteAddress: '1 Test Street',
        addressValid: true,
        aliases: [],
        isAmbiguous: false,
        blockReason: null,
      })}
    >
      {value || 'Select job code'}
    </button>
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

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (
    open ? <div role="dialog">{children}</div> : null
  ),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@dnd-kit/dom', () => ({
  Accessibility: {
    configure: vi.fn(() => ({})),
  },
  KeyboardSensor: {
    configure: vi.fn(() => ({})),
  },
  PointerActivationConstraints: {
    Delay: class MockDelayConstraint {
      value: number;
      constructor(options: { value: number }) {
        this.value = options.value;
      }
    },
    Distance: class MockDistanceConstraint {
      value: number;
      constructor(options: { value: number }) {
        this.value = options.value;
      }
    },
  },
  PointerSensor: {
    configure: vi.fn(() => ({})),
  },
}));

vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd?: (event: unknown) => void;
  }) => {
    mocks.onDragEnd = onDragEnd ?? null;
    return <div>{children}</div>;
  },
  DragOverlay: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useDraggable: () => ({
    ref: () => undefined,
    handleRef: () => undefined,
    isDragging: false,
  }),
  useDroppable: () => ({
    ref: () => undefined,
    isDropTarget: false,
  }),
}));

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildRangeBoard(overrides: Partial<DailyAllocationRangeBoardPayload> = {}): DailyAllocationRangeBoardPayload {
  return {
    start_date: '2026-08-10',
    end_date: '2026-08-16',
    dates: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
    context: {
      user_id: 'manager-1',
      access_level: 5,
      is_manager: true,
      is_admin: true,
      team_id: 'team-1',
      team_name: 'Team One',
    },
    plan_days: [{
      id: 'plan-2026-08-14',
      work_date: '2026-08-14',
      team_id: 'team-1',
      plan_version: 3,
      converted_at: '2026-08-13T08:00:00.000Z',
      converted_by: 'manager-1',
      updated_at: '2026-08-13T08:00:00.000Z',
    }],
    visits: [{
      id: 'visit-1',
      plan_day_id: 'plan-2026-08-14',
      work_date: '2026-08-14',
      owner_team_id: 'team-1',
      job_source_type: 'live_quote',
      job_source_id: 'quote-1',
      job_code: 'JOB-100',
      site_address: '1 Test Street',
      starts_at: '2026-08-14T07:00:00.000Z',
      ends_at: '2026-08-14T10:00:00.000Z',
      meeting_point: 'Yard',
      meet_person: 'Sam',
      notes: null,
      row_version: 1,
      updated_at: '2026-08-13T08:00:00.000Z',
    }],
    labour_assignments: [{
      id: 'labour-1',
      visit_id: 'visit-1',
      plan_day_id: 'plan-2026-08-14',
      work_date: '2026-08-14',
      profile_id: 'employee-1',
      starts_at: '2026-08-14T07:00:00.000Z',
      ends_at: '2026-08-14T10:00:00.000Z',
      meeting_point: 'Yard',
      meet_person: 'Sam',
      notes: null,
      row_version: 1,
      updated_at: '2026-08-13T08:00:00.000Z',
    }],
    plant_assignments: [],
    overrides: [],
    conflicts: [],
    legacy: { labour: [], plant: [] },
    jobs: [{
      source_type: 'live_quote',
      source_id: 'quote-1',
      job_code: 'JOB-100',
      customer_name: 'Test Customer',
      title: 'Site works',
      site_address: '1 Test Street',
      source_href: '/quotes/quote-1',
    }],
    resources: {
      employees: [{
        profile_id: 'employee-1',
        full_name: 'Alex Worker',
        employee_id: 'E001',
        team_id: 'team-1',
        team_name: 'Team One',
        days: [{
          work_date: '2026-08-14',
          availability: 'available',
          blocking_absence: null,
          pending_absence: null,
          am_working: true,
          pm_working: true,
        }],
      }],
      plant: [{
        id: 'plant-1',
        plant_id: 'EX-01',
        nickname: 'Digger',
      }],
      teams: [{ id: 'team-1', name: 'Team One' }],
    },
    publications: [{
      id: 'publication-1',
      work_date: '2026-08-14',
      revision_no: 1,
      published_at: '2026-08-13T08:00:00.000Z',
      published_by: 'manager-1',
      published_by_name: 'Manager One',
      scope_team_id: 'team-1',
      snapshot_version: 2,
      plan_day_id: 'plan-2026-08-14',
      published_plan_version: 2,
      confirm_unallocated: false,
    }],
    ...overrides,
  };
}

function renderBoardPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DailyAllocationBoardPage />
    </QueryClientProvider>
  );
}

describe('daily allocation manager board', () => {
  beforeEach(() => {
    // The board defaults to tomorrow; freeze the clock so the hard-coded
    // 2026-08-14 plan fixture remains the selected converted date.
    vi.setSystemTime(new Date('2026-08-13T12:00:00.000Z'));
    vi.clearAllMocks();
    mocks.accessLevel = 5;
    mocks.searchParams = '';
    mocks.onDragEnd = null;
    mocks.fetchRuntime.mockResolvedValue({ board_enabled: true, writes_enabled: true });
    window.sessionStorage.clear();
    window.localStorage.clear();
    mocks.randomUUID
      .mockReturnValueOnce('attempt-one')
      .mockReturnValueOnce('attempt-two')
      .mockReturnValue('attempt-later');
    vi.stubGlobal('crypto', { randomUUID: mocks.randomUUID });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reuses an idempotency key after a lost response and rotates it after success', async () => {
    const board = buildRangeBoard();
    let publishCount = 0;
    let latestPublicationId = 'publication-1';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) {
        return jsonResponse(buildRangeBoard({
          publications: [{
            ...board.publications[0],
            id: latestPublicationId,
            revision_no: Math.max(1, publishCount),
          }],
        }));
      }
      if (url === '/api/daily-allocation/publish') {
        publishCount += 1;
        if (publishCount === 1) throw new TypeError('Publish response was lost');
        latestPublicationId = `publication-${publishCount}`;
        return jsonResponse({ publication_id: latestPublicationId, snapshot_version: 2 });
      }
      throw new Error(`Unexpected request: ${url} ${init?.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const firstRender = renderBoardPage();
    const openPublish = await screen.findByRole('button', { name: 'Publish' });
    fireEvent.click(openPublish);

    let dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Publish response was lost'));
    expect(window.sessionStorage.getItem('daily-allocation:publish-attempt')).toContain('attempt-one');

    firstRender.unmount();
    renderBoardPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(window.sessionStorage.getItem('daily-allocation:publish-attempt')).toBeNull();
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('daily-allocation-publish')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('daily-allocation-publish'));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishCount).toBe(3));

    const publishBodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === '/api/daily-allocation/publish')
      .map(([, init]) => JSON.parse(String(init?.body)) as {
        idempotency_key: string;
        snapshot_version: number;
        confirm_unallocated: boolean;
      });
    expect(publishBodies[0].idempotency_key).toBe(publishBodies[1].idempotency_key);
    expect(publishBodies[2].idempotency_key).not.toBe(publishBodies[1].idempotency_key);
    expect(publishBodies.every((body) => body.snapshot_version === 2)).toBe(true);
    expect(publishBodies[0].confirm_unallocated).toBe(false);
    expect(publishBodies[0].idempotency_key).toContain('attempt-one');
    expect(publishBodies[2].idempotency_key).not.toContain('attempt-one');
  });

  it('retries publish with the same key after unallocated confirmation', async () => {
    const board = buildRangeBoard();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) return jsonResponse(board);
      if (url === '/api/daily-allocation/publish') {
        const body = JSON.parse(String(init?.body)) as { confirm_unallocated?: boolean };
        if (!body.confirm_unallocated) {
          return jsonResponse({
            error: 'Unallocated employees require confirmation.',
            code: 'CONFIRM_UNALLOCATED_REQUIRED',
          }, 409);
        }
        return jsonResponse({ publication_id: 'publication-2', snapshot_version: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publish' }));
    const confirmButton = await screen.findByRole('button', { name: 'Publish with unallocated' });
    fireEvent.click(confirmButton);
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());

    const bodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === '/api/daily-allocation/publish')
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotency_key: string; confirm_unallocated: boolean });
    expect(bodies).toHaveLength(2);
    expect(bodies[0].confirm_unallocated).toBe(false);
    expect(bodies[1].confirm_unallocated).toBe(true);
    expect(bodies[0].idempotency_key).toBe(bodies[1].idempotency_key);
  });

  it('PERM-PAGE-01 does not request the manager board below Level 4', async () => {
    mocks.accessLevel = 2;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();

    expect(await screen.findByText(/Level 4 manager access is required/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.fetchRuntime).not.toHaveBeenCalled();
  });

  it('renders the preserved v1 manager when the v2 migration is absent', async () => {
    mocks.fetchRuntime.mockRejectedValue(Object.assign(new Error('schema cache'), { status: 503 }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board?date=')) {
        return jsonResponse({
          work_date: '2026-08-14',
          context: {
            user_id: 'user-1',
            access_level: 4,
            is_manager: true,
            is_admin: true,
            team_id: 'team-1',
            team_name: 'Team One',
          },
          labour: [],
          plant: [],
          latest_publication: null,
          publication_history: [],
          available_plant: [],
          available_teams: [{ id: 'team-1', name: 'Team One' }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();
    expect(await screen.findByText(/Assign one primary job per employee/)).toBeInTheDocument();
    expect(screen.getByText('Plant planning')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-allocation-toolbar')).not.toBeInTheDocument();
  });

  it('renders the preserved v1 manager while board_enabled is false', async () => {
    mocks.fetchRuntime.mockResolvedValue({ board_enabled: false, writes_enabled: false });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board?date=')) {
        return jsonResponse({
          work_date: '2026-08-14',
          context: {
            user_id: 'user-1',
            access_level: 4,
            is_manager: true,
            is_admin: true,
            team_id: 'team-1',
            team_name: 'Team One',
          },
          labour: [],
          plant: [],
          latest_publication: null,
          publication_history: [],
          available_plant: [],
          available_teams: [{ id: 'team-1', name: 'Team One' }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();
    expect(await screen.findByText('Plant planning')).toBeInTheDocument();
    expect(screen.queryByText(/Convert this date to timed visits/)).not.toBeInTheDocument();
  });

  it('renders the FFTS board only when board_enabled is true', async () => {
    mocks.fetchRuntime.mockResolvedValue({ board_enabled: true, writes_enabled: true });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) return jsonResponse(buildRangeBoard());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();
    expect(await screen.findByTestId('daily-allocation-toolbar')).toBeInTheDocument();
    expect(screen.queryByText('Plant planning')).not.toBeInTheDocument();
  });

  it('converts a legacy date before the first v2 write', async () => {
    const unconverted = buildRangeBoard({
      plan_days: [],
      visits: [],
      labour_assignments: [],
      publications: [],
      legacy: {
        labour: [{
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
          row_version: 1,
          updated_at: '2026-08-13T08:00:00.000Z',
        }],
        plant: [],
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) return jsonResponse(unconverted);
      if (url === '/api/daily-allocation/convert' && init?.method === 'POST') {
        return jsonResponse({
          plan_day_id: 'plan-converted',
          plan_version: 1,
          team_id: 'team-1',
          work_date: '2026-08-14',
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();
    expect(await screen.findByText(/Convert this date to timed visits/)).toBeInTheDocument();
    expect(screen.getByText(/untimed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Convert 2026-08-14/ }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Convert date' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/daily-allocation/convert',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('uses the authoritative plan version 7 when convert-then-move follows an existing plan', async () => {
    const convertedPlan = {
      id: 'plan-existing-v7',
      work_date: '2026-08-15',
      team_id: 'team-1',
      plan_version: 7,
      converted_at: '2026-08-13T08:00:00.000Z',
      converted_by: 'manager-1',
      updated_at: '2026-08-13T08:00:00.000Z',
    };
    const initial = buildRangeBoard();
    let converted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) {
        return jsonResponse(converted
          ? buildRangeBoard({ plan_days: [...initial.plan_days, convertedPlan] })
          : initial);
      }
      if (url === '/api/daily-allocation/convert' && init?.method === 'POST') {
        converted = true;
        return jsonResponse({
          plan_day_id: convertedPlan.id,
          plan_version: convertedPlan.plan_version,
          team_id: convertedPlan.team_id,
          work_date: convertedPlan.work_date,
        });
      }
      if (url.endsWith('/move') && init?.method === 'POST') {
        const visit = initial.visits[0];
        return jsonResponse({
          visit_id: visit.id,
          plan_day_id: convertedPlan.id,
          plan_version: 8,
          source_plan_day_id: visit.plan_day_id,
          source_plan_version: 3,
          target_plan_day_id: convertedPlan.id,
          target_plan_version: 8,
          visit: {
            ...visit,
            plan_day_id: convertedPlan.id,
            work_date: '2026-08-15',
            row_version: visit.row_version + 1,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();
    expect(await screen.findByTestId('daily-allocation-toolbar')).toBeInTheDocument();
    expect(mocks.onDragEnd).toEqual(expect.any(Function));
    act(() => {
      mocks.onDragEnd?.({
        operation: {
          source: { data: { source: { kind: 'visit', visit: initial.visits[0] } } },
          target: { data: { target: { surface: 'week-cell', workDate: '2026-08-15' } } },
        },
      });
    });
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Convert date' }));

    await waitFor(() => {
      const moveBodies = fetchMock.mock.calls
        .filter(([url, init]) => String(url).endsWith('/move') && init?.method === 'POST')
        .map(([, init]) => JSON.parse(String(init?.body)) as {
          target_plan_day_id: string;
          expected_source_plan_version: number;
          expected_target_plan_version: number;
        });
      expect(moveBodies).toEqual([expect.objectContaining({
        target_plan_day_id: 'plan-existing-v7',
        expected_target_plan_version: 7,
        expected_source_plan_version: initial.plan_days[0].plan_version,
      })]);
      expect(moveBodies[0]?.expected_target_plan_version).not.toBe(1);
    });
  });

  it('creates a visit from the explicit Add visit dialog', async () => {
    const board = buildRangeBoard();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) return jsonResponse(board);
      if (url === '/api/daily-allocation/visits' && init?.method === 'POST') {
        return jsonResponse({
          visit_id: 'visit-2',
          plan_day_id: board.plan_days[0].id,
          plan_version: board.plan_days[0].plan_version + 1,
          visit: {
            ...board.visits[0],
            id: 'visit-2',
            row_version: 1,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add visit' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Select job code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create visit' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/daily-allocation/visits',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('assigns an employee through the explicit assign dialog and can remove them', async () => {
    const board = buildRangeBoard({ labour_assignments: [] });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) return jsonResponse(board);
      if (url === '/api/daily-allocation/assignments/labour' && init?.method === 'POST') {
        return jsonResponse({ assignment_id: 'labour-2' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /Assign resources to JOB-100/ }))[0]);
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'employee-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign employee' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/daily-allocation/assignments/labour',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('assigns with plan version N+1 after an override and does not send STALE_PLAN_VERSION', async () => {
    const base = buildRangeBoard({
      labour_assignments: [],
      resources: {
        employees: [{
          profile_id: 'employee-1',
          full_name: 'Alex Worker',
          employee_id: 'E001',
          team_id: 'team-1',
          team_name: 'Team One',
          days: [{
            work_date: '2026-08-14',
            availability: 'available',
            blocking_absence: null,
            pending_absence: {
              absence_id: 'absence-1',
              reason_id: 'reason-1',
              reason_name: 'Holiday',
              colour: null,
              is_paid: true,
              is_half_day: false,
              half_day_session: null,
              status: 'pending',
              allocation_behaviour: 'block',
            },
            am_working: true,
            pm_working: true,
          }],
        }],
        plant: [],
        teams: [{ id: 'team-1', name: 'Team One' }],
      },
    });
    let planVersion = 3;
    let overrideId: string | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/daily-allocation/board')) {
        return jsonResponse(buildRangeBoard({
          labour_assignments: [],
          plan_days: [{ ...base.plan_days[0], plan_version: planVersion }],
          overrides: overrideId ? [{
            id: overrideId,
            plan_day_id: 'plan-2026-08-14',
            visit_id: 'visit-1',
            profile_id: 'employee-1',
            plant_id: null,
            conflict_kind: 'pending_absence',
            evidence: 'Supervisor confirmed',
            confirmed_by: 'manager-1',
            confirmed_at: '2026-08-13T09:00:00.000Z',
          }] : [],
          resources: base.resources,
        }));
      }
      if (url === '/api/daily-allocation/overrides' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { expected_plan_version: number };
        expect(body.expected_plan_version).toBe(3);
        planVersion = 4;
        overrideId = 'override-1';
        return jsonResponse({ override_id: overrideId });
      }
      if (url === '/api/daily-allocation/assignments/labour' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          expected_plan_version: number;
          override_id?: string;
        };
        if (body.expected_plan_version !== planVersion) {
          return jsonResponse({ error: 'Plan is stale', code: 'STALE_PLAN_VERSION' }, 409);
        }
        expect(body.override_id).toBe('override-1');
        return jsonResponse({ assignment_id: 'labour-2' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoardPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /Assign resources to JOB-100/ }))[0]);
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'employee-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign employee' }));
    fireEvent.change(await screen.findByLabelText('Evidence'), { target: { value: 'Supervisor confirmed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm override' }));

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Employee assigned.');
    });
    const labourBodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === '/api/daily-allocation/assignments/labour')
      .map(([, init]) => JSON.parse(String(init?.body)) as {
        expected_plan_version: number;
        override_id?: string;
      });
    expect(labourBodies).toEqual([{
      visit_id: 'visit-1',
      profile_id: 'employee-1',
      expected_plan_version: 4,
      override_id: 'override-1',
    }]);
    expect(labourBodies[0].expected_plan_version).not.toBe(3);
    expect(fetchMock.mock.calls.some(([, init]) => String(init?.body || '').includes('STALE_PLAN_VERSION'))).toBe(false);
  });

  it('scopes Level-5 multi-team boards to the active team without mixing same-date plans', async () => {
    const board = buildRangeBoard({
      plan_days: [
        {
          id: 'plan-2026-08-14',
          work_date: '2026-08-14',
          team_id: 'team-1',
          plan_version: 3,
          converted_at: '2026-08-13T08:00:00.000Z',
          converted_by: 'manager-1',
          updated_at: '2026-08-13T08:00:00.000Z',
        },
        {
          id: 'plan-team-2',
          work_date: '2026-08-14',
          team_id: 'team-2',
          plan_version: 8,
          converted_at: '2026-08-13T08:00:00.000Z',
          converted_by: 'manager-1',
          updated_at: '2026-08-13T08:00:00.000Z',
        },
      ],
      visits: [
        {
          id: 'visit-1',
          plan_day_id: 'plan-2026-08-14',
          work_date: '2026-08-14',
          owner_team_id: 'team-1',
          job_source_type: 'live_quote',
          job_source_id: 'quote-1',
          job_code: 'JOB-100',
          site_address: '1 Test Street',
          starts_at: '2026-08-14T07:00:00.000Z',
          ends_at: '2026-08-14T10:00:00.000Z',
          meeting_point: 'Yard',
          meet_person: 'Sam',
          notes: null,
          row_version: 1,
          updated_at: '2026-08-13T08:00:00.000Z',
        },
        {
          id: 'visit-team-2',
          plan_day_id: 'plan-team-2',
          work_date: '2026-08-14',
          owner_team_id: 'team-2',
          job_source_type: 'live_quote',
          job_source_id: 'quote-2',
          job_code: 'JOB-200',
          site_address: '2 Test Street',
          starts_at: '2026-08-14T08:00:00.000Z',
          ends_at: '2026-08-14T11:00:00.000Z',
          meeting_point: null,
          meet_person: null,
          notes: null,
          row_version: 1,
          updated_at: '2026-08-13T08:00:00.000Z',
        },
      ],
      jobs: [
        {
          source_type: 'live_quote',
          source_id: 'quote-1',
          job_code: 'JOB-100',
          customer_name: 'Test Customer',
          title: 'Site works',
          site_address: '1 Test Street',
          source_href: '/quotes/quote-1',
        },
        {
          source_type: 'live_quote',
          source_id: 'quote-2',
          job_code: 'JOB-200',
          customer_name: 'Other Customer',
          title: 'Other works',
          site_address: '2 Test Street',
          source_href: '/quotes/quote-2',
        },
      ],
      resources: {
        employees: [
          {
            profile_id: 'employee-1',
            full_name: 'Alex Worker',
            employee_id: 'E001',
            team_id: 'team-1',
            team_name: 'Team One',
            days: [{
              work_date: '2026-08-14',
              availability: 'available',
              blocking_absence: null,
              pending_absence: null,
              am_working: true,
              pm_working: true,
            }],
          },
          {
            profile_id: 'employee-2',
            full_name: 'Blair Two',
            employee_id: 'E002',
            team_id: 'team-2',
            team_name: 'Team Two',
            days: [{
              work_date: '2026-08-14',
              availability: 'available',
              blocking_absence: null,
              pending_absence: null,
              am_working: true,
              pm_working: true,
            }],
          },
        ],
        plant: [],
        teams: [
          { id: 'team-1', name: 'Team One' },
          { id: 'team-2', name: 'Team Two' },
        ],
      },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/daily-allocation/board')) return jsonResponse(board);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));

    renderBoardPage();
    expect((await screen.findAllByTestId('daily-allocation-visit-visit-1')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('daily-allocation-visit-visit-team-2')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Active team'), { target: { value: 'team-2' } });
    expect((await screen.findAllByTestId('daily-allocation-visit-visit-team-2')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('daily-allocation-visit-visit-1')).not.toBeInTheDocument();
  });

  it('clears the previous board when a new date fails to load', async () => {
    let boardLoads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).startsWith('/api/daily-allocation/board')) {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
      boardLoads += 1;
      return boardLoads === 1
        ? jsonResponse(buildRangeBoard())
        : jsonResponse({ error: 'Selected date is temporarily unavailable.' }, 500);
    }));

    renderBoardPage();
    expect((await screen.findAllByText('Alex Worker')).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Selected date'), {
      target: { value: '2026-08-21' },
    });

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Selected date is temporarily unavailable.');
      expect(screen.queryByText('Alex Worker')).not.toBeInTheDocument();
    });
  });

  it('renders Daily/Weekly tabs, resource tabs, publication history, and keyboard alternatives', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/daily-allocation/board')) return jsonResponse(buildRangeBoard());
      throw new Error(`Unexpected request: ${String(input)}`);
    }));

    renderBoardPage();
    expect(await screen.findByRole('tab', { name: 'Daily' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Weekly' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Weekly' }), { button: 0 });
    expect(await screen.findByTestId('daily-allocation-view-heading')).toHaveTextContent('Weekly job board');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Employees/ }), { button: 0 });
    expect(screen.getAllByText('Alex Worker').length).toBeGreaterThan(0);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Plant/ }), { button: 0 });
    expect(screen.getByText(/EX-01/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add visit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign resources' })).toBeInTheDocument();
    expect(screen.getByText('Publication history')).toBeInTheDocument();
    expect(screen.getByText('Revision 1')).toBeInTheDocument();
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
    expect(PointerSensor.configure).toHaveBeenCalled();
    const configureCall = vi.mocked(PointerSensor.configure).mock.calls.at(-1)?.[0] as {
      activationConstraints?: (event?: { pointerType?: string }) => unknown[];
    };
    const touch = configureCall.activationConstraints?.({ pointerType: 'touch' }) || [];
    const mouse = configureCall.activationConstraints?.({ pointerType: 'mouse' }) || [];
    expect(touch.some((constraint) => constraint instanceof PointerActivationConstraints.Delay)).toBe(true);
    expect(mouse.some((constraint) => constraint instanceof PointerActivationConstraints.Distance)).toBe(true);
  });

  it('keeps catalogue jobs off the calendar until a timed visit exists', async () => {
    const board = buildRangeBoard({
      jobs: [
        {
          source_type: 'live_quote',
          source_id: 'quote-1',
          job_code: 'JOB-100',
          customer_name: 'Test Customer',
          title: 'Site works',
          site_address: '1 Test Street',
          source_href: '/quotes/quote-1',
        },
        {
          source_type: 'live_quote',
          source_id: 'quote-900',
          job_code: 'JOB-900',
          customer_name: 'Unused Customer',
          title: 'Unused works',
          site_address: '9 Empty Street',
          source_href: '/quotes/quote-900',
        },
      ],
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/daily-allocation/board')) return jsonResponse(board);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));

    renderBoardPage();
    const resources = await screen.findByTestId('daily-allocation-resources');
    expect(within(resources).getByText('JOB-900')).toBeInTheDocument();
    expect((await screen.findAllByTestId('daily-allocation-visit-visit-1')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('daily-allocation-timeline-live_quote:quote-900-2026-08-14')).not.toBeInTheDocument();
    expect(screen.queryByTestId('daily-allocation-week-cell-live_quote:quote-900-2026-08-14')).not.toBeInTheDocument();
  });

  it('shows the empty and error board states', async () => {
    const empty = buildRangeBoard({
      visits: [],
      labour_assignments: [],
      jobs: [],
      publications: [],
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(empty)));
    renderBoardPage();
    expect((await screen.findAllByText(/No timed visits/)).length).toBeGreaterThan(0);
    cleanup();

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Board exploded.' }, 500)));
    renderBoardPage();
    expect(await screen.findByText('Board exploded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('daily allocation job sheet', () => {
  beforeEach(() => {
    mocks.accessLevel = 5;
    mocks.searchParams = '';
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

  it('DA2-COMPAT-001 shows timed v2 labour rows from snapshot identity', async () => {
    const sheet: DailyJobSheetPayload = {
      job_code: 'JOB-100',
      source_type: null,
      source_id: null,
      customer_name: 'Snapshotted Customer',
      title: 'Snapshotted title',
      site_address: '1 Test Street',
      source_href: null,
      labour: [{
        work_date: '2026-08-14',
        revision_no: 3,
        snapshot_version: 2,
        profile_name: 'Alex Worker',
        availability: 'available',
        job_code: 'JOB-100',
        customer_name: 'Snapshotted Customer',
        title: 'Snapshotted title',
        site_address: '1 Test Street',
        starts_at: '2026-08-14T07:00:00.000Z',
        ends_at: '2026-08-14T10:00:00.000Z',
        sequence_no: 1,
        published_visit_id: 'visit-1',
        instructions: {
          start_time: '08:00',
          meeting_point: 'Yard',
          meet_person: 'Sam',
          notes: null,
        },
      }],
      plant: [],
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(sheet)));
    render(<DailyAllocationJobSheetPage />);
    expect(await screen.findByText('Alex Worker')).toBeInTheDocument();
    expect(screen.getByText(/08:00/)).toBeInTheDocument();
    expect(screen.getByText(/Snapshotted Customer/)).toBeInTheDocument();
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
    mocks.searchParams = '';
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

  it('DA2-COMPAT-001 renders a v1 legacy allocation without an end time', async () => {
    const current: DailyAllocationIssuedItem = {
      publication_id: 'pub-v1',
      revision_no: 2,
      published_at: '2026-08-13T08:00:00.000Z',
      work_date: '2026-08-14',
      snapshot_version: 1,
      unallocated: false,
      availability: 'available',
      job_code: 'JOB-100',
      site_address: '1 Test Street',
      customer_name: 'Test Customer',
      title: 'Site works',
      instructions: {
        start_time: '07:30',
        meeting_point: 'Yard',
        meet_person: 'Sam',
        notes: null,
      },
      absence: null,
      visits: [],
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ current, history: [current] })));

    render(<MyDailyAllocationPage />);
    expect(await screen.findByTestId('daily-allocation-issued-v1')).toBeInTheDocument();
    expect(screen.getByText('Legacy allocation')).toBeInTheDocument();
    expect(screen.getByText(/Job:/)).toBeInTheDocument();
    expect(screen.getByText('07:30')).toBeInTheDocument();
    expect(screen.queryByText(/–/)).not.toBeInTheDocument();
    expect(screen.getByText(/Revision 2/)).toBeInTheDocument();
  });

  it('DA2-COMPAT-001 renders a v2 timed itinerary and selects ?publication=', async () => {
    mocks.searchParams = 'publication=pub-v2';
    const current: DailyAllocationIssuedItem = {
      publication_id: 'pub-v2',
      revision_no: 3,
      published_at: '2026-08-13T18:00:00.000Z',
      work_date: '2026-08-14',
      snapshot_version: 2,
      unallocated: false,
      availability: 'half_day_absence',
      job_code: null,
      site_address: null,
      customer_name: null,
      title: null,
      instructions: {
        start_time: null,
        meeting_point: null,
        meet_person: null,
        notes: null,
      },
      absence: {
        absence_id: 'abs-1',
        reason_id: 'reason-1',
        reason_name: 'Medical',
        colour: null,
        is_paid: true,
        is_half_day: true,
        half_day_session: 'AM',
        status: 'approved',
        allocation_behaviour: 'reduce',
      },
      visits: [{
        published_visit_id: 'visit-1',
        sequence_no: 1,
        job_code: 'JOB-100',
        site_address: '1 Test Street',
        customer_name: 'Test Customer',
        title: 'Site works',
        starts_at: '2026-08-14T12:00:00.000Z',
        ends_at: '2026-08-14T16:00:00.000Z',
        instructions: {
          start_time: '13:00',
          meeting_point: 'Yard',
          meet_person: 'Sam',
          notes: 'Bring PPE',
        },
      }],
    };
    const fetchMock = vi.fn(async () => jsonResponse({
      current,
      history: [
        current,
        { ...current, publication_id: 'pub-older', revision_no: 2, snapshot_version: 1, visits: [] },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<MyDailyAllocationPage />);
    expect(await screen.findByTestId('daily-allocation-issued-v2')).toBeInTheDocument();
    expect(screen.getByText('Timed itinerary')).toBeInTheDocument();
    expect(screen.getByText('JOB-100')).toBeInTheDocument();
    expect(screen.getAllByText('Medical (AM)').length).toBeGreaterThan(0);
    expect(screen.getByText('Earlier revisions')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/daily-allocation/me?publication=pub-v2',
      { cache: 'no-store' }
    );
  });

  it('DA2-COMPAT-001 shows an explicit unallocated v2 itinerary', async () => {
    const current: DailyAllocationIssuedItem = {
      publication_id: 'pub-none',
      revision_no: 1,
      published_at: '2026-08-13T18:00:00.000Z',
      work_date: '2026-08-14',
      snapshot_version: 2,
      unallocated: true,
      availability: 'available',
      job_code: null,
      site_address: null,
      customer_name: null,
      title: null,
      instructions: {
        start_time: null,
        meeting_point: null,
        meet_person: null,
        notes: null,
      },
      absence: null,
      visits: [],
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ current, history: [current] })));
    render(<MyDailyAllocationPage />);
    expect(await screen.findByTestId('daily-allocation-unallocated')).toBeInTheDocument();
  });
});
