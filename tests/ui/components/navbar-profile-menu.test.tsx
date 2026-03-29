/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Navbar } from '@/components/layout/Navbar';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
    },
  }),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    profile: { id: 'user-1', full_name: 'Test User' },
    signOut: vi.fn(async () => ({ error: null })),
    isAdmin: false,
    isManager: false,
    isActualSuperAdmin: false,
    isViewingAs: false,
  }),
}));

vi.mock('@/lib/hooks/usePermissionSnapshot', () => ({
  usePermissionSnapshot: () => ({
    enabledModuleSet: new Set(['timesheets', 'absence', 'help']),
  }),
}));

vi.mock('@/lib/hooks/useNavMetrics', () => ({
  useRamsAssignmentSummary: () => ({ data: { hasAssignments: false, pendingCount: 0 } }),
  usePendingAbsenceCount: () => ({ count: 0 }),
}));

vi.mock('@/components/layout/tablet-mode-context', () => ({
  useTabletMode: () => ({
    tabletModeEnabled: false,
    toggleTabletMode: vi.fn(),
  }),
}));

vi.mock('@/components/layout/TabletModeToggleActions', () => ({
  TabletModeToggleActions: () => <span>Tablet toggle</span>,
}));

vi.mock('@/components/layout/SidebarNav', () => ({
  SidebarNav: () => null,
}));

vi.mock('@/components/messages/NotificationPanel', () => ({
  NotificationPanel: ({ open }: { open: boolean }) =>
    open ? <div data-testid="notification-panel-open">panel open</div> : null,
}));

describe('Navbar desktop burger menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - tests provide a lightweight ResizeObserver mock.
    global.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, unread_count: 2 }),
    })) as unknown as typeof fetch;
  });

  it('renders expected desktop burger actions and opens notifications panel', async () => {
    render(<Navbar />);

    await waitFor(() => {
      expect(screen.getByTitle('Menu')).toBeInTheDocument();
    });

    const menuButton = screen.getByTitle('Menu');
    fireEvent.pointerDown(menuButton);
    fireEvent.click(menuButton);

    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeTruthy();
      expect(screen.getByText('Notifications')).toBeTruthy();
      expect(screen.getByText('Help')).toBeTruthy();
      expect(screen.getByText('Sign Out')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Notifications'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-panel-open')).toBeInTheDocument();
    });
  });
});

