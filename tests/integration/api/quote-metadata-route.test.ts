import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/quotes/metadata/route';
import { createInventoryKioskConfigTableMock } from '@/tests/utils/supabase-query-mock';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFilterHiddenSystemTestAccountProfiles,
  mockListQuoteManagerOptions,
  mockRequireSensitiveModuleAccess,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFilterHiddenSystemTestAccountProfiles: vi.fn(),
  mockListQuoteManagerOptions: vi.fn(),
  mockRequireSensitiveModuleAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/system-test-accounts', () => ({
  filterHiddenSystemTestAccountProfiles: mockFilterHiddenSystemTestAccountProfiles,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  listQuoteManagerOptions: mockListQuoteManagerOptions,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: mockRequireSensitiveModuleAccess,
}));

function createOrderedQuery(rows: Array<Record<string, unknown>>) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const chain = {
    eq: vi.fn(() => chain),
    order,
  };
  const select = vi.fn().mockReturnValue(chain);

  return { select, order };
}

describe('GET /api/quotes/metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    mockListQuoteManagerOptions.mockResolvedValue([]);
    mockRequireSensitiveModuleAccess.mockResolvedValue(null);
    mockFilterHiddenSystemTestAccountProfiles.mockImplementation(async (_admin, profiles) => profiles);
  });

  it.each([
    { user: null, error: null },
    { user: { id: 'user-1' }, error: { message: 'Session unavailable' } },
  ])('returns 401 before reading sensitive metadata when authentication fails: %j', async (auth) => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: auth.user }, error: auth.error }) },
    });
    const response = await GET(new NextRequest('http://localhost/api/quotes/metadata?include_customers=true'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'You must be signed in to use quotes.' });
    expect(mockRequireSensitiveModuleAccess).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockListQuoteManagerOptions).not.toHaveBeenCalled();
  });

  it.each([403, 428])('preserves the sensitive-access HTTP %i response without reading metadata', async (status) => {
    const error = status === 403 ? 'Forbidden' : 'Sensitive PIN required';
    mockRequireSensitiveModuleAccess.mockResolvedValue(NextResponse.json({ error }, { status }));
    const response = await GET(new NextRequest('http://localhost/api/quotes/metadata?include_customers=true'));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(mockRequireSensitiveModuleAccess).toHaveBeenCalledWith('quotes');
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockListQuoteManagerOptions).not.toHaveBeenCalled();
  });

  it('reports unexpected metadata failures as 500 rather than returning empty successful data', async () => {
    const error = new Error('Metadata query failed');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreateAdminClient.mockImplementationOnce(() => { throw error; });
    try {
      const response = await GET(new NextRequest('http://localhost/api/quotes/metadata?include_customers=true'));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Unable to load quote settings right now.' });
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching quote metadata:', error);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('omits customers from metadata unless explicitly requested', async () => {
    const profilesQuery = createOrderedQuery([]);
    const from = vi.fn((table: string) => {
      if (table === 'profiles') return { select: profilesQuery.select };
      if (table === 'inventory_kiosk_config') return createInventoryKioskConfigTableMock();
      throw new Error(`Unexpected table: ${table}`);
    });
    mockCreateAdminClient.mockReturnValue({ from } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/quotes/metadata'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect('customers' in payload).toBe(false);
    expect(from).not.toHaveBeenCalledWith('customers');
  });

  it('includes customers when requested by the quote form', async () => {
    const customer = {
      id: 'customer-1',
      company_name: 'Acme Ltd',
      secondary_contacts: [],
    };
    const profilesQuery = createOrderedQuery([]);
    const customersQuery = createOrderedQuery([customer]);
    const from = vi.fn((table: string) => {
      if (table === 'profiles') return { select: profilesQuery.select };
      if (table === 'customers') return { select: customersQuery.select };
      if (table === 'inventory_kiosk_config') return createInventoryKioskConfigTableMock();
      throw new Error(`Unexpected table: ${table}`);
    });
    mockCreateAdminClient.mockReturnValue({ from } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/quotes/metadata?include_customers=true'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(customersQuery.select).toHaveBeenCalledWith(expect.stringContaining('secondary_contacts:customer_contacts(*)'));
    expect(payload.customers).toEqual([customer]);
  });
});
