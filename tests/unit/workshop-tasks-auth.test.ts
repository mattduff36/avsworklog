import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';

const { validateAppSession, canEffectiveRoleAccessModule, createClient } = vi.hoisted(() => ({
  validateAppSession: vi.fn(),
  canEffectiveRoleAccessModule: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule,
}));

import { requireWorkshopTasksAccess } from '@/lib/server/workshop-tasks/auth';
import { requireSingleAssetTrackerAccess } from '@/lib/server/fleet-tracker-auth';

function sessionResult(
  overrides: Partial<AppSessionValidationResult>
): AppSessionValidationResult {
  return {
    status: 'missing',
    session: null,
    profileId: null,
    email: null,
    cookieValue: null,
    cookieExpiresAt: null,
    secretRotated: false,
    failureReason: 'missing_cookie',
    kioskDeviceIdHint: null,
    ...overrides,
  };
}

describe('workshop and tracker access helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: 'supabase-fallback' } } })),
      },
    });
  });

  it('FD-WHERE-AUTH-001 returns 401 from a missing or invalid app session without getUser', async () => {
    const missing = sessionResult({ status: 'missing' });
    validateAppSession.mockResolvedValue(missing);
    await expect(requireWorkshopTasksAccess()).resolves.toEqual({
      ok: false,
      status: 401,
      validation: missing,
    });
    await expect(requireSingleAssetTrackerAccess()).resolves.toEqual({
      ok: false,
      status: 401,
      validation: missing,
    });

    const invalid = sessionResult({ status: 'invalid', failureReason: 'session_expired' });
    validateAppSession.mockResolvedValue(invalid);
    await expect(requireWorkshopTasksAccess()).resolves.toEqual({
      ok: false,
      status: 401,
      validation: invalid,
    });
    await expect(requireSingleAssetTrackerAccess()).resolves.toEqual({
      ok: false,
      status: 401,
      validation: invalid,
    });

    expect(createClient).not.toHaveBeenCalled();
    expect(canEffectiveRoleAccessModule).not.toHaveBeenCalled();
  });

  it('WL-AUTH-001 validates the app session once and reuses that actor for permissions', async () => {
    const rotated = sessionResult({
      status: 'active',
      profileId: 'actor',
      email: 'actor@example.com',
      cookieValue: 'rotated-cookie',
      cookieExpiresAt: new Date('2026-09-04T15:00:00.000Z'),
      secretRotated: true,
      failureReason: null,
    });
    validateAppSession.mockResolvedValue(rotated);
    canEffectiveRoleAccessModule.mockResolvedValue(true);

    await expect(requireWorkshopTasksAccess()).resolves.toEqual({
      ok: true,
      userId: 'actor',
      validation: rotated,
    });
    expect(validateAppSession).toHaveBeenCalledTimes(1);
    expect(canEffectiveRoleAccessModule).toHaveBeenCalledWith('workshop-tasks', {
      userId: 'actor',
      email: 'actor@example.com',
    });

    validateAppSession.mockClear();
    canEffectiveRoleAccessModule.mockClear();
    validateAppSession.mockResolvedValue(rotated);
    canEffectiveRoleAccessModule.mockResolvedValue(true);
    await expect(requireSingleAssetTrackerAccess()).resolves.toEqual({
      ok: true,
      validation: rotated,
    });
    expect(validateAppSession).toHaveBeenCalledTimes(1);
    expect(canEffectiveRoleAccessModule).toHaveBeenCalledWith('workshop-tasks', {
      userId: 'actor',
      email: 'actor@example.com',
    });
    expect(canEffectiveRoleAccessModule).not.toHaveBeenCalledWith('workshop-tasks');
  });

  it('denies workshop access when the effective role lacks workshop-tasks', async () => {
    const active = sessionResult({ status: 'active', profileId: 'actor', failureReason: null });
    validateAppSession.mockResolvedValue(active);
    canEffectiveRoleAccessModule.mockResolvedValue(false);
    await expect(requireWorkshopTasksAccess()).resolves.toEqual({
      ok: false,
      status: 403,
      validation: active,
    });
    expect(canEffectiveRoleAccessModule).toHaveBeenCalledWith('workshop-tasks', {
      userId: 'actor',
      email: null,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('requires an effective workshop, fleet, or maintenance grant for tracker access', async () => {
    const active = sessionResult({ status: 'active', profileId: 'actor', failureReason: null });
    validateAppSession.mockResolvedValue(active);
    canEffectiveRoleAccessModule.mockResolvedValue(false);
    await expect(requireSingleAssetTrackerAccess()).resolves.toEqual({
      ok: false,
      status: 403,
      validation: active,
    });

    canEffectiveRoleAccessModule.mockImplementation(
      async (moduleName: string) => moduleName === 'workshop-tasks'
    );
    await expect(requireSingleAssetTrackerAccess()).resolves.toEqual({
      ok: true,
      validation: active,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 401 without an app session', async () => {
    const missing = sessionResult({ status: 'missing' });
    validateAppSession.mockResolvedValue(missing);
    await expect(requireWorkshopTasksAccess()).resolves.toEqual({
      ok: false,
      status: 401,
      validation: missing,
    });
    await expect(requireSingleAssetTrackerAccess()).resolves.toEqual({
      ok: false,
      status: 401,
      validation: missing,
    });
    expect(canEffectiveRoleAccessModule).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});
