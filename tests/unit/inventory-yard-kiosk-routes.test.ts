import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-kiosk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/inventory-kiosk')>();
  return {
    ...actual,
    requireInventoryKioskAccess: vi.fn(),
    getYardKioskBootstrap: vi.fn(),
    getYardKioskStock: vi.fn(),
    submitYardKioskBasket: vi.fn(),
  };
});

import { GET as getBootstrap } from '@/app/api/inventory/kiosk/bootstrap/route';
import { GET as getStock } from '@/app/api/inventory/kiosk/stock/route';
import { POST as submitBasket } from '@/app/api/inventory/kiosk/submit/route';
import {
  getYardKioskBootstrap,
  getYardKioskStock,
  requireInventoryKioskAccess,
  submitYardKioskBasket,
} from '@/lib/server/inventory-kiosk';

const allowedAccess = {
  allowed: true as const,
  status: 200 as const,
  userId: '11111111-1111-4111-8111-111111111111',
  yard: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Yard',
    description: null,
    location_type: 'yard' as const,
    external_reference: null,
    is_active: true,
  },
};

describe('Inventory Yard kiosk routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['unconfigured', 503, 'The Yard kiosk has not been configured'],
    ['different account', 403, 'This account is not authorised for the Yard kiosk'],
  ])('fails closed for an %s kiosk', async (_label, status, error) => {
    vi.mocked(requireInventoryKioskAccess).mockResolvedValue({
      allowed: false,
      status: status as 403 | 503,
      error,
    });

    const response = await getBootstrap();

    expect(response.status).toBe(status);
    expect(getYardKioskBootstrap).not.toHaveBeenCalled();
  });

  it('derives stock scope through the authorised kiosk context', async () => {
    vi.mocked(requireInventoryKioskAccess).mockResolvedValue(allowedAccess);
    vi.mocked(getYardKioskStock).mockResolvedValue({
      source_location_id: allowedAccess.yard.id,
      items: [],
    });
    const request = new NextRequest(
      'http://localhost/api/inventory/kiosk/stock?direction=take&counterpart_location_id=33333333-3333-4333-8333-333333333333',
    );

    const response = await getStock(request);

    expect(response.status).toBe(200);
    expect(getYardKioskStock).toHaveBeenCalledWith(
      allowedAccess,
      'take',
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it('submits the browser basket only through the atomic kiosk service', async () => {
    vi.mocked(requireInventoryKioskAccess).mockResolvedValue(allowedAccess);
    vi.mocked(submitYardKioskBasket).mockResolvedValue({
      kiosk_batch_id: '44444444-4444-4444-8444-444444444444',
      movement_batch_id: null,
      hardware_batch_id: '55555555-5555-4555-8555-555555555555',
      serialized_count: 0,
      hardware_line_count: 1,
    });
    const body = {
      direction: 'take',
      counterpart_location_id: '33333333-3333-4333-8333-333333333333',
      serialized_item_ids: [],
      hardware_lines: [{
        item_id: '66666666-6666-4666-8666-666666666666',
        quantity: 3,
      }],
    };
    const request = new NextRequest('http://localhost/api/inventory/kiosk/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const response = await submitBasket(request);

    expect(response.status).toBe(200);
    expect(submitYardKioskBasket).toHaveBeenCalledWith(allowedAccess, body);
  });
});
