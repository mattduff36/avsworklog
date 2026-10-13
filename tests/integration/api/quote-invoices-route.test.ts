import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockAppendQuoteTimelineEvent,
  mockCreateQuoteNotification,
  mockFetchQuoteBundle,
  mockGetQuoteInvoiceNotificationRecipientIds,
  mockCanManageQuoteSage,
  mockRenderConfiguredQuoteEmailTemplate,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockAppendQuoteTimelineEvent: vi.fn(),
  mockCreateQuoteNotification: vi.fn(),
  mockFetchQuoteBundle: vi.fn(),
  mockGetQuoteInvoiceNotificationRecipientIds: vi.fn(),
  mockCanManageQuoteSage: vi.fn(),
  mockRenderConfiguredQuoteEmailTemplate: vi.fn(),
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

vi.mock('@/lib/server/quote-sage-access', () => ({
  canManageQuoteSage: mockCanManageQuoteSage,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  appendQuoteTimelineEvent: mockAppendQuoteTimelineEvent,
  createQuoteNotification: mockCreateQuoteNotification,
  fetchQuoteBundle: mockFetchQuoteBundle,
  getQuoteInvoiceNotificationRecipientIds: mockGetQuoteInvoiceNotificationRecipientIds,
}));

vi.mock('@/lib/server/quote-email-templates', () => ({
  renderConfiguredQuoteEmailTemplate: mockRenderConfiguredQuoteEmailTemplate,
}));

describe('POST /api/quotes/[id]/invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({});
    mockGetQuoteInvoiceNotificationRecipientIds.mockResolvedValue([]);
    mockCanManageQuoteSage.mockResolvedValue(true);
    mockRenderConfiguredQuoteEmailTemplate.mockResolvedValue({
      subject: 'Invoice details added: Q-001',
      bodyText: 'Invoice details have been added.',
      bodyHtml: 'Invoice details have been added.',
    });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    });
  });

  it('returns field errors when invoice fields are missing', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoices/route');

    const request = new NextRequest('http://localhost/api/quotes/quote-1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        invoice_number: '',
        invoice_date: '',
        amount: 0,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Please correct the highlighted fields and try again.');
    expect(payload.field_errors).toEqual({
      invoice_number: 'Enter an invoice number.',
      amount: 'Enter an invoice amount greater than 0.',
    });
    expect(mockFetchQuoteBundle).not.toHaveBeenCalled();
  });

  it('keeps merged invoice amounts within the remaining balance', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoices/route');

    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'po_received',
        is_latest_version: true,
        quote_thread_id: 'thread-1',
      },
      mergeInfo: { survivor_quote_thread_id: 'thread-1', members: [{ quote_thread_id: 'thread-1' }] },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      timeline: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 100,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        invoice_number: 'INV-001',
        invoice_date: '2026-03-24',
        amount: 150,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invoice amount cannot be more than the adjusted quote-thread balance. Record a quote-value adjustment first if the amount has increased.');
    expect(payload.field_errors).toEqual({
      amount: 'This quote has £100.00 remaining.',
    });
  });

  it('records additional hire above the quoted total without revising the quote', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoices/route');
    const existingInvoice = { id: 'old-invoice', amount: 1450 };
    const extraInvoice = { id: 'extra-invoice', amount: 1220, invoice_number: '35304', invoice_date: '2026-09-30', comments: 'Additional hire', created_at: '2026-10-13T12:00:00Z' };
    const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: extraInvoice, error: null }) }) }));
    const update = vi.fn((_updates: Record<string, unknown>) => ({ eq: async () => ({ error: null }) }));
    const from = vi.fn((table: string) => {
      if (table === 'quote_invoices') return { insert };
      if (table === 'quotes') return { update };
      throw new Error(`Unexpected table ${table}`);
    });
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) }, from,
    });
    const quote = { id: 'quote-1', quote_thread_id: 'thread-1', quote_reference: '50085-LC', total: 1450, status: 'completed_full', is_latest_version: true, invoiced_at: '2026-09-01' };
    const initialBundle = {
      quote, invoices: [existingInvoice], invoiceRequests: [], versions: [quote], lineItems: [], attachments: [], timeline: [],
      invoiceSummary: { invoicedTotal: 1450, pendingRequestedTotal: 0, remainingBalance: 0, availableToRequest: 0, status: 'fully_invoiced' },
      financialSummary: { remaining_to_invoice: 0, available_to_request: 0 },
    };
    mockFetchQuoteBundle.mockResolvedValueOnce(initialBundle).mockResolvedValue({
      ...initialBundle, invoices: [existingInvoice, extraInvoice],
      invoiceSummary: { ...initialBundle.invoiceSummary, invoicedTotal: 2670, remainingBalance: -1220 },
      financialSummary: { remaining_to_invoice: -1220, available_to_request: 0 },
    });
    const response = await POST(new NextRequest('http://localhost/api/quotes/quote-1/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_number: '35304', invoice_date: '2026-09-30', amount: 1220, invoice_scope: 'partial', comments: 'Additional hire' }),
    }), { params: Promise.resolve({ id: 'quote-1' }) });
    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ quote_id: 'quote-1', amount: 1220, invoice_number: '35304' }));
    for (const call of update.mock.calls) {
      expect(call[0]).not.toHaveProperty('total');
      expect(call[0]).not.toHaveProperty('revision_number');
      expect(call[0]).not.toHaveProperty('status');
    }
    expect(mockAppendQuoteTimelineEvent).toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.invoices).toEqual([existingInvoice, extraInvoice]);
    expect(quote.total).toBe(1450);
  });

  it('rejects invoices against historical versions', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoices/route');

    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'completed_full',
        is_latest_version: false,
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      timeline: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 100,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        invoice_number: 'INV-002',
        invoice_date: '2026-03-24',
        amount: 50,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Only the latest quote version can be invoiced.');
  });

  it('requires confirmation before fulfilling a manager invoice request', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoices/route');

    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'completed_full',
        is_latest_version: true,
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      invoiceRequests: [{
        id: 'request-1',
        requested_amount: 50,
        requested_invoice_date: '2026-03-24',
        requested_invoice_scope: 'partial',
        status: 'pending',
      }],
      versions: [],
      timeline: [],
      invoiceSummary: {
        invoicedTotal: 0,
        pendingRequestedTotal: 50,
        remainingBalance: 100,
        availableToRequest: 50,
        lastInvoiceAt: null,
        status: 'ready_to_invoice',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        invoice_request_id: 'request-1',
        invoice_number: 'INV-003',
        invoice_date: '2026-03-24',
        amount: 50,
        invoice_scope: 'partial',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.field_errors).toEqual({
      confirm_matches_request: 'Confirm the invoice details match the manager request.',
    });
  });

  it('records actual invoices without overwriting the operational quote status', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoices/route');
    const quoteUpdate = vi.fn((_updates: Record<string, unknown>) => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quote_invoices') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'invoice-1',
                    invoice_number: 'INV-004',
                    invoice_date: '2026-03-24',
                    amount: 50,
                    comments: null,
                    created_at: '2026-03-24T09:00:00.000Z',
                  },
                  error: null,
                }),
              })),
            })),
          };
        }

        if (table === 'quotes') {
          return {
            update: quoteUpdate,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    });

    mockFetchQuoteBundle
      .mockResolvedValueOnce({
        quote: {
          id: 'quote-1',
          quote_thread_id: 'thread-1',
          quote_reference: '40000-GH',
          status: 'completed_full',
          is_latest_version: true,
          invoiced_at: null,
        },
        lineItems: [],
        attachments: [],
        invoices: [],
        invoiceRequests: [],
        versions: [],
        timeline: [],
        invoiceSummary: {
          invoicedTotal: 0,
          pendingRequestedTotal: 0,
          remainingBalance: 100,
          availableToRequest: 100,
          lastInvoiceAt: null,
          status: 'not_invoiced',
        },
      })
      .mockResolvedValueOnce({
        quote: {
          id: 'quote-1',
          quote_thread_id: 'thread-1',
          quote_reference: '40000-GH',
          status: 'completed_full',
          is_latest_version: true,
        },
        lineItems: [],
        attachments: [],
        invoices: [],
        invoiceRequests: [],
        versions: [],
        timeline: [],
        invoiceSummary: {
          invoicedTotal: 50,
          pendingRequestedTotal: 0,
          remainingBalance: 50,
          availableToRequest: 50,
          lastInvoiceAt: '2026-03-24',
          status: 'partially_invoiced',
        },
      })
      .mockResolvedValueOnce({
        invoices: [],
        invoiceRequests: [],
        invoiceSummary: {
          invoicedTotal: 50,
          pendingRequestedTotal: 0,
          remainingBalance: 50,
          availableToRequest: 50,
          lastInvoiceAt: '2026-03-24',
          status: 'partially_invoiced',
        },
        quote: {
          quote_thread_id: 'thread-1',
          quote_reference: '40000-GH',
          requester_id: 'manager-1',
        },
      });

    const request = new NextRequest('http://localhost/api/quotes/quote-1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        invoice_number: 'INV-004',
        invoice_date: '2026-03-24',
        amount: 50,
        invoice_scope: 'partial',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'quote-1' }) });

    expect(response.status).toBe(201);
    expect(quoteUpdate).toHaveBeenCalledOnce();
    expect(quoteUpdate.mock.calls[0][0]).not.toHaveProperty('status');
    expect(mockAppendQuoteTimelineEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      fromStatus: 'completed_full',
      toStatus: 'completed_full',
    }));
    expect(mockRenderConfiguredQuoteEmailTemplate).toHaveBeenCalledWith(expect.anything(), 'invoice_added', expect.objectContaining({
      quote_reference: '40000-GH',
      invoice_number: 'INV-004',
      invoice_amount: '£50.00',
    }));
    expect(mockCreateQuoteNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientIds: ['manager-1'],
      subject: 'Invoice details added: Q-001',
      body: 'Invoice details have been added.',
      sendEmail: true,
    }));
  });
});
