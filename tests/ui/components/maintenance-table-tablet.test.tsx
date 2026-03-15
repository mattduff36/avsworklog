import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import { MaintenanceTable } from '@/app/(dashboard)/maintenance/components/MaintenanceTable';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    isAdmin: true,
    isManager: true,
  }),
}));

vi.mock('@/lib/hooks/useMaintenance', () => ({
  useDeletedVehicles: () => ({
    data: { count: 0, vehicles: [] },
    isLoading: false,
  }),
  usePermanentlyDeleteArchivedVehicle: () => ({
    mutate: vi.fn(),
  }),
  useRestoreArchivedVehicle: () => ({
    mutate: vi.fn(),
  }),
}));

vi.mock('@/app/(dashboard)/maintenance/components/EditMaintenanceDialog', () => ({
  EditMaintenanceDialog: () => null,
}));

vi.mock('@/app/(dashboard)/maintenance/components/DeleteVehicleDialog', () => ({
  DeleteVehicleDialog: () => null,
}));

vi.mock('@/app/(dashboard)/maintenance/components/add-asset/AddAssetFlowDialog', () => ({
  AddAssetFlowDialog: () => null,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'maintenance-table-user' } },
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
    })),
  }),
}));

describe('MaintenanceTable tablet controls', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps compact search controls when tablet mode is off', async () => {
    render(
      <TabletModeProvider>
        <MaintenanceTable
          vehicles={[]}
          searchQuery=""
          onSearchChange={vi.fn()}
        />
      </TabletModeProvider>
    );

    const input = screen.getByPlaceholderText('Search by registration number...');
    await waitFor(() => {
      expect(input).toBeInTheDocument();
    });
    expect(input.className).not.toContain('min-h-11');
  });

  it('applies touch-friendly search controls when tablet mode is enabled', async () => {
    localStorage.setItem('tablet_mode:maintenance-table-user', 'on');

    render(
      <TabletModeProvider>
        <MaintenanceTable
          vehicles={[]}
          searchQuery=""
          onSearchChange={vi.fn()}
        />
      </TabletModeProvider>
    );

    const input = screen.getByPlaceholderText('Search by registration number...');
    await waitFor(() => {
      expect(input.className).toContain('min-h-11');
    });
  });
});
