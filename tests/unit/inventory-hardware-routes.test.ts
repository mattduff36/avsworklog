import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryAccess: vi.fn(),
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/inventory-hardware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/inventory-hardware')>();
  return {
    ...actual,
    getResponsibleHardwareLocationIds: vi.fn(),
  };
});

import { POST as adjustHardware } from '@/app/api/inventory/hardware/adjustments/route';
import { POST as transferHardware } from '@/app/api/inventory/hardware/transfers/route';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getResponsibleHardwareLocationIds } from '@/lib/server/inventory-hardware';

function buildRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Inventory Hardware mutation routes', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: 'batch-1', error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  });

  it('requires manager access for stock adjustments', async () => {
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });

    const response = await adjustHardware(buildRequest('/api/inventory/hardware/adjustments', {
      operation_type: 'add',
      reason: 'Delivery',
      lines: [{ item_id: 'item-1', location_id: 'location-1', quantity: 2 }],
    }));

    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('applies a positive whole-number delivery through the audited adjustment RPC', async () => {
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });

    const response = await adjustHardware(buildRequest('/api/inventory/hardware/adjustments', {
      operation_type: 'add',
      reason: 'Delivery',
      note: 'Incoming order 123',
      lines: [{ item_id: 'item-1', location_id: 'location-1', quantity: 12 }],
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('inventory_apply_hardware_adjustments', {
      p_operation_type: 'add',
      p_reason: 'Delivery',
      p_note: 'Incoming order 123',
      p_lines: [{ item_id: 'item-1', location_id: 'location-1', quantity: 12 }],
      p_actor: 'manager-1',
    });
  });

  it.each([0, 1.5])('rejects invalid add quantity %s before mutation', async (quantity) => {
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });

    const response = await adjustHardware(buildRequest('/api/inventory/hardware/adjustments', {
      operation_type: 'add',
      reason: 'Delivery',
      lines: [{ item_id: 'item-1', location_id: 'location-1', quantity }],
    }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires a note for Other adjustments', async () => {
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });

    const response = await adjustHardware(buildRequest('/api/inventory/hardware/adjustments', {
      operation_type: 'remove',
      reason: 'Other',
      lines: [{ item_id: 'item-1', location_id: 'location-1', quantity: 1 }],
    }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('allows an atomic zero-value recount for managers', async () => {
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });

    const response = await adjustHardware(buildRequest('/api/inventory/hardware/adjustments', {
      operation_type: 'recount',
      reason: 'Stocktake correction',
      lines: [{ item_id: 'item-1', location_id: 'location-1', quantity: 0 }],
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('inventory_apply_hardware_adjustments', expect.objectContaining({
      p_operation_type: 'recount',
      p_actor: 'manager-1',
    }));
  });

  it('blocks employee transfers outside responsible locations', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'employee-1',
      isManagerOrAdmin: false,
    });
    vi.mocked(getResponsibleHardwareLocationIds).mockResolvedValue(['primary-location', 'site-location']);

    const response = await transferHardware(buildRequest('/api/inventory/hardware/transfers', {
      lines: [{
        item_id: 'item-1',
        from_location_id: 'other-location',
        to_location_id: 'primary-location',
        quantity: 1,
      }],
    }));

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('allows employee transfers between responsible locations', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'employee-1',
      isManagerOrAdmin: false,
    });
    vi.mocked(getResponsibleHardwareLocationIds).mockResolvedValue(['primary-location', 'site-location']);

    const response = await transferHardware(buildRequest('/api/inventory/hardware/transfers', {
      lines: [{
        item_id: 'item-1',
        from_location_id: 'primary-location',
        to_location_id: 'site-location',
        quantity: 4,
      }],
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('inventory_transfer_hardware_stock', expect.objectContaining({
      p_actor: 'employee-1',
    }));
  });
});
