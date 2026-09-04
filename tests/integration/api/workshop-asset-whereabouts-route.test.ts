import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';

const { requireWorkshopTasksAccess, loadAssetWhereabouts, canEffectiveRoleAccessModule } = vi.hoisted(
  () => ({
    requireWorkshopTasksAccess: vi.fn(),
    loadAssetWhereabouts: vi.fn(),
    canEffectiveRoleAccessModule: vi.fn(),
  })
);

vi.mock('@/lib/server/workshop-tasks/auth', () => ({
  requireWorkshopTasksAccess,
}));

vi.mock('@/lib/server/workshop-tasks/asset-whereabouts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/workshop-tasks/asset-whereabouts')>(
    '@/lib/server/workshop-tasks/asset-whereabouts'
  );
  return {
    ...actual,
    loadAssetWhereabouts,
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { GET } from '@/app/api/workshop-tasks/assets/[assetType]/[assetId]/whereabouts/route';

const ASSET_ID = '11111111-1111-4111-8111-111111111111';

function sessionResult(
  overrides: Partial<AppSessionValidationResult> = {}
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

function deniedAccess(status: 401 | 403, validation: AppSessionValidationResult) {
  return { ok: false as const, status, validation };
}

function allowedAccess(userId: string, validation: AppSessionValidationResult) {
  return { ok: true as const, userId, validation };
}

function request() {
  return new NextRequest(`http://localhost/api/workshop-tasks/assets/plant/${ASSET_ID}/whereabouts`);
}

async function invoke(assetType = 'plant', assetId = ASSET_ID) {
  return GET(request(), { params: Promise.resolve({ assetType, assetId }) });
}

describe('workshop asset whereabouts route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canEffectiveRoleAccessModule.mockResolvedValue(false);
  });

  it('returns 401 with the real access.validation cookie contract', async () => {
    const validation = sessionResult({ status: 'missing' });
    requireWorkshopTasksAccess.mockResolvedValue(deniedAccess(401, validation));
    const response = await invoke();
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(loadAssetWhereabouts).not.toHaveBeenCalled();
  });

  it('returns 403 with the real access.validation cookie contract', async () => {
    const validation = sessionResult({
      status: 'active',
      profileId: 'viewer',
      failureReason: null,
    });
    requireWorkshopTasksAccess.mockResolvedValue(deniedAccess(403, validation));
    const response = await invoke();
    expect(response.status).toBe(403);
    expect(loadAssetWhereabouts).not.toHaveBeenCalled();
  });

  it('follows the effective-role workshop check', async () => {
    const deniedValidation = sessionResult({
      status: 'active',
      profileId: 'viewer',
      failureReason: null,
    });
    requireWorkshopTasksAccess.mockResolvedValue(deniedAccess(403, deniedValidation));
    const denied = await invoke();
    expect(denied.status).toBe(403);

    const allowedValidation = sessionResult({
      status: 'active',
      profileId: 'viewer',
      email: 'viewer@example.com',
      failureReason: null,
    });
    requireWorkshopTasksAccess.mockResolvedValue(allowedAccess('viewer', allowedValidation));
    loadAssetWhereabouts.mockResolvedValue({
      asset: { id: ASSET_ID, type: 'plant', label: '331', plantId: '331', regNumber: null },
      lastCheckAt: null,
      lastDriverName: null,
      lastDriverPhone: null,
      meter: null,
      fleetHistoryHref: `/fleet/plant/${ASSET_ID}/history`,
      canOpenFleetHistory: false,
      events: [],
    });
    const allowed = await invoke();
    expect(allowed.status).toBe(200);
    expect(requireWorkshopTasksAccess).toHaveBeenCalled();
  });

  it('returns 404 for an unknown asset', async () => {
    const validation = sessionResult({
      status: 'active',
      profileId: 'user-1',
      failureReason: null,
    });
    requireWorkshopTasksAccess.mockResolvedValue(allowedAccess('user-1', validation));
    loadAssetWhereabouts.mockResolvedValue(null);
    const response = await invoke();
    expect(response.status).toBe(404);
  });
});
