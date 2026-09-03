import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCanEffectiveRoleAccessModule,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCanEffectiveRoleAccessModule: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanEffectiveRoleAccessModule,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

interface QuoteRow {
  id: string;
  quote_thread_id: string;
  base_quote_reference: string | null;
  quote_reference: string | null;
  subject_line: string | null;
  project_description: string | null;
  site_address: string | null;
  status: string;
  commercial_status: string;
  revision_number: number;
  created_at: string;
  is_latest_version: boolean;
  customer: { status: string | null; company_name: string | null };
}

function createQuoteQuery(allRows: QuoteRow[]) {
  const eqCalls: Array<[string, unknown]> = [];
  const inCalls: Array<[string, unknown[]]> = [];
  const create = () => {
    const eqs: Record<string, unknown> = {};
    const ins: Record<string, unknown[]> = {};
    const query = {
      eq(column: string, value: unknown) {
        eqs[column] = value;
        eqCalls.push([column, value]);
        return query;
      },
      in(column: string, values: unknown[]) {
        ins[column] = values;
        inCalls.push([column, values]);
        return query;
      },
      order() {
        return {
          async range(from: number, to: number) {
            const rows = allRows.filter((row) => {
              for (const [column, value] of Object.entries(eqs)) {
                if (column === 'customer.status') {
                  if (row.customer.status !== value) return false;
                  continue;
                }
                if ((row as Record<string, unknown>)[column] !== value) return false;
              }
              for (const [column, values] of Object.entries(ins)) {
                if (!values.includes((row as Record<string, unknown>)[column] as never)) return false;
              }
              return true;
            });
            return { data: rows.slice(from, to + 1), error: null };
          },
        };
      },
    };
    return query;
  };
  return {
    get query() {
      return create();
    },
    eqCalls,
    inCalls,
  };
}

describe('timesheet job-codes draft revision fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    });
    mockCanEffectiveRoleAccessModule.mockResolvedValue(true);
  });

  it('TS-JOB-001 / FD-VERIFY-002 returns the fallback job code from GET /api/timesheets/job-codes', async () => {
    const quoteQuery = createQuoteQuery([
      {
        id: 'quote-40118-original',
        quote_thread_id: 'thread-40118',
        base_quote_reference: '40118-GH',
        quote_reference: '40118-GH',
        subject_line: 'Original PO received',
        project_description: null,
        site_address: '12 High Street, Southwell',
        status: 'po_received',
        commercial_status: 'open',
        is_latest_version: false,
        revision_number: 0,
        created_at: '2026-01-01T10:00:00.000Z',
        customer: { status: 'active', company_name: 'Omexom' },
      },
      {
        id: 'quote-40118-draft',
        quote_thread_id: 'thread-40118',
        base_quote_reference: '40118-GH',
        quote_reference: '40118-GH-REV1',
        subject_line: 'Draft revision',
        project_description: null,
        site_address: '12 High Street, Southwell',
        status: 'draft',
        commercial_status: 'open',
        is_latest_version: true,
        revision_number: 1,
        created_at: '2026-03-01T10:00:00.000Z',
        customer: { status: 'active', company_name: 'Omexom' },
      },
    ]);
    const emptyRange = {
      not: () => emptyRange,
      in: () => emptyRange,
      order: () => ({
        range: async () => ({ data: [], error: null }),
      }),
    };
    const from = vi.fn((table: string) => {
      if (table === 'quote_reference_aliases') {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      return {
        select: () => {
          if (table === 'quotes') return quoteQuery.query;
          return emptyRange;
        },
      };
    });
    mockCreateAdminClient.mockReturnValue({ from });

    const { GET } = await import('@/app/api/timesheets/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/timesheets/job-codes?q=40118'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.job_codes).toEqual([
      {
        value: '40118-GH',
        label: '40118-GH',
        customerName: 'Omexom',
        quoteTitle: 'Original PO received',
        source: 'live_quote',
      },
    ]);
    expect(quoteQuery.eqCalls).toContainEqual(['is_latest_version', true]);
    expect(quoteQuery.eqCalls).toContainEqual(['is_latest_version', false]);
    expect(quoteQuery.inCalls).toContainEqual(['quote_thread_id', ['thread-40118']]);
  });
});
