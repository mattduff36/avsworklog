/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Navbar } from '@/components/layout/Navbar';

const authMockState = {
  user: { id: 'user-1' },
  profile: { id: 'user-1', full_name: 'Test User' },
  signOut: vi.fn(async () => ({ error: null })),
  isAdmin: false,
  isManager: true,
  isActualSuperAdmin: false,
  isViewingAs: false,
};

let mockPathname = '/inventory';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
    },
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn(() => ({ id: 'test-channel' })),
      };
      return channel;
    }),
    removeChannel: vi.fn(async () => {}),
  }),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => authMockState,
}));

vi.mock('@/lib/hooks/usePermissionSnapshot', () => ({
  usePermissionSnapshot: () => ({
    enabledModuleSet: new Set(['inventory', 'help']),
  }),
}));

vi.mock('@/lib/hooks/useNavMetrics', () => ({
  useRamsAssignmentSummary: () => ({ data: { hasAssignments: false, pendingCount: 0 } }),
  usePendingAbsenceCount: () => ({ count: 0 }),
}));

vi.mock('@/components/layout/dashboard-task-badge-context', () => ({
  useDashboardTaskBadges: () => ({
    counts: {
      approvals: 0,
      actions: 0,
      suggestions: 0,
      quotes: 0,
      errorReports: 0,
      errorLogs: 0,
    },
    ready: false,
  }),
}));

vi.mock('@/components/layout/tablet-mode-context', () => ({
  useTabletMode: () => ({
    tabletModeEnabled: false,
    toggleTabletMode: vi.fn(),
  }),
}));

vi.mock('@/components/layout/TabletModeToggleActions', () => ({
  TabletModeToggleActions: () => null,
}));

vi.mock('@/components/layout/SidebarNav', () => ({
  SidebarNav: () => null,
}));

vi.mock('@/components/messages/NotificationPanel', () => ({
  NotificationPanel: () => null,
}));

vi.mock('@/lib/config/release-version', () => ({
  getPublicReleaseVersion: () => '0826.3.0',
  getPublicReleaseVersionLabel: () => 'Version 0826.3.0',
}));

describe('Navbar inventory mobile view slot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/inventory';
    Object.assign(authMockState, {
      isAdmin: false,
      isManager: true,
      isActualSuperAdmin: false,
      isViewingAs: false,
    });

    // @ts-expect-error - tests provide a lightweight ResizeObserver mock.
    global.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ count: 0 }), { status: 200 }));
  });

  it('mounts the centered mobile view slot for managers on /inventory only', () => {
    const { unmount } = render(<Navbar />);
    const slot = document.getElementById('inventory-mobile-view-toggle-slot');
    expect(slot).toBeTruthy();
    expect(slot?.className).toContain('justify-center');
    expect(slot?.className).toContain('md:hidden');
    unmount();

    mockPathname = '/inventory/items/item-1';
    render(<Navbar />);
    expect(document.getElementById('inventory-mobile-view-toggle-slot')).toBeNull();
  });

  it('hides the slot for employees and for non-inventory routes', () => {
    authMockState.isManager = false;
    authMockState.isAdmin = false;
    mockPathname = '/inventory';
    const { unmount } = render(<Navbar />);
    expect(document.getElementById('inventory-mobile-view-toggle-slot')).toBeNull();
    unmount();

    authMockState.isAdmin = true;
    mockPathname = '/dashboard';
    render(<Navbar />);
    expect(document.getElementById('inventory-mobile-view-toggle-slot')).toBeNull();
    expect(screen.getAllByText('SQUIRES').length).toBeGreaterThan(0);
  });
});
