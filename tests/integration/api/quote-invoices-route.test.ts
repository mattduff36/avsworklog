import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockAppendQuoteTimelineEvent,
  mockFetchQuoteBundle,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockAppendQuoteTimelineEvent: vi.fn(),
  mockFetchQuoteBundle: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  appendQuoteTimelineEvent: mockAppendQuoteTimelineEvent,
  fetchQuoteBundle: mockFetchQuoteBundle,
}));

describe('POST /api/quotes/[id]/invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({});
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

  it('rejects invoice amounts above the remaining balance', async () => {
    const { POST } = await import('@/app/api/quotes/[id]/invoices/route');

    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        status: 'po_received',
        is_latest_version: true,
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
        invoice_number: 'INV-001',
        invoice_date: '2026-03-24',
        amount: 150,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invoice amount cannot be more than the remaining balance. Create a new version first if the amount has increased.');
    expect(payload.field_errors).toEqual({
      amount: 'This quote has £100.00 remaining.',
    });
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
});
