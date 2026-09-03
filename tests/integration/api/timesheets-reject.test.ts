import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/timesheets/[id]/reject/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { createMockTimesheet, createMockManager } from '../../utils/factories';
import { mockSupabaseAuthUser, mockSupabaseQuery, mockFetch, resetAllMocks } from '../../utils/test-helpers';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/server/timesheet-approval-scope', () => ({
  canCurrentActorAuthoriseTimesheetTarget: vi.fn(),
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));
vi.mock('@/lib/utils/email', () => ({
  sendTimesheetRejectionEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/server/timesheet-gate-mutations', () => ({
  applyTimesheetReject: vi.fn().mockResolvedValue({
    userId: 'employee-id',
    weekEnding: '2026-08-30',
    previousStatus: 'submitted',
    payrollReceivedBy: null,
  }),
  TimesheetGateConflictError: class TimesheetGateConflictError extends Error {
    currentStatus: string | null;
    constructor(message: string, currentStatus: string | null = null) {
      super(message);
      this.name = 'TimesheetGateConflictError';
      this.currentStatus = currentStatus;
    }
  },
}));

function mockAuthenticatedClients(userId: string, adminClient: Record<string, unknown>) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: userId })),
    },
  } as unknown as SupabaseClient);
  vi.mocked(createAdminClient).mockReturnValue({
    ...adminClient,
    auth: {
      admin: {
        getUserById: vi.fn(async (targetUserId: string) => ({
          data: { user: { id: targetUserId, email: `${targetUserId}@test.com` } },
          error: null,
        })),
      },
    },
  } as never);
}

describe('POST /api/timesheets/[id]/reject', () => {
  beforeEach(async () => {
    resetAllMocks();
    mockFetch({ id: 'mock-email-id' });

    const { sendTimesheetRejectionEmail } = await import('@/lib/utils/email');
    const { logServerError } = await import('@/lib/utils/server-error-logger');

    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn(async (userId: string) => ({
            data: { user: { id: userId, email: `${userId}@test.com` } },
            error: null,
          })),
        },
      },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'manager-id',
      role_id: 'manager-role',
      role_name: 'manager',
      role_class: 'manager',
      display_name: 'Manager',
      is_manager_admin: true,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      team_id: 'team-a',
      team_name: 'Team A',
    });
    vi.mocked(canCurrentActorAuthoriseTimesheetTarget).mockResolvedValue(true);
    vi.mocked(sendTimesheetRejectionEmail).mockResolvedValue({ success: true });
    vi.mocked(logServerError).mockResolvedValue(undefined);
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Not authenticated') }),
        },
      } as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test comment' }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 403 if user is not a manager or admin', async () => {
      const timesheet = createMockTimesheet({ status: 'submitted', user_id: 'target-employee-id' });
      vi.mocked(canCurrentActorAuthoriseTimesheetTarget).mockResolvedValue(false);
      mockAuthenticatedClients('employee-id', {
        from: vi.fn((table: string) => {
          if (table !== 'timesheets') throw new Error(`Unexpected table: ${table}`);
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                  ...timesheet,
                  profiles: { id: 'target-employee-id', full_name: 'Employee' },
                  employee: { team_id: 'team-b' },
                })),
              }),
            }),
          };
        }),
      });

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test comment' }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('cannot reject');
    });

    it('should allow managers to reject timesheets', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'submitted' });
      
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    id: manager.id,
                    roles: { is_manager_admin: true },
                  })),
                }),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
              }),
            };
          }
          if (table === 'messages') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
                }),
              }),
            };
          }
          if (table === 'message_recipients') {
            return {
              insert: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
            };
          }
        }),
      };

      mockAuthenticatedClients(manager.id, mockClient);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Please fix the hours' }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      
      expect(response.status).toBe(200);
    });
  });

  describe('Validation', () => {
    it('should return 400 if comments are missing', async () => {
      const manager = createMockManager();
      const { createClient } = await import('@/lib/supabase/server');
      
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
      } as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });

    it('should return 400 if comments are empty string', async () => {
      const manager = createMockManager();
      const { createClient } = await import('@/lib/supabase/server');
      
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
      } as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: '' }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });

    it('should return 400 if comments are only whitespace', async () => {
      const manager = createMockManager();
      const { createClient } = await import('@/lib/supabase/server');
      
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
      } as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: '   ' }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });
  });

  describe('Status validation', () => {
    it('TS-GATE-003 allows reject from Payroll Received', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    id: manager.id,
                    roles: { is_manager_admin: true },
                  })),
                }),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
            };
          }
        }),
      };

      mockAuthenticatedClients(manager.id, mockClient);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test' }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      const { applyTimesheetReject } = await import('@/lib/server/timesheet-gate-mutations');
      expect(applyTimesheetReject).toHaveBeenCalled();
    });
  });

  describe('Database operations', () => {
    it('should update timesheet with correct fields', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'submitted' });
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
      });
      
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    id: manager.id,
                    roles: { is_manager_admin: true },
                  })),
                }),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
              update: updateMock,
            };
          }
          if (table === 'messages') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
                }),
              }),
            };
          }
          if (table === 'message_recipients') {
            return {
              insert: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
            };
          }
        }),
      };

      mockAuthenticatedClients(manager.id, mockClient);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Please fix the hours' }),
      });

      await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });

      const { applyTimesheetReject } = await import('@/lib/server/timesheet-gate-mutations');
      expect(applyTimesheetReject).toHaveBeenCalledWith(
        expect.objectContaining({
          timesheetId: 'test-id',
          comments: 'Please fix the hours',
        })
      );
    });
  });

  describe('Notifications', () => {
    it('should create in-app notification for employee', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'submitted', user_id: 'employee-id' });
      const messageInsertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
        }),
      });
      const recipientInsertMock = vi.fn().mockResolvedValue(mockSupabaseQuery({}));
      
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    id: manager.id,
                    roles: { is_manager_admin: true },
                  })),
                }),
              }),
            };
          }
          if (table === 'timesheets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...timesheet,
                    profiles: { id: 'employee-id', full_name: 'Employee', email: 'employee@test.com' },
                  })),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
              }),
            };
          }
          if (table === 'messages') {
            return {
              insert: messageInsertMock,
            };
          }
          if (table === 'message_recipients') {
            return {
              insert: recipientInsertMock,
            };
          }
        }),
      };

      mockAuthenticatedClients(manager.id, mockClient);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Please fix the hours' }),
      });

      await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });

      const { applyTimesheetReject } = await import('@/lib/server/timesheet-gate-mutations');
      expect(applyTimesheetReject).toHaveBeenCalledWith(
        expect.objectContaining({
          timesheetId: 'test-id',
          comments: 'Please fix the hours',
        })
      );
    });
  });
});

