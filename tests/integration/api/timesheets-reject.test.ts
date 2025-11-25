import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/timesheets/[id]/reject/route';
import { createMockTimesheet, createMockManager, createMockProfile } from '../../utils/factories';
import { mockSupabaseAuthUser, mockSupabaseQuery, mockFetch, resetAllMocks } from '../../utils/test-helpers';

describe('POST /api/timesheets/[id]/reject', () => {
  beforeEach(() => {
    resetAllMocks();
    mockFetch({ id: 'mock-email-id' });
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Not authenticated') }),
        },
      } as any);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test comment' }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 403 if user is not a manager or admin', async () => {
      const employee = createMockProfile();
      const { createClient } = await import('@/lib/supabase/server');
      
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: employee.id })),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                id: employee.id,
                roles: { is_manager_admin: false },
              })),
            }),
          }),
        }),
      } as any);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test comment' }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('manager');
    });

    it('should allow managers to reject timesheets', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'submitted' });
      
      const { createClient } = await import('@/lib/supabase/server');
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

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as any);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Please fix the hours' }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      
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
      } as any);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
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
      } as any);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: '' }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
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
      } as any);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: '   ' }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });
  });

  describe('Status validation', () => {
    it('should return 400 if timesheet is not in submitted status', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      
      const { createClient } = await import('@/lib/supabase/server');
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

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as any);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test' }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('submitted');
    });
  });

  describe('Database operations', () => {
    it('should update timesheet with correct fields', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'submitted' });
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
      });
      
      const { createClient } = await import('@/lib/supabase/server');
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

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as any);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Please fix the hours' }),
      });

      await POST(request, { params: Promise.resolve({ id: 'test-id' }) });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'rejected',
          reviewed_by: manager.id,
          manager_comments: 'Please fix the hours',
        })
      );
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewed_at: expect.any(String),
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
      
      const { createClient } = await import('@/lib/supabase/server');
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

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as any);

      const request = new Request('http://localhost/api/timesheets/test-id/reject', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Please fix the hours' }),
      });

      await POST(request, { params: Promise.resolve({ id: 'test-id' }) });

      expect(messageInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Rejected'),
          message_type: 'timesheet_rejection',
        })
      );
      expect(recipientInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient_id: 'employee-id',
          read: false,
        })
      );
    });
  });
});

