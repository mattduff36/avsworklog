import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireInventoryManagerAccess,
  getInventoryKioskDeviceAdminState,
  startInventoryKioskPairing,
  cancelInventoryKioskPairing,
  confirmInventoryKioskPairing,
  revokeInventoryKioskDevice,
} = vi.hoisted(() => ({
  requireInventoryManagerAccess: vi.fn(),
  getInventoryKioskDeviceAdminState: vi.fn(),
  startInventoryKioskPairing: vi.fn(),
  cancelInventoryKioskPairing: vi.fn(),
  confirmInventoryKioskPairing: vi.fn(),
  revokeInventoryKioskDevice: vi.fn(),
}));

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryManagerAccess,
}));

vi.mock('@/lib/server/inventory-kiosk-devices', () => ({
  InventoryKioskDeviceError: class InventoryKioskDeviceError extends Error {
    status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
  getInventoryKioskDeviceAdminState,
  startInventoryKioskPairing,
  cancelInventoryKioskPairing,
  confirmInventoryKioskPairing,
  revokeInventoryKioskDevice,
}));

import {
  GET as getDevices,
  POST as updateDevices,
} from '@/app/api/inventory/kiosk/devices/route';

const emptyState = {
  active_pairing: null,
  devices: [],
};

function actionRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/inventory/kiosk/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Inventory kiosk device management route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireInventoryManagerAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    getInventoryKioskDeviceAdminState.mockResolvedValue(emptyState);
    startInventoryKioskPairing.mockResolvedValue(emptyState);
  });

  it('requires Inventory manager access', async () => {
    requireInventoryManagerAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });

    const response = await getDevices();

    expect(response.status).toBe(403);
    expect(getInventoryKioskDeviceAdminState).not.toHaveBeenCalled();
  });

  it('starts a labelled pairing window', async () => {
    const response = await updateDevices(actionRequest({
      action: 'start_pairing',
      device_label: 'Yard Tablet 1',
    }));

    expect(response.status).toBe(200);
    expect(startInventoryKioskPairing).toHaveBeenCalledWith(
      'manager-1',
      'Yard Tablet 1',
    );
  });

  it('confirms only the selected pairing and code', async () => {
    const response = await updateDevices(actionRequest({
      action: 'confirm_pairing',
      pairing_id: 'pairing-1',
      confirmation_code: '123456',
    }));

    expect(response.status).toBe(200);
    expect(confirmInventoryKioskPairing).toHaveBeenCalledWith(
      'manager-1',
      'pairing-1',
      '123456',
    );
  });

  it('revokes the selected trusted browser', async () => {
    const response = await updateDevices(actionRequest({
      action: 'revoke_device',
      device_id: 'device-1',
    }));

    expect(response.status).toBe(200);
    expect(revokeInventoryKioskDevice).toHaveBeenCalledWith(
      'manager-1',
      'device-1',
    );
  });
});
