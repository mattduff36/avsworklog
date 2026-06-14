import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCanEffectiveRoleAccessModule,
  mockLogServerError,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCanEffectiveRoleAccessModule: vi.fn(),
  mockLogServerError: vi.fn(),
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
  logServerError: mockLogServerError,
}));

interface QuoteJobCodeTestRow {
  base_quote_reference: string | null;
  quote_reference: string | null;
  subject_line: string | null;
  project_description: string | null;
  site_address: string | null;
  customer: {
    status: string | null;
    company_name: string | null;
  } | null;
}

interface LegacyQuoteJobCodeTestRow {
  quote_reference: string | null;
  customer_name: string | null;
  title: string | null;
}

function createQuoteQuery(rows: QuoteJobCodeTestRow[]) {
  const result = { data: rows, error: null };
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ limit });
  const query = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order,
  };

  return { query, order, limit };
}

function createLegacyQuoteQuery(rows: LegacyQuoteJobCodeTestRow[]) {
  const result = { data: rows, error: null };
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ limit });
  const query = {
    not: vi.fn().mockReturnThis(),
    order,
  };

  return { query, order, limit };
}

describe('GET /api/timesheets/job-codes', () => {
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

  it('returns catalogued live and legacy job codes with customer context', async () => {
    const quoteQuery = createQuoteQuery([
      {
        base_quote_reference: '40001-GH',
        quote_reference: '40001-GH',
        subject_line: 'Cable repairs',
        project_description: null,
        site_address: null,
        customer: { status: 'active', company_name: 'Omexom' },
      },
      {
        base_quote_reference: '40001-GH',
        quote_reference: '40001-GH-REV2',
        subject_line: 'Duplicate revision',
        project_description: null,
        site_address: null,
        customer: { status: 'active', company_name: 'Omexom' },
      },
      {
        base_quote_reference: '1234-AB',
        quote_reference: '1234-AB',
        subject_line: 'Legacy-shaped live quote',
        project_description: null,
        site_address: null,
        customer: { status: 'active', company_name: 'Legacy Customer' },
      },
      {
        base_quote_reference: '50001-LC',
        quote_reference: '50001-LC',
        subject_line: null,
        project_description: 'Concrete works',
        site_address: null,
        customer: { status: 'active', company_name: 'Saint Gobain' },
      },
    ]);
    const legacyQuoteQuery = createLegacyQuoteQuery([
      { quote_reference: '4323-GH', customer_name: 'Omexom', title: 'ATV hire' },
      { quote_reference: '40001-GH', customer_name: 'Duplicate Legacy', title: 'Ignored duplicate' },
    ]);
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === 'quotes') return quoteQuery.query;
        if (table === 'legacy_quotes') return legacyQuoteQuery.query;
        throw new Error(`Unexpected table ${table}`);
      }),
    }));

    mockCreateAdminClient.mockReturnValue({
      from,
    });

    const { GET } = await import('@/app/api/timesheets/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/timesheets/job-codes'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.job_codes).toEqual([
      {
        value: '40001-GH',
        label: '40001-GH',
        customerName: 'Omexom',
        quoteTitle: 'Cable repairs',
        source: 'live_quote',
      },
      {
        value: '50001-LC',
        label: '50001-LC',
        customerName: 'Saint Gobain',
        quoteTitle: 'Concrete works',
        source: 'live_quote',
      },
      {
        value: '4323-GH',
        label: '4323-GH',
        customerName: 'Omexom',
        quoteTitle: 'ATV hire',
        source: 'legacy_quote',
      },
    ]);
    expect(quoteQuery.query.eq).toHaveBeenCalledWith('is_latest_version', true);
    expect(quoteQuery.query.eq).toHaveBeenCalledWith('commercial_status', 'open');
    expect(quoteQuery.query.eq).toHaveBeenCalledWith('customer.status', 'active');
    expect(quoteQuery.query.in).toHaveBeenCalledWith('status', [
      'sent',
      'won',
      'ready_to_invoice',
      'po_received',
      'in_progress',
      'completed_part',
      'completed_full',
      'partially_invoiced',
      'invoiced',
    ]);
    expect(legacyQuoteQuery.query.not).toHaveBeenCalledWith('quote_reference', 'is', null);
  });

  it('requires timesheets access', async () => {
    mockCanEffectiveRoleAccessModule.mockResolvedValue(false);

    const { GET } = await import('@/app/api/timesheets/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/timesheets/job-codes'));

    expect(response.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
