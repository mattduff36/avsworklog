import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/quotes/route';

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

function createQueryableResult<T>(rows: T[]) {
  const result = { data: rows, error: null };
  const query = {
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };

  return query;
}

function createPaginatedQuoteQuery(rows: Array<Record<string, unknown>>) {
  const query = createQueryableResult(rows);
  const range = vi.fn().mockReturnValue(query);
  const order = vi.fn().mockReturnValue({ range });

  return { query, order, range };
}

describe('GET /api/quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns global summary metrics alongside paginated quotes', async () => {
    const paginatedQuotes = [
      {
        id: 'quote-1',
        quote_reference: 'Q-001',
        total: 1200,
        status: 'draft',
        quote_date: '2026-03-24',
        base_quote_reference: 'Q-001',
        customer: { company_name: 'Acme Ltd' },
      },
      {
        id: 'quote-2',
        quote_reference: 'Q-002',
        total: 2500,
        status: 'in_progress',
        quote_date: '2026-03-23',
        base_quote_reference: 'Q-002',
        customer: { company_name: 'Bravo Ltd' },
      },
    ];
    const summaryRows = [
      { status: 'draft', total: 1200 },
      { status: 'in_progress', total: 2500 },
      { status: 'invoiced', total: 3000 },
      { status: 'lost', total: 900 },
    ];
    const { query: listQuery, order, range } = createPaginatedQuoteQuery(paginatedQuotes);
    const summaryQuery = createQueryableResult(summaryRows);
    const invoiceIn = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    });
    const selectQuotes = vi.fn((columns: string) => {
      if (columns.includes('customer:customers')) {
        return { order };
      }

      if (columns === 'status, total') {
        return summaryQuery;
      }

      throw new Error(`Unexpected select columns: ${columns}`);
    });
    const selectInvoices = vi.fn(() => ({
      in: invoiceIn,
    }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'quotes') {
          return { select: selectQuotes };
        }

        if (table === 'quote_invoices') {
          return { select: selectInvoices };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/quotes?limit=2&offset=0'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(0, 1);
    expect(listQuery.eq).toHaveBeenCalledWith('is_latest_version', true);
    expect(summaryQuery.eq).toHaveBeenCalledWith('is_latest_version', true);
    expect(invoiceIn).toHaveBeenCalledWith('quote_id', ['quote-1', 'quote-2']);
    expect(payload.summary).toEqual({
      total_quotes: 4,
      status_counts: expect.objectContaining({
        all: 4,
        draft: 1,
        in_progress: 1,
        invoiced: 1,
        lost: 1,
      }),
      won_quotes: 2,
      won_value: 5500,
    });
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 2,
      has_more: true,
    });
  });
});
