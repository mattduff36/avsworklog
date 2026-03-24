import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFetchQuoteBundle,
  mockSendQuoteToCustomerEmail,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFetchQuoteBundle: vi.fn(),
  mockSendQuoteToCustomerEmail: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/quote-workflow', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/quote-workflow')>('@/lib/server/quote-workflow');
  return {
    ...actual,
    fetchQuoteBundle: mockFetchQuoteBundle,
    sendQuoteToCustomerEmail: mockSendQuoteToCustomerEmail,
  };
});

describe('PATCH /api/quotes/[id]', () => {
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
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    });
  });

  it('returns a validation error when approve_and_send has no customer email', async () => {
    const { PATCH } = await import('@/app/api/quotes/[id]/route');
    mockFetchQuoteBundle.mockResolvedValue({
      quote: {
        id: 'quote-1',
        quote_reference: 'Q-001',
        subject_line: 'Fence repairs',
        manager_email: 'manager@avsquires.co.uk',
        attention_email: null,
        customer: {
          id: 'customer-1',
          company_name: 'Acme Ltd',
          contact_email: null,
          contact_name: 'Alex',
          short_name: 'Acme',
        },
      },
      lineItems: [],
      attachments: [],
      invoices: [],
      versions: [],
      invoiceSummary: {
        invoicedTotal: 0,
        remainingBalance: 0,
        lastInvoiceAt: null,
        status: 'not_invoiced',
      },
    });

    const request = new NextRequest('http://localhost/api/quotes/quote-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'approve_and_send' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quote-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Quote cannot be sent because the customer does not have a contact email.');
    expect(mockSendQuoteToCustomerEmail).not.toHaveBeenCalled();
  });
});
