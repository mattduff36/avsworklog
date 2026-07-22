import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireInventoryManagerAccess,
  getInventoryKioskControlState,
  takeInventoryKioskControl,
  renewInventoryKioskControl,
  releaseInventoryKioskControl,
  issueInventoryKioskControlAction,
} = vi.hoisted(() => ({
  requireInventoryManagerAccess: vi.fn(),
  getInventoryKioskControlState: vi.fn(),
  takeInventoryKioskControl: vi.fn(),
  renewInventoryKioskControl: vi.fn(),
  releaseInventoryKioskControl: vi.fn(),
  issueInventoryKioskControlAction: vi.fn(),
}));

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryManagerAccess,
}));

vi.mock('@/lib/server/inventory-kiosk-remote', () => ({
  getInventoryKioskControlState,
  takeInventoryKioskControl,
  renewInventoryKioskControl,
  releaseInventoryKioskControl,
  issueInventoryKioskControlAction,
}));

import {
  GET as getControl,
  POST as updateControl,
} from '@/app/api/inventory/kiosk/control/route';

function controlRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/inventory/kiosk/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Inventory kiosk control route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireInventoryManagerAccess.mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    getInventoryKioskControlState.mockResolvedValue({ device: null });
    takeInventoryKioskControl.mockResolvedValue({ is_active: true });
    renewInventoryKioskControl.mockResolvedValue({ is_active: true });
    releaseInventoryKioskControl.mockResolvedValue(undefined);
    issueInventoryKioskControlAction.mockResolvedValue({ id: 'command-1' });
  });

  it('keeps the replica manager-only', async () => {
    requireInventoryManagerAccess.mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });

    const response = await getControl();

    expect(response.status).toBe(403);
    expect(getInventoryKioskControlState).not.toHaveBeenCalled();
  });

  it('acquires and renews only the caller control session', async () => {
    const values = {
      device_id: '11111111-1111-4111-8111-111111111111',
      control_session_id: '22222222-2222-4222-8222-222222222222',
    };

    expect((await updateControl(controlRequest({
      operation: 'take',
      ...values,
    }))).status).toBe(200);
    expect(takeInventoryKioskControl).toHaveBeenCalledWith({
      managerUserId: 'manager-1',
      deviceId: values.device_id,
      controlSessionId: values.control_session_id,
    });

    expect((await updateControl(controlRequest({
      operation: 'renew',
      ...values,
    }))).status).toBe(200);
    expect(renewInventoryKioskControl).toHaveBeenCalledWith({
      managerUserId: 'manager-1',
      deviceId: values.device_id,
      controlSessionId: values.control_session_id,
    });
  });

  it('transports control actions without submitting inventory in the manager route', async () => {
    const response = await updateControl(controlRequest({
      operation: 'action',
      device_id: '11111111-1111-4111-8111-111111111111',
      control_session_id: '22222222-2222-4222-8222-222222222222',
      control_action: { type: 'forward' },
      idempotency_key: 'action-1',
    }));

    expect(response.status).toBe(200);
    expect(issueInventoryKioskControlAction).toHaveBeenCalledWith({
      managerUserId: 'manager-1',
      deviceId: '11111111-1111-4111-8111-111111111111',
      controlSessionId: '22222222-2222-4222-8222-222222222222',
      action: { type: 'forward' },
      idempotencyKey: 'action-1',
    });
  });
});
