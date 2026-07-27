import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockIsAdmin,
  mockMergeLiveQuotes,
  mockRequireSensitiveAccess,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockMergeLiveQuotes: vi.fn(),
  mockRequireSensitiveAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock('@/lib/utils/rbac', () => ({ isEffectiveRoleAdminOrSuper: mockIsAdmin }));
vi.mock('@/lib/server/quote-merge', () => ({ mergeLiveQuotes: mockMergeLiveQuotes }));
vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: mockRequireSensitiveAccess,
}));

describe('POST /api/quotes/merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({ service: 'admin' });
    mockRequireSensitiveAccess.mockResolvedValue(null);
    mockIsAdmin.mockResolvedValue(true);
    mockMergeLiveQuotes.mockResolvedValue({
      merge_group_id: 'group-1',
      quote_id: 'quote-3',
      quote_thread_id: 'thread-1',
      canonical_reference: '80004-MD',
      aliases: ['80005-MD'],
      merge_mode: 'consolidated',
    });
  });

  it('rejects non-admin accounts', async () => {
    mockIsAdmin.mockResolvedValue(false);
    const { POST } = await import('@/app/api/quotes/merge/route');
    const response = await POST(new NextRequest('http://localhost/api/quotes/merge', {
      method: 'POST',
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(403);
    expect(mockMergeLiveQuotes).not.toHaveBeenCalled();
  });

  it('honours the Quotes sensitive-module gate', async () => {
    mockRequireSensitiveAccess.mockResolvedValue(
      NextResponse.json({ error: 'PIN required' }, { status: 403 }),
    );
    const { POST } = await import('@/app/api/quotes/merge/route');
    const response = await POST(new NextRequest('http://localhost/api/quotes/merge', {
      method: 'POST',
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(403);
    expect(mockIsAdmin).not.toHaveBeenCalled();
  });

  it('passes the confirmed merge to the atomic service', async () => {
    const body = {
      quote_ids: ['quote-1', 'quote-2'],
      survivor_quote_id: 'quote-1',
      merge_mode: 'consolidated',
      irreversible_confirmed: true,
    };
    const { POST } = await import('@/app/api/quotes/merge/route');
    const response = await POST(new NextRequest('http://localhost/api/quotes/merge', {
      method: 'POST',
      body: JSON.stringify(body),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockMergeLiveQuotes).toHaveBeenCalledWith(
      { service: 'admin' },
      body,
      'admin-1',
    );
    expect(payload.merge.canonical_reference).toBe('80004-MD');
  });
});
