import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/timesheets/[id]/adjust/route';
import { TIMESHEET_ADJUST_RETIRED_CODE } from '@/lib/utils/timesheet-gates';
import { mockSupabaseAuthUser } from '../../utils/test-helpers';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

describe('POST /api/timesheets/[id]/adjust', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Not authenticated') }),
      },
    } as unknown as SupabaseClient);

    const response = await POST(
      new Request('http://localhost/api/timesheets/test-id/adjust', { method: 'POST' }) as NextRequest,
      { params: Promise.resolve({ id: 'test-id' }) }
    );
    expect(response.status).toBe(401);
  });

  it('TS-EDIT-006 returns 409 and does not mutate', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: 'manager-id' })),
      },
    } as unknown as SupabaseClient);

    const response = await POST(
      new Request('http://localhost/api/timesheets/test-id/adjust', { method: 'POST' }) as NextRequest,
      { params: Promise.resolve({ id: 'test-id' }) }
    );
    const data = await response.json();
    expect(response.status).toBe(409);
    expect(data.code).toBe(TIMESHEET_ADJUST_RETIRED_CODE);
  });
});
