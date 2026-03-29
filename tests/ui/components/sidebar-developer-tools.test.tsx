/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SidebarNav } from '@/components/layout/SidebarNav';

const authMockState = {
  isAdmin: false,
  isManager: false,
  effectiveRole: null,
  isViewingAs: false,
  isActualSuperAdmin: true,
};

const viewAsSelectionMock = {
  roleId: '',
  teamId: '',
};

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => authMockState,
}));

vi.mock('@/lib/hooks/usePermissionSnapshot', () => ({
  usePermissionSnapshot: () => ({
    enabledModuleSet: new Set(),
  }),
}));

vi.mock('@/lib/hooks/useNavMetrics', () => ({
  usePendingAbsenceCount: () => ({ count: 0 }),
}));

vi.mock('@/components/layout/tablet-mode-context', () => ({
  useTabletMode: () => ({
    tabletModeEnabled: false,
  }),
}));

vi.mock('@/lib/utils/view-as-cookie', () => ({
  getViewAsSelection: () => viewAsSelectionMock,
  setViewAsSelection: vi.fn(),
  clearViewAsSelection: vi.fn(),
}));

describe('Sidebar developer tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewAsSelectionMock.roleId = '';
    viewAsSelectionMock.teamId = '';
    Object.assign(authMockState, {
      isAdmin: false,
      isManager: false,
      effectiveRole: null,
      isViewingAs: false,
      isActualSuperAdmin: true,
    });

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        roles: [],
        teams: [],
      }),
    })) as unknown as typeof fetch;
  });

  it('shows Active Now entry for actual superadmin', async () => {
    render(<SidebarNav open onToggle={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Active Now')).toBeInTheDocument();
      expect(screen.getByText('Debug Console')).toBeInTheDocument();
    });
  });

  it('hides developer entries while viewing-as override is active', async () => {
    viewAsSelectionMock.roleId = 'role-override';

    render(<SidebarNav open onToggle={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText('Active Now')).not.toBeInTheDocument();
      expect(screen.queryByText('Debug Console')).not.toBeInTheDocument();
    });
  });
});
