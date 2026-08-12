/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryKioskDevicesPanel } from '@/app/(dashboard)/inventory/components/InventoryKioskDevicesPanel';

const emptyState = {
  success: true,
  active_pairing: null,
  devices: [],
};

describe('InventoryKioskDevicesPanel', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(emptyState), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('explains browser pairing and starts a labelled pairing window', async () => {
    render(<InventoryKioskDevicesPanel />);

    expect(await screen.findByText('Yard kiosk trusted devices')).toBeInTheDocument();
    expect(screen.queryByText(/No MAC address or browser fingerprint is collected/i))
      .not.toBeInTheDocument();
    expect(screen.queryByText('Install the dedicated Android app'))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tablet setup page' }))
      .not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g. Yard Tablet 1'), {
      target: { value: 'Yard Tablet 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start pairing' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inventory/kiosk/devices',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'start_pairing',
            device_label: 'Yard Tablet 1',
            replace_existing: false,
          }),
        }),
      );
    });
  });

  it('lists active devices with their last automatic login and revoke action', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      active_pairing: null,
      devices: [{
        id: 'device-1',
        device_label: 'Yard Tablet 1',
        last_seen_at: '2026-07-15T16:00:00.000Z',
        last_authenticated_at: '2026-07-15T16:00:00.000Z',
        revoked_at: null,
        created_at: '2026-07-15T15:00:00.000Z',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    render(<InventoryKioskDevicesPanel />);

    expect(await screen.findByText('Yard Tablet 1')).toBeInTheDocument();
    expect(screen.getByText(/Last automatic login/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open kiosk control' }))
      .toHaveAttribute('href', '/inventory/kiosk-control');
    expect(screen.queryByRole('button', { name: 'Start pairing' }))
      .not.toBeInTheDocument();

    const overflowTrigger = screen.getByRole('button', { name: 'More actions for Yard Tablet 1' });
    fireEvent.pointerDown(overflowTrigger);
    fireEvent.click(overflowTrigger);
    expect(await screen.findByText('Revoke device')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByText('Revoke device'), { key: 'Escape' });

    fireEvent.change(screen.getByPlaceholderText('e.g. Yard Tablet 1'), {
      target: { value: 'Replacement Tablet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace existing kiosk' }));
    expect(screen.getByText('Replace the linked Yard kiosk?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start replacement' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inventory/kiosk/devices',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'start_pairing',
            device_label: 'Replacement Tablet',
            replace_existing: true,
          }),
        }),
      );
    });
  });

  function mockOnlineDevice() {
    const onlineDeviceState = {
      success: true,
      active_pairing: null,
      devices: [{
        id: 'device-1',
        device_label: 'Yard Tablet 1',
        last_seen_at: '2026-07-15T16:00:00.000Z',
        last_authenticated_at: '2026-07-15T16:00:00.000Z',
        presence: 'online',
        revoked_at: null,
        created_at: '2026-07-15T15:00:00.000Z',
      }],
    };
    // A fresh Response per call: Response bodies are single-use streams, so every fetch() must get its own instance.
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(onlineDeviceState), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
  }

  it('Ping and Reload issue the matching kiosk command directly', async () => {
    mockOnlineDevice();
    render(<InventoryKioskDevicesPanel />);
    expect(await screen.findByText('Yard Tablet 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ping' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inventory/kiosk/devices',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"command_type":"ping"'),
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inventory/kiosk/devices',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"command_type":"reload_app"'),
        }),
      );
    });
  });

  it.each([
    ['Reset screen', 'Reset Yard Tablet 1?', 'reset_workflow'],
    ['Sign out', 'Sign out Yard Tablet 1?', 'logout'],
    ['Clear & re-pair', 'Clear saved login for Yard Tablet 1?', 'clear_credentials'],
  ])('overflow %s requires confirmation before issuing its command', async (menuLabel, dialogTitle, commandType) => {
    mockOnlineDevice();
    render(<InventoryKioskDevicesPanel />);
    expect(await screen.findByText('Yard Tablet 1')).toBeInTheDocument();

    const overflowTrigger = screen.getByRole('button', { name: 'More actions for Yard Tablet 1' });
    fireEvent.pointerDown(overflowTrigger);
    fireEvent.click(overflowTrigger);
    fireEvent.click(await screen.findByText(menuLabel));

    expect(screen.getByText(dialogTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inventory/kiosk/devices',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining(`"command_type":"${commandType}"`),
        }),
      );
    });
  });

  it('Revoke requires confirmation before revoking the device', async () => {
    mockOnlineDevice();
    render(<InventoryKioskDevicesPanel />);
    expect(await screen.findByText('Yard Tablet 1')).toBeInTheDocument();

    const overflowTrigger = screen.getByRole('button', { name: 'More actions for Yard Tablet 1' });
    fireEvent.pointerDown(overflowTrigger);
    fireEvent.click(overflowTrigger);
    fireEvent.click(await screen.findByText('Revoke device'));

    expect(screen.getByText('Revoke Yard Tablet 1?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke device' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inventory/kiosk/devices',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'revoke_device', device_id: 'device-1' }),
        }),
      );
    });
  });
});
