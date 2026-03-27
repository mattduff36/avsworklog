import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/management/suggestions/[id]/route';

const { mockCreateClient, mockCanAccess, mockLogServerError } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCanAccess: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanAccess,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

describe('GET /api/management/suggestions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccess.mockResolvedValue(true);
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('returns suggestion and update history with resolved profile names', async () => {
    const suggestionRow = {
      id: 'suggestion-1',
      created_by: 'user-1',
      title: 'Suggestion',
      body: 'Body',
      page_hint: '/dashboard',
      status: 'new',
      admin_notes: null,
      created_at: '2026-03-27T00:00:00Z',
      updated_at: '2026-03-27T00:00:00Z',
    };
    const updateRows = [
      {
        id: 'update-1',
        suggestion_id: 'suggestion-1',
        created_by: 'manager-1',
        old_status: 'new',
        new_status: 'under_review',
        note: 'Investigating',
        created_at: '2026-03-27T01:00:00Z',
      },
    ];
    const profileRows = [
      { id: 'user-1', full_name: 'User One' },
      { id: 'manager-1', full_name: 'Manager One' },
    ];

    const suggestionsSingle = vi.fn().mockResolvedValue({ data: suggestionRow, error: null });
    const suggestionsEq = vi.fn(() => ({ single: suggestionsSingle }));
    const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEq }));

    const updatesOrder = vi.fn().mockResolvedValue({ data: updateRows, error: null });
    const updatesEq = vi.fn(() => ({ order: updatesOrder }));
    const updatesSelect = vi.fn(() => ({ eq: updatesEq }));

    const profilesIn = vi.fn().mockResolvedValue({ data: profileRows, error: null });
    const profilesSelect = vi.fn(() => ({ in: profilesIn }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'suggestions') return { select: suggestionsSelect };
        if (table === 'suggestion_updates') return { select: updatesSelect };
        if (table === 'profiles') return { select: profilesSelect };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/suggestions/suggestion-1'),
      { params: Promise.resolve({ id: 'suggestion-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(profilesIn).toHaveBeenCalledWith('id', ['user-1', 'manager-1']);
    expect(payload.suggestion.user).toEqual({ full_name: 'User One' });
    expect(payload.updates[0].user).toEqual({ full_name: 'Manager One' });
  });

  it('returns 404 when suggestion is not found', async () => {
    const notFoundError = { code: 'PGRST116', message: 'No rows found' };
    const suggestionsSingle = vi.fn().mockResolvedValue({ data: null, error: notFoundError });
    const suggestionsEq = vi.fn(() => ({ single: suggestionsSingle }));
    const suggestionsSelect = vi.fn(() => ({ eq: suggestionsEq }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'suggestions') return { select: suggestionsSelect };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/suggestions/missing'),
      { params: Promise.resolve({ id: 'missing' }) }
    );

    expect(response.status).toBe(404);
  });
});
