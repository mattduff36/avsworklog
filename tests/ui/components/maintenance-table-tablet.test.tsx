import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@/lib/app-auth/client', () => ({
  subscribeToAuthStateChange: () => vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
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
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            user: { id: 'maintenance-table-user' },
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;
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

    const input = screen.getByPlaceholderText('Search Vans...');
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

    const input = screen.getByPlaceholderText('Search Vans...');
    await waitFor(() => {
      expect(input.className).toContain('min-h-11');
    });
  });

  it.each(['van', 'hgv'] as const)('keeps %s service labels and the due warning', async (assetType) => {
    render(
      <TabletModeProvider>
        <MaintenanceTable
          vehicles={[{
            id: 'vm-1',
            van_id: assetType === 'van' ? 'van-1' : null,
            hgv_id: assetType === 'hgv' ? 'hgv-1' : null,
            plant_id: null,
            current_mileage: 18000,
            next_service_mileage: 12000,
            next_service_template_id: assetType === 'hgv' ? 'hgv-full' : null,
            next_service_compact_label: assetType === 'hgv' ? 'Full' : null,
            show_service_type_badge: true,
            tax_due_date: '2026-01-01',
            mot_due_date: '2026-02-01',
            tax_status: { status: 'overdue' },
            mot_status: { status: 'ok' },
            overdue_count: 1,
            due_soon_count: 0,
            vehicle: { id: 'van-1', reg_number: 'VAN1', status: 'active', asset_type: assetType, nickname: null, category_id: null },
            maintenance_items: [{
              id: 'item-1',
              category_id: 'service',
              category_name: 'Service',
              category_type: 'mileage',
              category_field_key: 'next_service_mileage',
              source: 'system',
              is_system: true,
              is_delete_protected: true,
              sort_order: 1,
              asset_type: 'van',
              status: { status: 'overdue' },
              due_date: null,
              due_mileage: 12000,
              last_mileage: null,
              due_hours: null,
              last_hours: null,
              display_value: 'Overdue 12,000',
              display_unit: 'miles',
            }],
          } as never]}
          searchQuery=""
          onSearchChange={vi.fn()}
        />
      </TabletModeProvider>
    );

    const expectedLabel = assetType === 'van' ? 'Next service type needs choosing' : 'Full';
    expect((await screen.findAllByText(expectedLabel)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Overdue 12,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OVERDUE').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('heading', { name: 'VAN1' }));

    expect(screen.getAllByText(expectedLabel).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Overdue 12,000').length).toBeGreaterThan(0);
  });
});
