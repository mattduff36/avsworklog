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

function createQuoteQuery(rows: Array<{ base_quote_reference: string | null; quote_reference: string | null }>) {
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

  it('returns reference-only active 5 digit job codes', async () => {
    const { query } = createQuoteQuery([
      { base_quote_reference: '40001-GH', quote_reference: '40001-GH' },
      { base_quote_reference: '40001-GH', quote_reference: '40001-GH-REV2' },
      { base_quote_reference: '1234-AB', quote_reference: '1234-AB' },
      { base_quote_reference: '50001-LC', quote_reference: '50001-LC' },
    ]);

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => query),
      })),
    });

    const { GET } = await import('@/app/api/timesheets/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/timesheets/job-codes'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.job_codes).toEqual([
      { value: '40001-GH', label: '40001-GH' },
      { value: '50001-LC', label: '50001-LC' },
    ]);
    expect(query.eq).toHaveBeenCalledWith('is_latest_version', true);
    expect(query.eq).toHaveBeenCalledWith('commercial_status', 'open');
    expect(query.eq).toHaveBeenCalledWith('customer.status', 'active');
    expect(query.in).toHaveBeenCalledWith('status', [
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
  });

  it('requires timesheets access', async () => {
    mockCanEffectiveRoleAccessModule.mockResolvedValue(false);

    const { GET } = await import('@/app/api/timesheets/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/timesheets/job-codes'));

    expect(response.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
