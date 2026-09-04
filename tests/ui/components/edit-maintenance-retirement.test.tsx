/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditMaintenanceDialog } from '@/app/(dashboard)/maintenance/components/EditMaintenanceDialog';

const mocks = vi.hoisted(() => ({
  createMutation: { isPending: false, mutateAsync: vi.fn() },
  updateMutation: { isPending: false, mutateAsync: vi.fn() },
  taskResult: { data: [] as Array<{ id: string }>, error: null as Error | null },
  taskLimit: vi.fn(),
  toastError: vi.fn(),
  triggerShakeAnimation: vi.fn(),
}));

vi.mock('@/lib/hooks/useMaintenance', () => ({
  useCreateMaintenance: () => mocks.createMutation,
  useUpdateMaintenance: () => mocks.updateMutation,
  useMaintenance: () => ({ data: { vehicles: [] } }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            neq: () => ({
              limit: mocks.taskLimit,
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/utils/animations', () => ({
  triggerShakeAnimation: mocks.triggerShakeAnimation,
}));

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
  },
}));

vi.mock('@/components/fleet/NextServiceTypeSelect', () => ({
  NextServiceTypeSelect: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <div>
      <output data-testid="next-service-type">{value}</output>
      <button
        type="button"
        onClick={() => onChange('22222222-2222-4222-8222-222222222222')}
      >
        Change next service type
      </button>
    </div>
  ),
}));

vi.mock('@/components/fleet/NicknameUserCombobox', () => ({
  NicknameUserCombobox: ({
    value,
    selectedUserId,
    onNicknameChange,
    onUserSelect,
  }: {
    value: string;
    selectedUserId: string | null;
    onNicknameChange: (value: string) => void;
    onUserSelect: (user: { id: string; fullName: string } | null) => void;
  }) => (
    <div>
      <input
        aria-label="Van Nickname"
        value={value}
        onChange={(event) => onNicknameChange(event.target.value)}
      />
      <output data-testid="selected-user">{selectedUserId || ''}</output>
      <button
        type="button"
        onClick={() => onUserSelect({ id: 'user-2', fullName: 'Alex' })}
      >
        Select Alex
      </button>
    </div>
  ),
}));

const vehicle = {
  id: 'maintenance-1',
  van_id: 'van-1',
  hgv_id: null,
  plant_id: null,
  tax_due_date: null,
  mot_due_date: null,
  first_aid_kit_expiry: null,
  current_mileage: 1000,
  last_service_mileage: 500,
  next_service_mileage: 1500,
  cambelt_due_mileage: null,
  next_service_template_id: '11111111-1111-4111-8111-111111111111',
  tracker_id: null,
  last_mileage_update: null,
  last_updated_at: '2026-08-01T00:00:00.000Z',
  last_updated_by: null,
  last_dvla_sync: null,
  dvla_sync_status: null,
  dvla_sync_error: null,
  dvla_raw_data: null,
  ves_make: null,
  ves_colour: null,
  ves_fuel_type: null,
  ves_year_of_manufacture: null,
  ves_engine_capacity: null,
  ves_tax_status: null,
  ves_mot_status: null,
  ves_co2_emissions: null,
  ves_euro_status: null,
  ves_real_driving_emissions: null,
  ves_type_approval: null,
  ves_wheelplan: null,
  ves_revenue_weight: null,
  ves_marked_for_export: null,
  ves_month_of_first_registration: null,
  ves_date_of_last_v5c_issued: null,
  mot_expiry_date: null,
  mot_api_sync_status: null,
  mot_api_sync_error: null,
  last_mot_api_sync: null,
  mot_raw_data: null,
  mot_make: null,
  mot_model: null,
  mot_first_used_date: null,
  mot_registration_date: null,
  mot_manufacture_date: null,
  mot_engine_size: null,
  mot_fuel_type: null,
  mot_primary_colour: null,
  mot_secondary_colour: null,
  mot_vehicle_id: null,
  mot_registration: null,
  mot_vin: null,
  mot_v5c_reference: null,
  mot_dvla_id: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  notes: null,
  overdue_count: 0,
  due_soon_count: 0,
  vehicle: {
    id: 'van-1',
    reg_number: 'AB12 CDE',
    category_id: 'category-1',
    status: 'active',
    nickname: 'Original',
    asset_type: 'van',
  },
  maintenance_items: [
    {
      id: 'service-item',
      category_id: 'service-category',
      category_name: 'Service',
      category_type: 'mileage',
      category_field_key: 'next_service_mileage',
      source: 'system',
      is_system: true,
      is_delete_protected: true,
      sort_order: 1,
      asset_type: 'van',
      status: { status: 'ok' },
      due_date: null,
      due_mileage: 1500,
      last_mileage: 500,
      due_hours: null,
      last_hours: null,
      display_value: '1,500',
      display_unit: 'miles',
    },
    {
      id: 'custom-item',
      category_id: 'custom-category',
      category_name: 'Custom Check',
      category_type: 'date',
      category_field_key: null,
      source: 'custom',
      is_system: false,
      is_delete_protected: false,
      sort_order: 2,
      asset_type: 'van',
      status: { status: 'ok' },
      due_date: '2026-09-01',
      due_mileage: null,
      last_mileage: null,
      due_hours: null,
      last_hours: null,
      display_value: '01/09/2026',
      display_unit: 'date',
    },
  ],
};

function mockAssignmentFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ assignment: null }),
  })));
}

describe('EditMaintenanceDialog retirement handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.taskResult.data = [];
    mocks.taskResult.error = null;
    mocks.taskLimit.mockImplementation(async () => mocks.taskResult);
    mockAssignmentFetch();
  });

  it('RETIRE-UI-001 / RETIRE-DISCARD-001 bypasses edit validation and discards unsaved state', async () => {
    const events: string[] = [];

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Reopen</button>
          <EditMaintenanceDialog
            open={open}
            onOpenChange={(nextOpen) => {
              events.push(`open:${String(nextOpen)}`);
              setOpen(nextOpen);
            }}
            onRetire={() => events.push('retire')}
            vehicle={vehicle as never}
          />
        </>
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Change next service type' }));
    fireEvent.change(screen.getByLabelText('Custom Check'), { target: { value: '2026-10-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));

    const retireButton = screen.getByRole('button', { name: 'Retire Van' });
    expect(retireButton).toHaveAttribute('type', 'button');
    fireEvent.click(retireButton);

    await waitFor(() => expect(events).toEqual(['open:false', 'retire']));
    expect(mocks.taskLimit).toHaveBeenCalledOnce();
    expect(mocks.createMutation.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.updateMutation.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.triggerShakeAnimation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    await waitFor(() => {
      expect(screen.getByTestId('next-service-type')).toHaveTextContent(
        '11111111-1111-4111-8111-111111111111'
      );
      expect(screen.getByLabelText('Custom Check')).toHaveValue('2026-09-01');
      expect(screen.getByLabelText('Van Nickname')).toHaveValue('Original');
      expect(screen.getByTestId('selected-user')).toHaveTextContent('');
    });
  });

  it('RETIRE-SAFE-001 fails closed on open tasks without discarding edits', async () => {
    mocks.taskResult.data = [{ id: 'task-1' }];
    const onOpenChange = vi.fn();
    const onRetire = vi.fn();

    render(
      <EditMaintenanceDialog
        open
        onOpenChange={onOpenChange}
        onRetire={onRetire}
        vehicle={vehicle as never}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Change next service type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retire Van' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      'Cannot retire van with open workshop tasks',
      expect.any(Object)
    ));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onRetire).not.toHaveBeenCalled();
    expect(screen.getByTestId('next-service-type')).toHaveTextContent(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('RETIRE-SAFE-001 fails closed on task query errors without discarding edits', async () => {
    mocks.taskResult.error = new Error('query failed');
    const onOpenChange = vi.fn();
    const onRetire = vi.fn();

    render(
      <EditMaintenanceDialog
        open
        onOpenChange={onOpenChange}
        onRetire={onRetire}
        vehicle={vehicle as never}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Change next service type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retire Van' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      'Failed to verify workshop tasks'
    ));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onRetire).not.toHaveBeenCalled();
    expect(screen.getByTestId('next-service-type')).toHaveTextContent(
      '22222222-2222-4222-8222-222222222222'
    );
  });
});

describe('EditMaintenanceDialog save failure logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.taskResult.data = [];
    mocks.taskResult.error = null;
    mocks.taskLimit.mockImplementation(async () => mocks.taskResult);
    mockAssignmentFetch();
  });

  it('FIXERRORS-C1-001 shows one failure toast without a duplicate dialog console error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.updateMutation.mutateAsync.mockRejectedValue(new Error('Internal server error'));

    render(
      <EditMaintenanceDialog
        open
        onOpenChange={vi.fn()}
        vehicle={vehicle as never}
      />
    );

    fireEvent.change(screen.getByLabelText(/Update Comment/), {
      target: { value: 'Updated MOT dates after inspection' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mocks.updateMutation.mutateAsync).toHaveBeenCalledOnce();
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledWith('Internal server error');
    });

    expect(consoleError.mock.calls.some(([message]) => (
      typeof message === 'string' && message.includes('Error saving maintenance changes')
    ))).toBe(false);

    consoleError.mockRestore();
  });
});
