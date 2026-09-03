import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/timesheets/submit/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { validateAppSession } from '@/lib/server/app-auth/session';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import { applyTimesheetSubmit } from '@/lib/server/timesheet-submit';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getEffectiveRole, type EffectiveRoleInfo } from '@/lib/utils/view-as';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession: vi.fn(),
}));
vi.mock('@/lib/server/app-auth/response', () => ({
  applyValidationCookieIfNeeded: vi.fn(),
}));
vi.mock('@/lib/server/app-auth/profile', () => ({
  getAppAuthProfile: vi.fn(),
}));
vi.mock('@/lib/server/timesheet-approval-scope', () => ({
  canCurrentActorAuthoriseTimesheetTarget: vi.fn(),
}));
vi.mock('@/lib/server/timesheet-submit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/timesheet-submit')>();
  return {
    ...actual,
    applyTimesheetSubmit: vi.fn(),
  };
});
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: vi.fn(),
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn().mockResolvedValue(undefined),
}));

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const TIMESHEET_ID = '33333333-3333-4333-8333-333333333333';
const SIGNATURE = `data:image/png;base64,${'A'.repeat(40)}`;

function role(overrides: Partial<EffectiveRoleInfo> = {}): EffectiveRoleInfo {
  return {
    user_id: ACTOR_ID,
    role_id: 'role-1',
    role_name: 'employee',
    role_class: 'employee',
    display_name: 'Employee',
    is_manager_admin: false,
    is_super_admin: false,
    is_viewing_as: false,
    is_actual_super_admin: false,
    team_id: 'team-ops',
    team_name: 'Operations',
    ...overrides,
  };
}

function sevenEntries() {
  return Array.from({ length: 7 }, (_, index) => ({
    day_of_week: index + 1,
    time_started: index === 6 ? null : '08:00',
    time_finished: index === 6 ? null : '16:00',
    did_not_work: index === 6,
    daily_total: index === 6 ? 0 : 8,
    remarks: index === 6 ? 'Did Not Work' : null,
    job_numbers: index === 6 ? [] : ['JOB-1'],
  }));
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    userId: ACTOR_ID,
    weekEnding: '2026-09-06',
    timesheetType: 'civils',
    signatureData: SIGNATURE,
    entries: sevenEntries(),
    ...overrides,
  };
}

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/timesheets/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockProfileLookup(profileId: string) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: profileId, team_id: 'team-ops' },
            error: null,
          }),
        })),
      })),
    })),
  } as unknown as ReturnType<typeof createAdminClient>);
}

describe('timesheet submit route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAppSession).mockResolvedValue({
      status: 'active',
      profileId: ACTOR_ID,
      email: 'actor@example.com',
      session: null,
      cookieValue: null,
      cookieExpiresAt: null,
      secretRotated: false,
      failureReason: null,
      kioskDeviceIdHint: null,
    } as Awaited<ReturnType<typeof validateAppSession>>);
    vi.mocked(getAppAuthProfile).mockResolvedValue({
      id: ACTOR_ID,
      email: 'actor@example.com',
    } as Awaited<ReturnType<typeof getAppAuthProfile>>);
    vi.mocked(getEffectiveRole).mockResolvedValue(role());
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    mockProfileLookup(ACTOR_ID);
    vi.mocked(applyTimesheetSubmit).mockResolvedValue({
      id: TIMESHEET_ID,
      status: 'submitted',
    });
  });

  it('TS-SAVE-006 proves owner, scoped authoriser, denied cross-user, and View As', async () => {
    const owner = await POST(request(validBody()));
    expect(owner.status).toBe(200);
    expect(canCurrentActorAuthoriseTimesheetTarget).not.toHaveBeenCalled();

    vi.mocked(validateAppSession).mockResolvedValue({
      status: 'missing',
      profileId: null,
    } as Awaited<ReturnType<typeof validateAppSession>>);
    const noSession = await POST(request(validBody()));
    expect(noSession.status).toBe(401);
    vi.mocked(validateAppSession).mockResolvedValue({
      status: 'active',
      profileId: ACTOR_ID,
      email: 'actor@example.com',
    } as Awaited<ReturnType<typeof validateAppSession>>);

    mockProfileLookup(OTHER_ID);
    vi.mocked(canCurrentActorAuthoriseTimesheetTarget).mockResolvedValue(false);
    const denied = await POST(request(validBody({ userId: OTHER_ID })));
    expect(denied.status).toBe(403);
    expect(applyTimesheetSubmit).toHaveBeenCalledTimes(1);

    vi.mocked(canCurrentActorAuthoriseTimesheetTarget).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue(
      role({
        role_name: 'supervisor',
        is_viewing_as: true,
        is_actual_super_admin: true,
      })
    );
    const authoriser = await POST(request(validBody({ userId: OTHER_ID })));
    expect(authoriser.status).toBe(200);
    expect(canCurrentActorAuthoriseTimesheetTarget).toHaveBeenCalledWith(
      { profileId: OTHER_ID, teamId: 'team-ops' },
      expect.objectContaining({
        effectiveRole: expect.objectContaining({ is_viewing_as: true }),
      })
    );

    vi.mocked(canCurrentActorAuthoriseTimesheetTarget).mockResolvedValue(false);
    const viewAsDenied = await POST(request(validBody({ userId: OTHER_ID })));
    expect(viewAsDenied.status).toBe(403);
    expect(applyTimesheetSubmit).toHaveBeenCalledTimes(2);
  });

  it('returns 400 for unknown fields and malformed JSON', async () => {
    const invalid = await POST(request({ ...validBody(), actorId: ACTOR_ID }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'INVALID_INPUT' });

    const malformed = new NextRequest('http://localhost/api/timesheets/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });
    const response = await POST(malformed);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_INPUT' });
    expect(applyTimesheetSubmit).not.toHaveBeenCalled();
  });

  it('AUTH-COOKIE-001 propagates rotated app-session cookies on success and validation errors', async () => {
    const rotated = {
      status: 'active' as const,
      profileId: ACTOR_ID,
      email: 'actor@example.com',
      session: null,
      cookieValue: 'rotated-cookie',
      cookieExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
      secretRotated: true,
      failureReason: null,
      kioskDeviceIdHint: null,
    };
    vi.mocked(validateAppSession).mockResolvedValue(
      rotated as Awaited<ReturnType<typeof validateAppSession>>
    );

    const success = await POST(request(validBody()));
    expect(success.status).toBe(200);
    expect(applyValidationCookieIfNeeded).toHaveBeenCalledWith(expect.anything(), rotated);

    const invalid = await POST(request({ ...validBody(), actorId: ACTOR_ID }));
    expect(invalid.status).toBe(400);
    expect(applyValidationCookieIfNeeded).toHaveBeenCalledTimes(2);
    expect(applyValidationCookieIfNeeded).toHaveBeenLastCalledWith(expect.anything(), rotated);
  });
});
