import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuickEditPopover } from '@/app/(dashboard)/maintenance/components/QuickEditPopover';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

describe('service quick edit concurrency', () => {
  it.each(['Service', 'Service (Hours)'])('sends the original complete snapshot for %s even after a refresh', async (type) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const state = { next_service_mileage: 20000, last_service_mileage: 10000,
      next_service_hours: 500, last_service_hours: 250,
      next_service_template_id: 'basic', next_service_rotation_step_id: 'step-a' };
    const alert = { type, detail: 'due', severity: 'overdue' as const, sortValue: 1 };
    const view = render(<QuickEditPopover alert={alert} vehicleId="fixture" vehicle={state} />);
    fireEvent.click(screen.getByText(`${type}: due`));
    fireEvent.change(await screen.findByLabelText('New Value'), { target: { value: '25000' } });
    fireEvent.change(screen.getByPlaceholderText('Why is this being changed?'), { target: { value: 'Correcting due value' } });
    view.rerender(<QuickEditPopover alert={alert} vehicleId="fixture" vehicle={{ ...state, next_service_template_id: 'full', next_service_rotation_step_id: 'step-b' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.expected_service_state).toEqual(state);
    expect(payload[type === 'Service' ? 'next_service_mileage' : 'next_service_hours']).toBe(25000);
  });
});
