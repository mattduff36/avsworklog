import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/management/error-reports/[id]/route';

const { mockCreateClient, mockCanAccess, mockLogServerError } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCanAccess: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanAccess,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

describe('GET /api/management/error-reports/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccess.mockResolvedValue(true);
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('returns report and updates with resolved profile names', async () => {
    const reportRow = {
      id: 'report-1',
      created_by: 'user-1',
      title: 'Broken page',
      description: 'desc',
      error_code: null,
      page_url: '/dashboard',
      user_agent: null,
      additional_context: null,
      status: 'new',
      admin_notes: null,
      resolved_at: null,
      resolved_by: null,
      notification_message_id: null,
      created_at: '2026-03-27T00:00:00Z',
      updated_at: '2026-03-27T00:00:00Z',
    };
    const updateRows = [
      {
        id: 'update-1',
        error_report_id: 'report-1',
        created_by: 'admin-1',
        old_status: 'new',
        new_status: 'investigating',
        note: 'Looking into this',
        created_at: '2026-03-27T01:00:00Z',
      },
    ];
    const profiles = [
      { id: 'user-1', full_name: 'User One' },
      { id: 'admin-1', full_name: 'Admin One' },
    ];

    const reportSingle = vi.fn().mockResolvedValue({ data: reportRow, error: null });
    const reportEq = vi.fn(() => ({ single: reportSingle }));
    const reportSelect = vi.fn(() => ({ eq: reportEq }));

    const updatesOrder = vi.fn().mockResolvedValue({ data: updateRows, error: null });
    const updatesEq = vi.fn(() => ({ order: updatesOrder }));
    const updatesSelect = vi.fn(() => ({ eq: updatesEq }));

    const profilesIn = vi.fn().mockResolvedValue({ data: profiles, error: null });
    const profilesSelect = vi.fn(() => ({ in: profilesIn }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'error_reports') return { select: reportSelect };
        if (table === 'error_report_updates') return { select: updatesSelect };
        if (table === 'profiles') return { select: profilesSelect };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/error-reports/report-1'),
      { params: Promise.resolve({ id: 'report-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(profilesIn).toHaveBeenCalledWith('id', ['user-1', 'admin-1']);
    expect(payload.report.user).toEqual({ id: 'user-1', full_name: 'User One' });
    expect(payload.updates[0].user).toEqual({ id: 'admin-1', full_name: 'Admin One' });
  });

  it('returns 404 when report does not exist', async () => {
    const reportSingle = vi.fn().mockResolvedValue({ data: null, error: new Error('missing') });
    const reportEq = vi.fn(() => ({ single: reportSingle }));
    const reportSelect = vi.fn(() => ({ eq: reportEq }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'error_reports') return { select: reportSelect };
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/error-reports/missing'),
      { params: Promise.resolve({ id: 'missing' }) }
    );

    expect(response.status).toBe(404);
  });
});
