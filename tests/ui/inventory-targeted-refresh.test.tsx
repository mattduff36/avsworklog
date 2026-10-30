/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { InventoryItemFormData } from '@/app/(dashboard)/inventory/types';
import { resetRetiredInventoryLoaderState } from '@/lib/client/inventory-retired-loader';

const pushMock = vi.fn();
const routerMock = { push: pushMock, replace: vi.fn() };
const searchParams = new URLSearchParams();
const permission = { hasPermission: true, loading: false, serviceUnavailable: false, errorStatus: null };

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/inventory',
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: () => permission,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
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
    categoryLabels,
    onRestore,
  }: {
    items: Array<{ id: string; item_number: string; category?: string }>;
    categoryLabels?: Record<string, string>;
    onRestore?: (item: { id: string; item_number: string }) => void;
  }) => (
    <div>
      {items.map((item) => (
        <div key={item.id}>
          <span>{item.item_number}</span>
          <span>{item.category ? categoryLabels?.[item.category] || item.category : ''}</span>
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

vi.mock('@/app/(dashboard)/inventory/components/HardwareOverviewPanel', () => ({
  HardwareOverviewPanel: ({
    items,
    onTransfer,
  }: {
    items: Array<{ name?: string }>;
    onTransfer: (payload: { lines: Array<{ item_id: string; from_location_id: string; to_location_id: string; quantity: number }> }) => void;
  }) => (
    <div>
      <div>{`hardware:${items[0]?.name || 'none'}`}</div>
      <button
        type="button"
        onClick={() => onTransfer({
          lines: [{ item_id: 'hw-1', from_location_id: 'loc-1', to_location_id: 'loc-2', quantity: 1 }],
        })}
      >
        Transfer hardware
      </button>
    </div>
  ),
}));

vi.mock('@/app/(dashboard)/inventory/components/InventoryCategoriesPanel', () => ({
  InventoryCategoriesPanel: ({
    categories,
    onUpdate,
  }: {
    categories: Array<{ id: string; name: string; slug: string }>;
    onUpdate: (
      category: { id: string; name: string; slug: string },
      data: { name: string; slug: string; description: string; sort_order: string },
    ) => void;
  }) => (
    <div>
      <div>{`category:${categories[0]?.name || 'none'}`}</div>
      <button
        type="button"
        onClick={() => onUpdate(
          categories[0],
          { name: 'Tools 2', slug: 'tools', description: '', sort_order: '1' },
        )}
      >
        Rename category
      </button>
    </div>
  ),
}));

vi.mock('@/app/(dashboard)/inventory/components/InventoryItemDialog', () => ({
  InventoryItemDialog: ({ categories, onSubmit }: {
    categories: Array<{ item_count?: number }>;
    onSubmit: (data: InventoryItemFormData) => Promise<void>;
  }) => <div>
    <span>{`category-count:${categories[0]?.item_count ?? 0}`}</span>
    <button type="button" onClick={() => void onSubmit({ item_number: 'A-CREATED', name: 'Synthetic item', category: 'tools', location_id: '', last_checked_at: '', check_interval_months: '', serial_number: '', status: 'active' })}>Create fixture item</button>
  </div>,
}));

import InventoryPage from '@/app/(dashboard)/inventory/page';

const fetchMock = vi.fn();
const fixture = {
  userId: 'manager-1',
  manager: true,
  count: 2,
  hardwareName: 'Screws',
  categoryName: 'Tools',
  categoryCount: 2,
  activeNumber: 'A-1',
  rows: [
    { id: 'retired-1', item_number: 'R-1', category: 'tools', status: 'retired' as const },
  ],
};

let hardwareGets = 0;
let useHardwareScript = false;
const hardwareScript = ['Screws', 'Screws-stale', 'Bolts'];
let holdNextActiveItems = false;
let releaseHeldItems: ((response: Response) => void) | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isActiveItems(url: string): boolean {
  return url.includes('/api/inventory?') && !url.includes('status=retired');
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
        team_id: 'team-1',
        team_name: 'Yard',
        user_location: null,
        secondary_site_locations: [],
        is_user_location_valid: true,
      });
    }
    if (url.includes('/api/inventory/fleet-assets')) return jsonResponse({ assets: [] });
    if (url.includes('/api/inventory/categories') && method === 'GET') {
      return jsonResponse({
        categories: [{ id: 'cat-1', name: fixture.categoryName, slug: 'tools', description: '', sort_order: 1, item_count: fixture.categoryCount }],
      });
    }
    if (method === 'PATCH' && url.includes('/api/inventory/categories/')) {
      fixture.categoryName = 'Tools 2';
      return jsonResponse({ category: { id: 'cat-1' } });
    }
    if (url === '/api/inventory' && method === 'POST') {
      fixture.categoryCount += 1;
      fixture.activeNumber = 'A-CREATED';
      return jsonResponse({ inventory: {} });
    }
    if (url.includes('/api/inventory/hardware/transfers') && method === 'POST') {
      if (!useHardwareScript) fixture.hardwareName = 'Bolts';
      return jsonResponse({ success: true });
    }
    if (url.includes('/api/inventory/hardware') && method === 'GET') {
      const name = useHardwareScript
        ? hardwareScript[hardwareGets] || fixture.hardwareName
        : fixture.hardwareName;
      hardwareGets += 1;
      return jsonResponse({ items: [{ id: 'hw-1', name }], balances: [] });
    }
    if (url.includes('/api/inventory/groups')) return jsonResponse({ groups: [] });
    if (url.includes('/api/inventory/site-assignments')) {
      return jsonResponse({ active_locations: [], users: [], assignments: [] });
    }
    if (method === 'PATCH' && url.includes('/api/inventory/retired-1')) {
      fixture.count = 0;
      fixture.rows = [];
      fixture.activeNumber = 'A-RESTORED';
      return jsonResponse({});
    }
    if (url.includes('status=retired') && url.includes('count=exact')) {
      return jsonResponse({ count: fixture.count });
    }
    if (url.includes('status=retired')) {
      return jsonResponse({
        inventory: fixture.rows,
        pagination: { offset: 0, limit: 500, has_more: false },
      });
    }
    if (isActiveItems(url)) {
      if (holdNextActiveItems) {
        holdNextActiveItems = false;
        return new Promise<Response>((resolve) => {
          releaseHeldItems = resolve;
        });
      }
      return jsonResponse({
        inventory: [{
          id: 'active-1',
          item_number: fixture.activeNumber,
          name: 'Hammer',
          category: 'tools',
          status: 'active',
        }],
        pagination: { offset: 0, limit: 500, has_more: false },
      });
    }
    return jsonResponse({ error: `unexpected ${method} ${url}` }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function getCallsSince(start: number) {
  return fetchMock.mock.calls.slice(start).map(([input, init]) => ({
    url: String(input),
    method: (init?.method || 'GET').toUpperCase(),
  }));
}

describe('inventory targeted refresh', () => {
  beforeEach(() => {
    permission.hasPermission = true;
    permission.loading = false;
    resetRetiredInventoryLoaderState();
    fetchMock.mockReset();
    hardwareGets = 0;
    useHardwareScript = false;
    holdNextActiveItems = false;
    releaseHeldItems = null;
    fixture.userId = 'manager-1';
    fixture.manager = true;
    fixture.count = 2;
    fixture.hardwareName = 'Screws';
    fixture.categoryName = 'Tools';
    fixture.categoryCount = 2;
    fixture.activeNumber = 'A-1';
    fixture.rows = [
      { id: 'retired-1', item_number: 'R-1', category: 'tools', status: 'retired' },
    ];
    window.localStorage.setItem('inventory-role-view-mode', 'management');
    installFetch();
  });

  it('refreshes hardware without rereading unrelated inventory collections', async () => {
    render(<InventoryPage />);
    expect(await screen.findByText('A-1')).toBeInTheDocument();
    const start = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('tab', { name: 'Hardware' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transfer hardware' }));

    expect(await screen.findByText('hardware:Bolts')).toBeInTheDocument();
    const reads = getCallsSince(start).filter((call) => call.method === 'GET');
    expect(reads).toHaveLength(2);
    console.info('Synthetic hardware refresh GETs', JSON.stringify({ initialFull: fetchMock.mock.calls.slice(0, start).filter(([, init]) => !init?.method || init.method === 'GET').length, targeted: reads.length }));
    expect(reads.some((call) => call.url.endsWith('/api/inventory/context'))).toBe(true);
    expect(reads.some((call) => call.url.includes('/api/inventory/hardware'))).toBe(true);
    expect(reads.some((call) => isActiveItems(call.url))).toBe(false);
    expect(reads.some((call) => call.url.includes('status=retired'))).toBe(false);
    expect(reads.some((call) => call.url.includes('/api/inventory/fleet-assets'))).toBe(false);
    expect(reads.some((call) => call.url.includes('/api/inventory/categories'))).toBe(false);
    expect(reads.some((call) => call.url.includes('/api/inventory/groups'))).toBe(false);
    expect(reads.some((call) => call.url.includes('/api/inventory/site-assignments'))).toBe(false);
  });

  it('refreshes active items, retired count and loaded retired rows after restore', async () => {
    render(<InventoryPage />);
    expect(await screen.findByRole('tab', { name: 'Retired Items (2)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Retired Items (2)' }));
    expect(await screen.findByText('R-1')).toBeInTheDocument();
    const start = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Restore R-1' }));

    expect(await screen.findByRole('tab', { name: 'Retired Items (0)' })).toBeInTheDocument();
    expect(screen.queryByText('R-1')).not.toBeInTheDocument();
    const reads = getCallsSince(start).filter((call) => call.method === 'GET');
    expect(reads.some((call) => isActiveItems(call.url))).toBe(true);
    expect(reads.some((call) => call.url.includes('status=retired') && call.url.includes('count=exact'))).toBe(true);
    expect(reads.some((call) => call.url.includes('status=retired') && !call.url.includes('count=exact'))).toBe(true);
    expect(reads.some((call) => call.url.includes('/api/inventory/groups'))).toBe(true);
    expect(reads.some((call) => call.url.includes('/api/inventory/hardware'))).toBe(true);
    expect(reads.some((call) => call.url.includes('/api/inventory/fleet-assets'))).toBe(false);
  });

  it('refreshes category labels used by active items', async () => {
    render(<InventoryPage />);
    expect(await screen.findByText('Tools')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename category' }));
    expect(await screen.findByText('category:Tools 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(await screen.findByText('Tools 2')).toBeInTheDocument();
  });

  it('updates the category counter after creating an item', async () => {
    render(<InventoryPage />);
    expect(await screen.findByText('category-count:2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create fixture item' }));
    expect(await screen.findByText('category-count:3')).toBeInTheDocument();
    expect(await screen.findByText('A-CREATED')).toBeInTheDocument();
  });

  it('runs a newer permission-scope refresh queued behind an obsolete pending load', async () => {
    const view = render(<InventoryPage />);
    expect(await screen.findByText('A-1')).toBeInTheDocument();
    holdNextActiveItems = true;
    permission.loading = true;
    view.rerender(<InventoryPage />);
    permission.loading = false;
    view.rerender(<InventoryPage />);
    await waitFor(() => expect(releaseHeldItems).toBeTruthy());
    fixture.userId = 'manager-2';
    fixture.activeNumber = 'A-NEW-SCOPE';
    permission.loading = true;
    view.rerender(<InventoryPage />);
    permission.loading = false;
    view.rerender(<InventoryPage />);
    const release = releaseHeldItems!;
    releaseHeldItems = null;
    release(jsonResponse({ inventory: [{ id: 'old', item_number: 'A-OBSOLETE', category: 'tools', status: 'active' }], pagination: { offset: 0, limit: 500, has_more: false } }));
    expect(await screen.findByText('A-NEW-SCOPE')).toBeInTheDocument();
    expect(screen.queryByText('A-OBSOLETE')).not.toBeInTheDocument();
    view.unmount();
  });

  it('keeps a scope refresh ahead of a later hardware refresh', async () => {
    render(<InventoryPage />);
    expect(await screen.findByRole('tab', { name: 'Retired Items (2)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Retired Items (2)' }));
    expect(await screen.findByText('R-1')).toBeInTheDocument();

    useHardwareScript = true;
    fixture.userId = 'manager-2';
    fixture.count = 1;
    fixture.rows = [{ id: 'retired-2', item_number: 'R-NEW', category: 'tools', status: 'retired' }];
    holdNextActiveItems = true;
    fireEvent.click(screen.getByRole('tab', { name: 'Hardware' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transfer hardware' }));
    await waitFor(() => expect(releaseHeldItems).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Transfer hardware' }));
    const release = releaseHeldItems;
    releaseHeldItems = null;
    release?.(jsonResponse({
      inventory: [{
        id: 'active-1',
        item_number: 'A-1',
        name: 'Hammer',
        category: 'tools',
        status: 'active',
      }],
      pagination: { offset: 0, limit: 500, has_more: false },
    }));

    fireEvent.click(screen.getByRole('tab', { name: /Retired Items/ }));
    expect(await screen.findByText('R-NEW')).toBeInTheDocument();
    expect(screen.queryByText('R-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Hardware' }));
    expect(await screen.findByText('hardware:Bolts')).toBeInTheDocument();
    expect(screen.queryByText('hardware:Screws-stale')).not.toBeInTheDocument();
  });
});
