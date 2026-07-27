import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFetchQuoteBundle,
  mockCanManageQuoteSage,
  mockIsEffectiveRoleManagerOrHigher,
  mockCreatePurchaseOrder,
  mockUpdatePurchaseOrder,
  mockDeletePurchaseOrder,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFetchQuoteBundle: vi.fn(),
  mockCanManageQuoteSage: vi.fn(),
  mockIsEffectiveRoleManagerOrHigher: vi.fn(),
  mockCreatePurchaseOrder: vi.fn(),
  mockUpdatePurchaseOrder: vi.fn(),
  mockDeletePurchaseOrder: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/utils/rbac', () => ({
  isEffectiveRoleManagerOrHigher: mockIsEffectiveRoleManagerOrHigher,
}));

vi.mock('@/lib/server/quote-sage-access', () => ({
  canManageQuoteSage: mockCanManageQuoteSage,
}));

vi.mock('@/lib/server/quote-purchase-orders', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/quote-purchase-orders')>(
    '@/lib/server/quote-purchase-orders'
  );
  return {
    ...actual,
    createQuotePurchaseOrderTransaction: mockCreatePurchaseOrder,
    updateQuotePurchaseOrderTransaction: mockUpdatePurchaseOrder,
    deleteQuotePurchaseOrderTransaction: mockDeletePurchaseOrder,
  };
});

vi.mock('@/lib/server/quote-workflow', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/quote-workflow')>(
    '@/lib/server/quote-workflow'
  );
  return {
    ...actual,
    fetchQuoteBundle: mockFetchQuoteBundle,
  };
});

import { POST } from '@/app/api/quotes/[id]/purchase-orders/route';
import {
  DELETE,
  PATCH,
} from '@/app/api/quotes/[id]/purchase-orders/[poId]/route';

const lineItem = {
  id: '44444444-4444-4444-4444-444444444444',
  description: 'Handrail',
  line_total: 1200,
  sort_order: 0,
};

const purchaseOrder = {
  id: '55555555-5555-5555-5555-555555555555',
  quote_thread_id: '22222222-2222-2222-2222-222222222222',
  quote_id: '11111111-1111-1111-1111-111111111111',
  po_number: 'PO-001',
  po_value: 1200,
  received_at: '2026-07-27T12:00:00.000Z',
  notes: null,
  created_by: '33333333-3333-3333-3333-333333333333',
  created_at: '2026-07-27T12:00:00.000Z',
  updated_at: '2026-07-27T12:00:00.000Z',
  lines: [{
    id: '66666666-6666-6666-6666-666666666666',
    quote_purchase_order_id: '55555555-5555-5555-5555-555555555555',
    quote_line_item_id: lineItem.id,
    created_at: '2026-07-27T12:00:00.000Z',
    description: lineItem.description,
    line_total: lineItem.line_total,
    sort_order: 0,
  }],
};

function buildBundle(options: {
  status?: 'draft' | 'sent';
  purchaseOrders?: typeof purchaseOrder[];
} = {}) {
  const purchaseOrders = options.purchaseOrders || [];
  return {
    quote: {
      id: '11111111-1111-1111-1111-111111111111',
      quote_thread_id: '22222222-2222-2222-2222-222222222222',
      quote_reference: 'Q-001',
      status: options.status || 'sent',
      is_latest_version: true,
      total: 1200,
    },
    lineItems: [lineItem],
    attachments: [{ id: 'attachment-1' }],
    ramsDocuments: [{ id: 'rams-1' }],
    invoices: [{ id: 'invoice-1', allocations: [] }],
    invoiceRequests: [{ id: 'request-1' }],
    purchaseOrders,
    poCoverage: {
      quoteTotal: 1200,
      poTotal: purchaseOrders.reduce((sum, order) => sum + Number(order.po_value || 0), 0),
      remaining: purchaseOrders.length > 0 ? 0 : 1200,
      coveredLineCount: purchaseOrders.length > 0 ? 1 : 0,
      totalLineCount: 1,
      purchaseOrderCount: purchaseOrders.length,
    },
    versions: [{ id: 'version-1' }],
    timeline: [{ id: 'timeline-1' }],
    selectedSecondaryContacts: [],
    invoiceSummary: {
      invoicedTotal: 0,
      pendingRequestedTotal: 0,
      remainingBalance: 1200,
      availableToRequest: 1200,
      lastInvoiceAt: null,
      status: 'not_invoiced',
    },
    financialAdjustments: [],
    financialSummary: null,
  };
}

describe('quote purchase-order routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: '33333333-3333-3333-3333-333333333333' } },
          error: null,
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'quote_line_items') {
          throw new Error(`Unexpected table ${table}`);
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [{ id: lineItem.id }],
                error: null,
              }),
            })),
          })),
        };
      }),
    });
    mockCanManageQuoteSage.mockResolvedValue(false);
    mockIsEffectiveRoleManagerOrHigher.mockResolvedValue(true);
    mockCreatePurchaseOrder.mockResolvedValue(purchaseOrder.id);
    mockUpdatePurchaseOrder.mockResolvedValue(undefined);
    mockDeletePurchaseOrder.mockResolvedValue(undefined);
  });

  it('creates a PO atomically and returns the complete quote bundle', async () => {
    mockFetchQuoteBundle
      .mockResolvedValueOnce(buildBundle())
      .mockResolvedValueOnce(buildBundle({ purchaseOrders: [purchaseOrder] }));

    const request = new NextRequest('http://localhost/api/quotes/quote-1/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        po_number: 'PO-001',
        po_value: 1200,
        line_item_ids: [lineItem.id],
      }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreatePurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({
      poNumber: 'PO-001',
      poValue: 1200,
      lineItemIds: [lineItem.id],
    }));
    expect(payload.quote).toEqual(expect.objectContaining({
      can_manage_purchase_orders: true,
      line_items: [lineItem],
      attachments: [{ id: 'attachment-1' }],
      rams_documents: [{ id: 'rams-1' }],
      invoices: [{ id: 'invoice-1', allocations: [] }],
      invoice_requests: [{ id: 'request-1' }],
      versions: [{ id: 'version-1' }],
      timeline: [{ id: 'timeline-1' }],
      purchase_orders: [purchaseOrder],
    }));
  });

  it('rejects PO creation for non-manager users', async () => {
    mockIsEffectiveRoleManagerOrHigher.mockResolvedValue(false);
    const request = new NextRequest('http://localhost/api/quotes/quote-1/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ po_number: 'PO-001' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(403);
    expect(mockFetchQuoteBundle).not.toHaveBeenCalled();
    expect(mockCreatePurchaseOrder).not.toHaveBeenCalled();
  });

  it('enforces the editable quote statuses on the server', async () => {
    mockFetchQuoteBundle.mockResolvedValue(buildBundle({ status: 'draft' }));
    const request = new NextRequest('http://localhost/api/quotes/quote-1/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ po_number: 'PO-001' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(400);
    expect(mockCreatePurchaseOrder).not.toHaveBeenCalled();
  });

  it('supports partial PATCH requests without erasing existing PO fields', async () => {
    mockFetchQuoteBundle
      .mockResolvedValueOnce(buildBundle({ purchaseOrders: [purchaseOrder] }))
      .mockResolvedValueOnce(buildBundle({ purchaseOrders: [purchaseOrder] }));
    const request = new NextRequest('http://localhost/api/quotes/quote-1/purchase-orders/po-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_item_ids: [] }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({
        id: '11111111-1111-1111-1111-111111111111',
        poId: purchaseOrder.id,
      }),
    });

    expect(response.status).toBe(200);
    expect(mockUpdatePurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({
      purchaseOrderId: purchaseOrder.id,
      poNumber: 'PO-001',
      poValue: 1200,
      lineItemIds: [],
    }));
  });

  it('deletes a PO through the atomic mutation helper', async () => {
    mockFetchQuoteBundle
      .mockResolvedValueOnce(buildBundle({ purchaseOrders: [purchaseOrder] }))
      .mockResolvedValueOnce(buildBundle());
    const request = new NextRequest('http://localhost/api/quotes/quote-1/purchase-orders/po-1', {
      method: 'DELETE',
    });

    const response = await DELETE(request, {
      params: Promise.resolve({
        id: '11111111-1111-1111-1111-111111111111',
        poId: purchaseOrder.id,
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockDeletePurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({
      purchaseOrderId: purchaseOrder.id,
    }));
    expect(payload.quote.purchase_orders).toEqual([]);
    expect(payload.quote.line_items).toEqual([lineItem]);
  });

  it('does not expose internal transaction errors', async () => {
    mockFetchQuoteBundle.mockResolvedValue(buildBundle());
    mockCreatePurchaseOrder.mockRejectedValue(new Error('secret database detail'));
    const request = new NextRequest('http://localhost/api/quotes/quote-1/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ po_number: 'PO-001' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Unable to save this purchase order right now.');
    expect(payload.error).not.toContain('secret database detail');
  });
});
