import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/timesheets/[id]/adjust/route';
import { createMockTimesheet, createMockManager, createMockAdmin } from '../../utils/factories';
import { mockSupabaseAuthUser, mockSupabaseQuery, mockFetch } from '../../utils/test-helpers';
import type { EffectiveRoleInfo } from '@/lib/utils/view-as';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/server/reports-timesheet-scope', () => ({
  filterTimesheetRowsForReportScope: vi.fn(async <T>(rows: T[]) => rows),
}));
vi.mock('@/lib/server/timesheet-adjust', () => ({
  applyTimesheetAdjustmentMutation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: vi.fn(),
}));
vi.mock('@/lib/server/processed-absence-notifications', () => ({
  notifyProcessedAbsenceTimesheetAdjustment: vi.fn().mockResolvedValue(['accounts-supervisor']),
}));
vi.mock('@/lib/utils/email', () => ({
  sendTimesheetAdjustmentEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    createClient: vi.fn(),
  };
});

const sampleEntries = [
  {
    day_of_week: 1,
    time_started: '08:00',
    time_finished: '16:00',
    daily_total: 8,
    did_not_work: false,
    working_in_yard: false,
    remarks: null,
    job_numbers: ['JOB-1'],
  },
];

async function setupAuthAdminClientMock() {
  const sjs = await import('@supabase/supabase-js');
  vi.mocked(sjs.createClient).mockReturnValue({
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { id: 'employee-id', email: 'employee@test.com' } },
          error: null,
        }),
      },
    },
  } as never);
}

async function mockEffectiveRole(overrides: Partial<EffectiveRoleInfo> = {}) {
  const defaults: EffectiveRoleInfo = {
    role_id: null,
    role_name: null,
    display_name: null,
    is_manager_admin: false,
    is_super_admin: false,
    is_viewing_as: false,
    is_actual_super_admin: false,
    user_id: null,
    team_id: null,
    team_name: null,
  };
  const { getEffectiveRole } = await import('@/lib/utils/view-as');
  vi.mocked(getEffectiveRole).mockResolvedValue({ ...defaults, ...overrides });
}

async function mockScopedAdminTimesheet(options: {
  timesheet: ReturnType<typeof createMockTimesheet>;
}) {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'timesheets') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue(mockSupabaseQuery({
                ...options.timesheet,
                profiles: { id: 'employee-id', full_name: 'Employee' },
                employee: { team_id: 'team-1' },
              })),
            }),
          }),
        };
      }
      return {};
    }),
  } as never);
}

function mockSessionClient(actor: { id: string; full_name?: string }, extras?: {
  managerRows?: Array<{ id: string; full_name: string; email?: string }>;
  messageInsertMock?: ReturnType<typeof vi.fn>;
  recipientInsertMock?: ReturnType<typeof vi.fn>;
}) {
  const messageInsertMock = extras?.messageInsertMock || vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(mockSupabaseQuery({ id: 'message-id' })),
    }),
  });
  const recipientInsertMock = extras?.recipientInsertMock || vi.fn().mockResolvedValue(mockSupabaseQuery({}));
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: actor.id })),
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(mockSupabaseQuery({
                id: actor.id,
                full_name: actor.full_name || 'Actor',
              })),
            }),
            in: vi.fn().mockResolvedValue(mockSupabaseQuery(extras?.managerRows || [])),
          }),
        };
      }
      if (table === 'messages') {
        return { insert: messageInsertMock };
      }
      if (table === 'message_recipients') {
        return { insert: recipientInsertMock };
      }
      return {};
    }),
    messageInsertMock,
    recipientInsertMock,
  };
}

describe('POST /api/timesheets/[id]/adjust', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch({ id: 'mock-email-id' });
    await setupAuthAdminClientMock();
    const rbac = await import('@/lib/utils/rbac');
    const email = await import('@/lib/utils/email');
    const processedAbsenceNotifications = await import('@/lib/server/processed-absence-notifications');
    const scope = await import('@/lib/server/reports-timesheet-scope');
    const adjustMutation = await import('@/lib/server/timesheet-adjust');
    vi.mocked(email.sendTimesheetAdjustmentEmail).mockResolvedValue({ success: true });
    vi.mocked(rbac.canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(processedAbsenceNotifications.notifyProcessedAbsenceTimesheetAdjustment).mockResolvedValue(['accounts-supervisor']);
    vi.mocked(scope.filterTimesheetRowsForReportScope).mockImplementation(async (rows) => rows);
    vi.mocked(adjustMutation.applyTimesheetAdjustmentMutation).mockResolvedValue(undefined);
    const logger = await import('@/lib/utils/server-error-logger');
    vi.mocked(logger.logServerError).mockResolvedValue(undefined);
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 if user is not authenticated', async () => {
      await mockEffectiveRole({ user_id: null });
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Not authenticated') }) },
      } as unknown as SupabaseClient);

      const request = new Request('http://localhost/api/timesheets/test-id/adjust', {
        method: 'POST',
        body: JSON.stringify({ comments: 'Test', notifyManagerIds: [], entries: sampleEntries }),
      });

      const response = await POST(request as NextRequest, { params: Promise.resolve({ id: 'test-id' }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should allow managers to adjust timesheets', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      await mockScopedAdminTimesheet({ timesheet });

      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce(
        mockSessionClient(manager) as unknown as SupabaseClient
      );

      const response = await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({ comments: 'Adjusted hours', notifyManagerIds: [], entries: sampleEntries }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );

      const processedAbsenceNotifications = await import('@/lib/server/processed-absence-notifications');
      const adjustMutation = await import('@/lib/server/timesheet-adjust');
      expect(response.status).toBe(200);
      expect(adjustMutation.applyTimesheetAdjustmentMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          timesheetId: 'test-id',
          actorId: manager.id,
          comments: 'Adjusted hours',
          entries: sampleEntries,
        })
      );
      expect(processedAbsenceNotifications.notifyProcessedAbsenceTimesheetAdjustment).toHaveBeenCalledWith(
        expect.objectContaining({ auth: expect.any(Object) }),
        expect.objectContaining({
          actorUserId: manager.id,
          employeeProfileId: 'test-user-id',
          employeeName: 'Employee',
          weekEnding: '2024-12-01',
          adjustmentComments: 'Adjusted hours',
        })
      );
    });

    it('should allow admins to adjust timesheets', async () => {
      const admin = createMockAdmin();
      const timesheet = createMockTimesheet({ status: 'approved' });
      await mockEffectiveRole({ user_id: admin.id, is_manager_admin: true });
      await mockScopedAdminTimesheet({ timesheet });
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce(
        mockSessionClient(admin) as unknown as SupabaseClient
      );

      const response = await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({ comments: 'Adjusted hours', notifyManagerIds: [], entries: sampleEntries }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );

      expect(response.status).toBe(200);
    });

    it('PAY-AUTH-ADJUST-001 rejects out-of-scope employees before mutation', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      await mockScopedAdminTimesheet({ timesheet });
      const scope = await import('@/lib/server/reports-timesheet-scope');
      const adjustMutation = await import('@/lib/server/timesheet-adjust');
      vi.mocked(scope.filterTimesheetRowsForReportScope).mockResolvedValueOnce([]);
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce(
        mockSessionClient(manager) as unknown as SupabaseClient
      );

      const response = await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({ comments: 'Adjusted hours', notifyManagerIds: [], entries: sampleEntries }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('cannot adjust');
      expect(adjustMutation.applyTimesheetAdjustmentMutation).not.toHaveBeenCalled();
    });
  });

  describe('Validation', () => {
    it('should return 400 if comments are missing', async () => {
      const manager = createMockManager();
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
      } as unknown as SupabaseClient);

      const response = await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({ notifyManagerIds: [], entries: sampleEntries }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });

    it('should return 400 if comments are empty', async () => {
      const manager = createMockManager();
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: manager.id })),
        },
      } as unknown as SupabaseClient);

      const response = await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({ comments: '', notifyManagerIds: [], entries: sampleEntries }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('required');
    });
  });

  describe('Status validation', () => {
    it('should return 400 if timesheet is not approved', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'submitted' });
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      await mockScopedAdminTimesheet({ timesheet });
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce(
        mockSessionClient(manager) as unknown as SupabaseClient
      );

      const response = await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({ comments: 'Test', notifyManagerIds: [], entries: sampleEntries }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('approved');
    });

    it('PAY-ADJUST-ADJUSTED-STATE accepts already-adjusted timesheets', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'adjusted' });
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      await mockScopedAdminTimesheet({ timesheet });
      const adjustMutation = await import('@/lib/server/timesheet-adjust');
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce(
        mockSessionClient(manager) as unknown as SupabaseClient
      );

      const response = await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({ comments: 'Follow-up note', notifyManagerIds: [] }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );

      expect(response.status).toBe(200);
      expect(adjustMutation.applyTimesheetAdjustmentMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: 'Follow-up note',
          entries: null,
        })
      );
    });

    it('requires entries when adjusting an approved timesheet', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      await mockScopedAdminTimesheet({ timesheet });
      const adjustMutation = await import('@/lib/server/timesheet-adjust');
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce(
        mockSessionClient(manager) as unknown as SupabaseClient
      );

      const response = await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({ comments: 'Missing entries', notifyManagerIds: [] }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Entry payload is required');
      expect(adjustMutation.applyTimesheetAdjustmentMutation).not.toHaveBeenCalled();
    });
  });

  describe('Database operations', () => {
    it('should update timesheet with adjusted status and metadata', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      const recipients = ['manager2-id', 'manager3-id'];
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      await mockScopedAdminTimesheet({ timesheet });
      const adjustMutation = await import('@/lib/server/timesheet-adjust');
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce(
        mockSessionClient(manager, {
          managerRows: [
            { id: 'manager2-id', full_name: 'Manager 2', email: 'manager2@test.com' },
            { id: 'manager3-id', full_name: 'Manager 3', email: 'manager3@test.com' },
          ],
        }) as unknown as SupabaseClient
      );

      await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({
            comments: 'Corrected hours',
            notifyManagerIds: recipients,
            entries: sampleEntries,
          }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );

      expect(adjustMutation.applyTimesheetAdjustmentMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: manager.id,
          comments: 'Corrected hours',
          notifyManagerIds: recipients,
          entries: sampleEntries,
        })
      );
    });
  });

  describe('Notifications', () => {
    it('should send notifications to employee', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved', user_id: 'employee-id' });
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      await mockScopedAdminTimesheet({ timesheet });
      const session = mockSessionClient(manager);
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce(session as unknown as SupabaseClient);

      await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({ comments: 'Adjusted', notifyManagerIds: [], entries: sampleEntries }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );

      expect(session.messageInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTIFICATION',
          subject: expect.stringContaining('Adjusted'),
          created_via: 'timesheet_adjustment',
          module_key: 'timesheets',
        })
      );
    });

    it('should send notifications to selected managers', async () => {
      const manager = createMockManager();
      const timesheet = createMockTimesheet({ status: 'approved' });
      const recipients = ['manager2-id'];
      await mockEffectiveRole({ user_id: manager.id, is_manager_admin: true });
      await mockScopedAdminTimesheet({ timesheet });
      const session = mockSessionClient(manager, {
        managerRows: [{ id: 'manager2-id', full_name: 'Manager 2', email: 'manager2@test.com' }],
      });
      const { createClient } = await import('@/lib/supabase/server');
      vi.mocked(createClient).mockResolvedValueOnce(session as unknown as SupabaseClient);

      await POST(
        new Request('http://localhost/api/timesheets/test-id/adjust', {
          method: 'POST',
          body: JSON.stringify({
            comments: 'Adjusted',
            notifyManagerIds: recipients,
            entries: sampleEntries,
          }),
        }) as NextRequest,
        { params: Promise.resolve({ id: 'test-id' }) }
      );

      expect(session.messageInsertMock).toHaveBeenCalledTimes(2);
      expect(session.recipientInsertMock).toHaveBeenCalled();
    });
  });
});
