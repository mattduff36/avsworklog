/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { resetTrainingLoaderState } from '@/lib/client/training-data-loader';

const pushMock = vi.fn();
const replaceMock = vi.fn();
const routerMock = { push: pushMock, replace: replaceMock };
const searchParams = new URLSearchParams();
const permission = { hasPermission: true, loading: false, serviceUnavailable: false, errorStatus: null };
const auth = {
  user: { id: 'user-1' } as { id: string } | null,
  isViewingAs: false,
  effectiveRole: null as { name: string; team_id: string | null } | null,
  loading: false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/training',
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: () => permission,
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => auth,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/components/ui/tabs', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  interface TabsContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }

  const TabsContext = React.createContext<TabsContextValue>({});

  return {
    Tabs: ({ children, value, onValueChange }: TabsContextValue & { children: ReactNode }) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </TabsContext.Provider>
    ),
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => {
      const tabs = React.useContext(TabsContext);
      return (
        <button type="button" role="tab" onClick={() => tabs.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
    TabsContent: ({ children, value }: { children: ReactNode; value: string }) => {
      const tabs = React.useContext(TabsContext);
      if (tabs.value !== value) return null;
      return <div>{children}</div>;
    },
  };
});

import TrainingPage from '@/app/(dashboard)/training/page';

const fetchMock = vi.fn();
let hangNotes: ((response: Response) => void) | null = null;
let failNotes = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const summary = {
  totalRecords: 4,
  activeRecords: 3,
  archivedRecords: 1,
  expiredRecords: 1,
  expiringSoonRecords: 0,
  noExpiryRecords: 1,
  needsNvqRecords: 0,
  awaitingCardRecords: 0,
  trainingBookedRecords: 0,
  manualReviewRecords: 0,
  unlinkedPeople: 1,
};

function record(name = 'Alex Example') {
  return {
    id: 'record-1',
    employee_name_raw: name,
    qualification_raw: 'First aid',
    qualification_canonical_proposed: 'First Aid',
    qualification_validation_status: 'validated',
    relationship: 'employee',
    card_number: 'CARD-1',
    expiry_date: '2000-01-01',
    expiry_raw: '2000-01-01',
    record_status: 'active',
    cpcs_statuses: [],
    source_sheet: 'Sheet',
    source_row: 2,
    comments: '',
    person: null,
  };
}

function person(name = 'Pat Example') {
  return {
    id: 'person-1',
    employee_name_raw: name,
    employee_key: 'pat-example',
    profile_id: '',
    profile_match_status: 'unmatched',
    profile_match_notes: '',
    profile: null,
    source_sheets: ['Sheet'],
    date_of_births: [],
    record_count: 1,
  };
}

function qualification(name = 'First Aid') {
  return {
    id: 'qualification-1',
    qualification_raw: name,
    canonical_name: name,
    validation_status: 'validated',
    validation_notes: '',
    record_count: 1,
  };
}

let noteValue = 'Keep this note';
let recordName = 'Alex Example';
let personName = 'Pat Example';
let qualificationName = 'First Aid';

function page(itemsKey: string, items: unknown[], hasMore: boolean) {
  return jsonResponse({
    [itemsKey]: items,
    pagination: { limit: 500, has_more: hasMore },
  });
}

function installFetch() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (method === 'DELETE' && url.includes('/api/training/records/')) return jsonResponse({ success: true });
    if (method === 'PATCH' && url.includes('/api/training/people/')) {
      personName = 'Pat Updated';
      return jsonResponse({ success: true });
    }
    if (method === 'PATCH' && url.includes('/api/training/qualifications/')) {
      qualificationName = 'First Aid Updated';
      return jsonResponse({ success: true });
    }
    if (url.includes('/api/training/summary')) return jsonResponse({ summary });
    if (url.includes('/api/training/records?')) return page('records', [record(recordName)], false);
    if (url.includes('/api/training/people')) return page('people', [person(personName)], false);
    if (url.includes('/api/training/qualifications')) return page('qualifications', [qualification(qualificationName)], false);
    if (url.includes('/api/training/notes')) {
      if (hangNotes) {
        return new Promise<Response>((resolve) => {
          hangNotes = resolve;
        });
      }
      if (failNotes) return jsonResponse({ error: 'Training notes unavailable' }, 503);
      if (url.includes('offset=0')) {
        return page('notes', [{
          id: 'note-1',
          note_type: 'comment',
          source_sheet: 'Sheet',
          cell_address: 'A1',
          note_value: noteValue,
          reason: 'kept',
        }], true);
      }
      return page('notes', [{
        id: 'note-2',
        note_type: 'comment',
        source_sheet: 'Sheet',
        cell_address: 'B2',
        note_value: 'Second note page',
        reason: 'kept',
      }], false);
    }
    return jsonResponse({ error: `unexpected ${method} ${url}` }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function gets(fragment: string): number {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const method = (init as RequestInit | undefined)?.method || 'GET';
    return method === 'GET' && String(input).includes(fragment);
  }).length;
}

describe('training lazy loading', () => {
  beforeEach(() => {
    resetTrainingLoaderState();
    fetchMock.mockReset();
    hangNotes = null;
    failNotes = false;
    noteValue = 'Keep this note';
    recordName = 'Alex Example';
    personName = 'Pat Example';
    qualificationName = 'First Aid';
    permission.hasPermission = true;
    permission.loading = false;
    auth.user = { id: 'user-1' };
    auth.isViewingAs = false;
    auth.effectiveRole = null;
    auth.loading = false;
    searchParams.delete('tab');
    installFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('loads the summary and priority records without inactive collections', async () => {
    render(<TrainingPage />);

    expect(await screen.findByText('Alex Example')).toBeInTheDocument();
    expect(screen.getByText('Active Records')).toBeInTheDocument();
    expect(gets('/api/training/summary')).toBe(1);
    expect(gets('/api/training/records?')).toBe(1);
    expect(gets('/api/training/people')).toBe(0);
    expect(gets('/api/training/qualifications')).toBe(0);
    expect(gets('/api/training/notes')).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(gets('/api/training/records?')).toBe(2));
    expect(gets('/api/training/summary')).toBe(2);
    expect(gets('/api/training/notes')).toBe(0);
  });

  it('loads a directly opened notes tab once, including every page', async () => {
    searchParams.set('tab', 'notes');
    render(<TrainingPage />);

    expect(await screen.findByText('Keep this note')).toBeInTheDocument();
    expect(screen.getByText('Second note page')).toBeInTheDocument();
    expect(gets('/api/training/notes')).toBe(2);
    expect(gets('/api/training/records?')).toBe(0);
    expect(gets('/api/training/people')).toBe(0);
    expect(gets('/api/training/qualifications')).toBe(0);
  });

  it('deduplicates an in-flight notes load and does not reload on revisit', async () => {
    render(<TrainingPage />);
    expect(await screen.findByText('Alex Example')).toBeInTheDocument();

    hangNotes = () => undefined;
    fireEvent.click(screen.getByRole('tab', { name: 'Workbook Notes' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Workbook Notes' }));
    await waitFor(() => expect(gets('/api/training/notes')).toBe(1));
    expect(screen.getByText('Loading workbook notes...')).toBeInTheDocument();

    const resolveNotes = hangNotes;
    hangNotes = null;
    resolveNotes?.(page('notes', [{
      id: 'note-1',
      note_type: 'comment',
      source_sheet: 'Sheet',
      cell_address: 'A1',
      note_value: noteValue,
      reason: 'kept',
    }], true));

    expect(await screen.findByText('Second note page')).toBeInTheDocument();
    expect(gets('/api/training/notes')).toBe(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Workbook Notes' }));
    expect(gets('/api/training/notes')).toBe(2);
  });

  it('retries a failed notes load', async () => {
    failNotes = true;
    searchParams.set('tab', 'notes');
    render(<TrainingPage />);

    expect(await screen.findByText('Training notes unavailable')).toBeInTheDocument();
    failNotes = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Keep this note')).toBeInTheDocument();
    expect(screen.getByText('Second note page')).toBeInTheDocument();
  });

  it('opens the record form without loading lookup collections', async () => {
    render(<TrainingPage />);
    expect(await screen.findByText('Alex Example')).toBeInTheDocument();
    const callsBefore = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Add Record' }));
    expect(await screen.findByText('Add Training Record')).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(gets('/api/training/people')).toBe(0);
    expect(gets('/api/training/qualifications')).toBe(0);
    expect(gets('/api/training/notes')).toBe(0);
  });

  it('refreshes visible record dependents and loads hidden dependents on next access', async () => {
    render(<TrainingPage />);
    expect(await screen.findByText('Alex Example')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Records' }));
    expect(gets('/api/training/records?')).toBe(1);

    recordName = 'Alex Archived';
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Alex Archived')).toBeInTheDocument();
    expect(gets('/api/training/summary')).toBe(2);
    expect(gets('/api/training/records?')).toBe(2);
    expect(gets('/api/training/people')).toBe(0);
    expect(gets('/api/training/qualifications')).toBe(0);
    expect(gets('/api/training/notes')).toBe(0);

    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(await screen.findByText('Pat Example')).toBeInTheDocument();
    expect(gets('/api/training/people')).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Pat Updated')).toBeInTheDocument();
    expect(gets('/api/training/records?')).toBe(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(await screen.findByText('Alex Archived')).toBeInTheDocument();
    expect(gets('/api/training/records?')).toBe(3);
    expect(gets('/api/training/notes')).toBe(0);
  });

  it('refreshes a qualification edit and reloads records the next time they are shown', async () => {
    render(<TrainingPage />);
    expect(await screen.findByText('Alex Example')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Qualifications' }));
    expect(await screen.findAllByText('First Aid')).not.toHaveLength(0);
    const recordsBefore = gets('/api/training/records?');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findAllByText('First Aid Updated')).not.toHaveLength(0);
    expect(gets('/api/training/records?')).toBe(recordsBefore);

    fireEvent.click(screen.getByRole('tab', { name: 'Records' }));
    await waitFor(() => expect(gets('/api/training/records?')).toBe(recordsBefore + 1));
    expect(gets('/api/training/notes')).toBe(0);
  });

  it('drops superseded notes when access or the actor changes', async () => {
    const view = render(<TrainingPage />);
    expect(await screen.findByText('Alex Example')).toBeInTheDocument();
    hangNotes = () => undefined;
    fireEvent.click(screen.getByRole('tab', { name: 'Workbook Notes' }));
    await waitFor(() => expect(gets('/api/training/notes')).toBe(1));
    const resolveOldNotes = hangNotes;
    hangNotes = null;

    permission.hasPermission = false;
    view.rerender(<TrainingPage />);
    await act(async () => {
      resolveOldNotes?.(page('notes', [{
        id: 'note-old',
        note_type: 'comment',
        source_sheet: 'Sheet',
        cell_address: 'A1',
        note_value: 'Old actor note',
        reason: 'old',
      }], false));
    });
    expect(screen.queryByText('Old actor note')).not.toBeInTheDocument();

    permission.hasPermission = true;
    auth.user = { id: 'user-2' };
    noteValue = 'New actor note';
    searchParams.set('tab', 'notes');
    view.rerender(<TrainingPage />);
    expect(await screen.findByText('New actor note')).toBeInTheDocument();
    expect(screen.queryByText('Old actor note')).not.toBeInTheDocument();
  });

  it('reloads the visible tab when View As changes', async () => {
    searchParams.set('tab', 'notes');
    const view = render(<TrainingPage />);
    expect(await screen.findByText('Keep this note')).toBeInTheDocument();
    const notesBefore = gets('/api/training/notes');

    auth.isViewingAs = true;
    auth.effectiveRole = { name: 'manager', team_id: 'team-2' };
    noteValue = 'Viewed as note';
    view.rerender(<TrainingPage />);

    expect(screen.queryByText('Keep this note')).not.toBeInTheDocument();
    expect(await screen.findByText('Viewed as note')).toBeInTheDocument();
    expect(gets('/api/training/notes')).toBeGreaterThan(notesBefore);
    expect(gets('/api/training/records?')).toBe(0);
  });

  it('does not request training collections without permission', async () => {
    permission.hasPermission = false;
    render(<TrainingPage />);
    expect(await screen.findByText('Redirecting...')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
