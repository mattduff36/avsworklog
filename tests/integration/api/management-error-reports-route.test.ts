import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/management/error-reports/route';

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

function createReportsQuery(rows: Array<Record<string, unknown>>) {
  const result = { data: rows, error: null };
  const query = {
    eq: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  const range = vi.fn().mockReturnValue(query);
  const order = vi.fn().mockReturnValue({ range });

  return { order, range, query };
}

describe('GET /api/management/error-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccess.mockResolvedValue(true);
    mockLogServerError.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Unauthorized'),
        }),
      },
    } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/management/error-reports'));

    expect(response.status).toBe(401);
  });

  it('returns accurate global counts in the default all view', async () => {
    const paginatedReports = [
      { id: 'report-1', status: 'new', user: { id: 'user-1', full_name: 'Alex Able' } },
      { id: 'report-2', status: 'new', user: { id: 'user-2', full_name: 'Blake Baker' } },
    ];
    const allStatuses = [
      { status: 'new' },
      { status: 'new' },
      { status: 'investigating' },
      { status: 'resolved' },
    ];
    const { order, range, query } = createReportsQuery(paginatedReports);
    const select = vi.fn((columns: string) => {
      if (columns.includes('user:created_by')) {
        return { order };
      }

      if (columns === 'status') {
        return Promise.resolve({ data: allStatuses, error: null });
      }

      throw new Error(`Unexpected select columns: ${columns}`);
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'error_reports') {
          throw new Error(`Unexpected table: ${table}`);
        }

        return { select };
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/error-reports?limit=2&offset=0')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(range).toHaveBeenCalledWith(0, 1);
    expect(query.eq).not.toHaveBeenCalled();
    expect(payload.counts).toEqual({
      all: 4,
      new: 2,
      investigating: 1,
      resolved: 1,
    });
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 2,
      has_more: true,
    });
  });

  it('keeps counts global when a status filter is applied', async () => {
    const paginatedReports = [
      { id: 'report-3', status: 'investigating', user: { id: 'user-3', full_name: 'Casey Cole' } },
    ];
    const allStatuses = [
      { status: 'new' },
      { status: 'investigating' },
      { status: 'investigating' },
      { status: 'resolved' },
    ];
    const { order, query } = createReportsQuery(paginatedReports);
    const select = vi.fn((columns: string) => {
      if (columns.includes('user:created_by')) {
        return { order };
      }

      if (columns === 'status') {
        return Promise.resolve({ data: allStatuses, error: null });
      }

      throw new Error(`Unexpected select columns: ${columns}`);
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'error_reports') {
          throw new Error(`Unexpected table: ${table}`);
        }

        return { select };
      }),
    } as unknown as SupabaseClient);

    const response = await GET(
      new NextRequest('http://localhost/api/management/error-reports?status=investigating')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('status', 'investigating');
    expect(payload.reports).toHaveLength(1);
    expect(payload.counts).toEqual({
      all: 4,
      new: 1,
      investigating: 2,
      resolved: 1,
    });
  });
});
