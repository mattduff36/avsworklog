/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { resetRetiredInventoryLoaderState } from '@/lib/client/inventory-retired-loader';

const pushMock = vi.fn();
const routerMock = { push: pushMock, replace: vi.fn() };
const searchParams = new URLSearchParams();
const permission = { hasPermission: true, loading: false, serviceUnavailable: false, errorStatus: null };
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'manager-1' }, effectiveRole: { id: 'manager-role', name: 'manager', team_id: 'team-1' }, isViewingAs: false, loading: false }) }));
vi.mock('@/lib/hooks/useModuleAccessLevel', () => ({ useModuleAccessLevel: () => ({ accessLevel: 4, isLoading: false }) }));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/inventory',
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: () => permission,
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

vi.mock('@/app/(dashboard)/inventory/components/InventoryTable', () => ({
  InventoryTable: ({
    items,
    onRestore,
    tableLabel,
  }: {
    items: Array<{ id: string; item_number: string }>;
    onRestore?: (item: { id: string; item_number: string }) => void;
    tableLabel?: string;
  }) => (
    <div>
      <div>{`table:${tableLabel}`}</div>
      {items.map((item) => (
        <div key={item.id}>
          <span>{item.item_number}</span>
          {onRestore ? (
            <button type="button" onClick={() => onRestore(item)}>
              {`Restore ${item.item_number}`}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  ),
}));

import InventoryPage from '@/app/(dashboard)/inventory/page';

interface RetiredFixture {
  userId: string;
  manager: boolean;
  count: number;
  rows: Array<{ id: string; item_number: string; status: 'retired' }>;
  failRetiredRows: boolean;
}

const fixture: RetiredFixture = {
  userId: 'manager-1',
  manager: true,
  count: 2,
  rows: [
    { id: 'retired-1', item_number: 'R-1', status: 'retired' },
    { id: 'retired-2', item_number: 'R-2', status: 'retired' },
  ],
  failRetiredRows: false,
};

const fetchMock = vi.fn();
let hangingRowResponse: ((response: Response) => void) | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetch() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (url.endsWith('/api/inventory/context')) {
      return jsonResponse({
        user_id: fixture.userId,
        is_manager_or_admin: fixture.manager,
        can_manage_site_locations: false,
        role_name: fixture.manager ? 'Manager' : 'Employee',
        role_class: fixture.manager ? 'manager' : 'employee',
        team_id: null,
        team_name: null,
        user_location: null,
        secondary_site_locations: [],
        is_user_location_valid: true,
      });
    }
    if (url.includes('/api/inventory/fleet-assets')) return jsonResponse({ assets: [] });
    if (url.includes('/api/inventory/categories')) return jsonResponse({ categories: [] });
    if (url.includes('/api/inventory/hardware')) return jsonResponse({ items: [], balances: [] });
    if (url.includes('/api/inventory/groups')) return jsonResponse({ groups: [] });
    if (url.includes('/api/inventory/site-assignments')) {
      return jsonResponse({ active_locations: [], users: [], assignments: [] });
    }
    if (method === 'PATCH' && url.includes('/api/inventory/retired-1')) {
      fixture.count = 0;
      fixture.rows = [];
      return jsonResponse({});
    }
    if (url.includes('status=retired') && url.includes('count=exact')) {
      return jsonResponse({ count: fixture.count });
    }
    if (url.includes('status=retired')) {
      if (hangingRowResponse) {
        return new Promise<Response>((resolve) => {
          hangingRowResponse = resolve;
        });
      }
      if (fixture.failRetiredRows) {
        return jsonResponse({ error: 'Retired rows unavailable' }, 503);
      }
      return jsonResponse({
        inventory: fixture.rows,
        pagination: { offset: 0, limit: 500, has_more: false },
      });
    }
    if (url.includes('/api/inventory?')) {
      return jsonResponse({
        inventory: [{ id: 'active-1', item_number: 'A-1', name: 'Hammer', category: 'tools', status: 'active' }],
        pagination: { offset: 0, limit: 500, has_more: false },
      });
    }
    return jsonResponse({ error: `unexpected ${method} ${url}` }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function retiredRowCalls(): number {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = String(input);
    return url.includes('status=retired') && !url.includes('count=exact');
  }).length;
}

describe('inventory retired lazy loading', () => {
  beforeEach(() => {
    permission.hasPermission = true;
    permission.loading = false;
    resetRetiredInventoryLoaderState();
    fetchMock.mockReset();
    hangingRowResponse = null;
    fixture.userId = 'manager-1';
    fixture.manager = true;
    fixture.count = 2;
    fixture.rows = [
      { id: 'retired-1', item_number: 'R-1', status: 'retired' },
      { id: 'retired-2', item_number: 'R-2', status: 'retired' },
    ];
    fixture.failRetiredRows = false;
    window.localStorage.setItem('inventory-role-view-mode', 'management');
    installFetch();
  });

  it('shows the retired count before downloading rows, then loads rows once', async () => {
    render(<InventoryPage />);

    expect(await screen.findByRole('tab', { name: 'Retired Items (2)' })).toBeInTheDocument();
    expect(retiredRowCalls()).toBe(0);

    hangingRowResponse = () => undefined;
    fireEvent.click(screen.getByRole('tab', { name: 'Retired Items (2)' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Small Tools' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Retired Items (2)' }));
    expect(retiredRowCalls()).toBe(1);
    expect(screen.getByText('Loading retired items...')).toBeInTheDocument();

    const resolveRows = hangingRowResponse;
    hangingRowResponse = null;
    resolveRows?.(jsonResponse({
      inventory: fixture.rows,
      pagination: { offset: 0, limit: 500, has_more: false },
    }));

    expect(await screen.findByText('R-1')).toBeInTheDocument();
    expect(screen.getByText('R-2')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Retired Items (2)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Small Tools' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Retired Items (2)' }));
    expect(retiredRowCalls()).toBe(1);
  });

  it('retries a failed retired row load and refreshes loaded rows after restore', async () => {
    fixture.failRetiredRows = true;
    render(<InventoryPage />);
    expect(await screen.findByRole('tab', { name: 'Retired Items (2)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Retired Items (2)' }));
    expect(await screen.findByText('Retired rows unavailable')).toBeInTheDocument();

    fixture.failRetiredRows = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('R-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore R-1' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Retired Items (0)' })).toBeInTheDocument();
    });
    expect(screen.queryByText('R-1')).not.toBeInTheDocument();
    expect(retiredRowCalls()).toBe(3);
  });

  it('does not request retired inventory for a non-manager', async () => {
    fixture.manager = false;
    fixture.userId = 'staff-1';
    window.localStorage.setItem('inventory-role-view-mode', 'employee');
    render(<InventoryPage />);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/inventory?'))).toBe(true);
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('status=retired'))).toBe(false);
    expect(screen.queryByRole('tab', { name: /Retired Items/ })).not.toBeInTheDocument();
  });

  it('ignores pending retired rows after access is lost and reloads a new actor scope', async () => {
    const view = render(<InventoryPage />);
    expect(await screen.findByRole('tab', { name: 'Retired Items (2)' })).toBeInTheDocument();
    hangingRowResponse = () => undefined;
    fireEvent.click(screen.getByRole('tab', { name: 'Retired Items (2)' }));
    await waitFor(() => expect(retiredRowCalls()).toBe(1));
    const resolveOldRows = hangingRowResponse;
    hangingRowResponse = null;
    permission.hasPermission = false;
    view.rerender(<InventoryPage />);
    await act(async () => {
      resolveOldRows?.(jsonResponse({ inventory: fixture.rows, pagination: { has_more: false } }));
    });
    expect(screen.queryByText('R-1')).not.toBeInTheDocument();
    fixture.userId = 'manager-2';
    fixture.count = 0;
    fixture.rows = [];
    permission.hasPermission = true;
    view.rerender(<InventoryPage />);
    expect(await screen.findByRole('tab', { name: 'Retired Items (0)' })).toBeInTheDocument();
    expect(screen.queryByText('R-1')).not.toBeInTheDocument();
  });
});
