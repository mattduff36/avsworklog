import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/timesheets/[id]/adjust/route';
import { createMockTimesheet, createMockManager, createMockAdmin, createSuzanneSquires } from '../../utils/factories';
import { mockSupabaseAuthUser, mockSupabaseQuery, mockFetch, resetAllMocks } from '../../utils/test-helpers';

describe('POST /api/timesheets/[id]/adjust', () => {
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

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test', notifyManagerIds: [] }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should allow managers to adjust timesheets', async () => {
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
                    ...manager,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([])),
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

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Adjusted hours', notifyManagerIds: [] }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      
      expect(response.status).toBe(200);
    });

    it('should allow admins to adjust timesheets', async () => {
      const admin = createMockAdmin();
      const timesheet = createMockTimesheet({ status: 'approved' });
      
      const { createClient } = await import('@/lib/supabase/server');
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: admin.id })),
        },
        from: vi.fn((table: string) => {
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                    ...admin,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([])),
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

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Adjusted hours', notifyManagerIds: [] }),
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

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ notifyManagerIds: [] }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });

    it('should return 400 if comments are empty', async () => {
      const manager = createMockManager();
      const { createClient } = await import('@/lib/supabase/server');
      
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
      } as any);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: '', notifyManagerIds: [] }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });
  });

  describe('Status validation', () => {
    it('should return 400 if timesheet is not approved', async () => {
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
            };
          }
        }),
      };

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as any);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test', notifyManagerIds: [] }),
      });

      const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('approved');
    });
  });

  describe('Database operations', () => {
    it('should update timesheet with adjusted status and metadata', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      const recipients = ['manager2-id', 'manager3-id'];
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
                    ...manager,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([
                  { id: 'manager2-id', full_name: 'Manager 2', email: 'manager2@test.com' },
                  { id: 'manager3-id', full_name: 'Manager 3', email: 'manager3@test.com' },
                ])),
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

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Corrected hours', notifyManagerIds: recipients }),
      });

      await POST(request, { params: Promise.resolve({ id: 'test-id' }) });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'adjusted',
          adjusted_by: manager.id,
          adjustment_recipients: recipients,
          manager_comments: 'Corrected hours',
        })
      );
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          adjusted_at: expect.any(String),
        })
      );
    });
  });

  describe('Notifications', () => {
    it('should send notifications to employee', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved', user_id: 'employee-id' });
      const messageInsertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
        }),
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
                    ...manager,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([])),
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
              insert: vi.fn().mockResolvedValue(mockSupabaseQuery({})),
            };
          }
        }),
      };

      vi.mocked(createClient).mockResolvedValueOnce(mockClient as any);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Adjusted', notifyManagerIds: [] }),
      });

      await POST(request, { params: Promise.resolve({ id: 'test-id' }) });

      expect(messageInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Adjusted'),
          message_type: 'timesheet_adjustment',
        })
      );
    });

    it('should send notifications to selected managers', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      const recipients = ['manager2-id'];
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
                    ...manager,
                    roles: { is_manager_admin: true },
                  })),
                }),
                in: vi.fn().mockResolvedValue(mockSupabaseQuery([
                  { id: 'manager2-id', full_name: 'Manager 2', email: 'manager2@test.com' },
                ])),
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

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Adjusted', notifyManagerIds: recipients }),
      });

      await POST(request, { params: Promise.resolve({ id: 'test-id' }) });

      // Should create notifications for managers
      expect(messageInsertMock).toHaveBeenCalledTimes(2); // Once for employee, once for managers
      expect(recipientInsertMock).toHaveBeenCalled();
    });
  });
});

