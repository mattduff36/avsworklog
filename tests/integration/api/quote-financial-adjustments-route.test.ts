import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockRequireSensitiveModuleAccess,
  mockCanManageQuoteSage,
  mockCreateFinancialAdjustment,
  mockReverseFinancialAdjustment,
  mockFetchWorkspace,
  mockSearch,
  mockAppendTimeline,
  mockCreateNotification,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockRequireSensitiveModuleAccess: vi.fn(),
  mockCanManageQuoteSage: vi.fn(),
  mockCreateFinancialAdjustment: vi.fn(),
  mockReverseFinancialAdjustment: vi.fn(),
  mockFetchWorkspace: vi.fn(),
  mockSearch: vi.fn(),
  mockAppendTimeline: vi.fn(),
  mockCreateNotification: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: mockRequireSensitiveModuleAccess,
}));

vi.mock('@/lib/server/quote-sage-access', () => ({
  canManageQuoteSage: mockCanManageQuoteSage,
}));

vi.mock('@/lib/server/quote-financial-adjustments', () => ({
  createFinancialAdjustment: mockCreateFinancialAdjustment,
  reverseFinancialAdjustment: mockReverseFinancialAdjustment,
  fetchQuoteFinancialWorkspace: mockFetchWorkspace,
  searchQuoteFinancialRecords: mockSearch,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  appendQuoteTimelineEvent: mockAppendTimeline,
  createQuoteNotification: mockCreateNotification,
}));

function workspace() {
  return {
    quote_thread_id: 'thread-1',
    quote: {
      id: 'quote-1',
      quote_reference: '10001-MS',
      requester_id: 'manager-1',
      status: 'completed_full',
    },
    versions: [],
    adjustments: [],
    thread_summary: {
      adjusted_quote_value: 1_000,
      net_invoiced: 900,
      remaining_to_invoice: 100,
    },
  };
}

function mutationResult() {
  return {
    adjustment: {
      id: 'adjustment-1',
      adjustment_number: 'ADJ-2026-000001',
      quote_id: 'quote-1',
      quote_thread_id: 'thread-1',
      adjustment_type: 'credit_note',
      amount: 100,
      reason: 'Sage credit',
      created_at: '2026-07-17T09:00:00.000Z',
    },
    workspace: workspace(),
    cancelledRequests: [],
    statusFrom: 'completed_full',
    statusTo: 'completed_full',
  };
}

describe('/api/quotes/financial-adjustments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'accounts-1' } },
          error: null,
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({});
    mockRequireSensitiveModuleAccess.mockResolvedValue(null);
    mockCanManageQuoteSage.mockResolvedValue(true);
    mockFetchWorkspace.mockResolvedValue(workspace());
    mockSearch.mockResolvedValue([{ id: 'quote-1', quote_reference: '10001-MS' }]);
    mockCreateFinancialAdjustment.mockResolvedValue(mutationResult());
    mockReverseFinancialAdjustment.mockResolvedValue({
      ...mutationResult(),
      adjustment: {
        ...mutationResult().adjustment,
        adjustment_type: 'reversal',
      },
    });
    mockAppendTimeline.mockResolvedValue(undefined);
    mockCreateNotification.mockResolvedValue(undefined);
  });

  it('requires authentication', async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('unauthorized'),
        }),
      },
    });
    const { GET } = await import('@/app/api/quotes/financial-adjustments/route');

    const response = await GET(
      new NextRequest('http://localhost/api/quotes/financial-adjustments?q=test'),
    );

    expect(response.status).toBe(401);
  });

  it('returns a read-only workspace to an authorized quote user', async () => {
    mockCanManageQuoteSage.mockResolvedValue(false);
    const { GET } = await import('@/app/api/quotes/financial-adjustments/route');

    const response = await GET(
      new NextRequest(
        'http://localhost/api/quotes/financial-adjustments?quote_id=quote-1',
      ),
    );

    expect(response.status).toBe(200);
    expect(mockFetchWorkspace).toHaveBeenCalledWith('quote-1', false);
  });

  it('rejects financial ledger searches shorter than three trimmed characters', async () => {
    const { GET } = await import('@/app/api/quotes/financial-adjustments/route');

    const response = await GET(
      new NextRequest(
        'http://localhost/api/quotes/financial-adjustments?q=%20ab%20',
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('at least 3 characters');
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('returns every financial ledger search result without a 20-result cap', async () => {
    mockSearch.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        id: `quote-${index + 1}`,
        quote_reference: `100${String(index + 1).padStart(2, '0')}-MS`,
      })),
    );
    const { GET } = await import('@/app/api/quotes/financial-adjustments/route');

    const response = await GET(
      new NextRequest(
        'http://localhost/api/quotes/financial-adjustments?q=sage',
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith('sage');
    expect(payload.results).toHaveLength(25);
  });

  it('blocks writes outside Accounts and admin roles', async () => {
    mockCanManageQuoteSage.mockResolvedValue(false);
    const { POST } = await import('@/app/api/quotes/financial-adjustments/route');

    const response = await POST(
      new NextRequest('http://localhost/api/quotes/financial-adjustments', {
        method: 'POST',
        body: JSON.stringify({ action: 'create' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mockCreateFinancialAdjustment).not.toHaveBeenCalled();
  });

  it('records an adjustment, timeline event, and manager notification', async () => {
    const { POST } = await import('@/app/api/quotes/financial-adjustments/route');
    const body = {
      action: 'create',
      quote_id: 'quote-1',
      invoice_id: 'invoice-1',
      adjustment_type: 'credit_note',
      amount: 100,
      effective_date: '2026-07-17',
      reason: 'Sage credit',
    };

    const response = await POST(
      new NextRequest('http://localhost/api/quotes/financial-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockCreateFinancialAdjustment).toHaveBeenCalledWith(body, 'accounts-1');
    expect(mockAppendTimeline).toHaveBeenCalled();
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['manager-1'],
        sendEmail: true,
      }),
    );
  });

  it('returns a conflict when explicit variance confirmation is required', async () => {
    mockCreateFinancialAdjustment.mockRejectedValue(
      Object.assign(new Error('Confirm the variance.'), {
        code: 'VARIANCE_CONFIRMATION_REQUIRED',
        financial_summary: { has_variance: true },
      }),
    );
    const { POST } = await import('@/app/api/quotes/financial-adjustments/route');

    const response = await POST(
      new NextRequest('http://localhost/api/quotes/financial-adjustments', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          quote_id: 'quote-1',
          adjustment_type: 'write_off',
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        code: 'VARIANCE_CONFIRMATION_REQUIRED',
      }),
    );
  });

  it('returns the sensitive access response before reading data', async () => {
    mockRequireSensitiveModuleAccess.mockResolvedValue(
      NextResponse.json({ code: 'SENSITIVE_PIN_REQUIRED' }, { status: 428 }),
    );
    const { GET } = await import('@/app/api/quotes/financial-adjustments/route');

    const response = await GET(
      new NextRequest('http://localhost/api/quotes/financial-adjustments'),
    );

    expect(response.status).toBe(428);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
