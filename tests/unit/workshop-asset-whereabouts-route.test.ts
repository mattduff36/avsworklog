import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';
import type { EffectiveRoleInfo } from '@/lib/utils/view-as';

const {
  validateAppSession,
  loadAssetWhereabouts,
  getEffectiveRole,
  getEffectiveRoleForUser,
  getPermissionLevelsForUser,
  applyValidationCookieIfNeeded,
  createClient,
} = vi.hoisted(() => ({
  validateAppSession: vi.fn(),
  loadAssetWhereabouts: vi.fn(),
  getEffectiveRole: vi.fn(),
  getEffectiveRoleForUser: vi.fn(),
  getPermissionLevelsForUser: vi.fn(),
  applyValidationCookieIfNeeded: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession,
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

vi.mock('@/lib/supabase/server', () => ({
  createClient,
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole,
  getEffectiveRoleForUser,
}));

vi.mock('@/lib/server/app-auth/response', () => ({
  applyValidationCookieIfNeeded,
}));

vi.mock('@/lib/server/team-permissions', () => ({
  getPermissionLevelsForUser,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { GET } from '@/app/api/workshop-tasks/assets/[assetType]/[assetId]/whereabouts/route';
import { GET as fleetsmartGet } from '@/app/api/fleetsmart/location/route';
import { GET as velocityGet } from '@/app/api/velocityfleet/location/route';

const ASSET_ID = '11111111-1111-4111-8111-111111111111';

function request() {
  return new NextRequest(`http://localhost/api/workshop-tasks/assets/plant/${ASSET_ID}/whereabouts`);
}

async function invoke(assetType = 'plant', assetId = ASSET_ID) {
  return GET(request(), { params: Promise.resolve({ assetType, assetId }) });
}

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

function viewingAsEmployee(): EffectiveRoleInfo {
  return {
    role_id: 'role-viewed',
    role_name: 'Plant Operator',
    display_name: 'Plant Operator',
    role_class: 'employee',
    is_manager_admin: false,
    is_super_admin: false,
    is_viewing_as: true,
    is_actual_super_admin: true,
    user_id: 'actor',
    team_id: 'team-viewed',
    team_name: 'Viewed team',
  };
}

describe('workshop asset whereabouts route proof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: 'supabase-fallback' } } })),
      },
    });
    getEffectiveRole.mockResolvedValue(viewingAsEmployee());
    getEffectiveRoleForUser.mockResolvedValue(viewingAsEmployee());
    getPermissionLevelsForUser.mockResolvedValue({
      'workshop-tasks': 0,
      'admin-vans': 0,
    });
  });

  it('WT-WHERE-401 returns 401 before privileged reads', async () => {
    validateAppSession.mockResolvedValue(sessionResult({ status: 'missing' }));
    const response = await invoke();
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(loadAssetWhereabouts).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(getPermissionLevelsForUser).not.toHaveBeenCalled();
  });

  it('WT-WHERE-403 returns 403 without workshop-tasks access', async () => {
    validateAppSession.mockResolvedValue(
      sessionResult({ status: 'active', profileId: 'actor', failureReason: null })
    );
    getPermissionLevelsForUser.mockResolvedValue({
      'workshop-tasks': 0,
      'admin-vans': 0,
    });
    const response = await invoke();
    expect(response.status).toBe(403);
    expect(loadAssetWhereabouts).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('WT-WHERE-VIEW-AS follows the effective-role workshop check', async () => {
    validateAppSession.mockResolvedValue(
      sessionResult({ status: 'active', profileId: 'actor', failureReason: null })
    );
    getEffectiveRole.mockResolvedValue(viewingAsEmployee());
    getEffectiveRoleForUser.mockResolvedValue(viewingAsEmployee());
    getPermissionLevelsForUser.mockResolvedValue({
      'workshop-tasks': 0,
      'admin-vans': 0,
    });
    const denied = await invoke();
    expect(denied.status).toBe(403);
    expect(getPermissionLevelsForUser).toHaveBeenCalledWith(
      'actor',
      'role-viewed',
      expect.anything(),
      'team-viewed',
      { includeUserOverrides: false }
    );

    getPermissionLevelsForUser.mockResolvedValue({
      'workshop-tasks': 2,
      'admin-vans': 0,
    });
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
    expect(createClient).not.toHaveBeenCalled();
    expect(loadAssetWhereabouts).toHaveBeenCalledWith(
      expect.objectContaining({ canOpenFleetHistory: false })
    );
    expect(getPermissionLevelsForUser).toHaveBeenLastCalledWith(
      'actor',
      'role-viewed',
      expect.anything(),
      'team-viewed',
      { includeUserOverrides: false }
    );

    getPermissionLevelsForUser.mockResolvedValue({
      'workshop-tasks': 2,
      'admin-vans': 3,
    });
    await invoke();
    expect(loadAssetWhereabouts).toHaveBeenLastCalledWith(
      expect.objectContaining({ canOpenFleetHistory: true })
    );
    expect(getEffectiveRoleForUser).toHaveBeenCalledWith('actor', null);
  });

  it('WL-AUTH-002 propagates a rotated session cookie on whereabouts and tracker responses', async () => {
    const rotated = sessionResult({
      status: 'active',
      profileId: 'actor',
      cookieValue: 'rotated-cookie',
      cookieExpiresAt: new Date('2026-09-04T15:00:00.000Z'),
      secretRotated: true,
      failureReason: null,
    });
    validateAppSession.mockResolvedValue(rotated);
    getPermissionLevelsForUser.mockResolvedValue({
      'workshop-tasks': 0,
      'admin-vans': 0,
      maintenance: 0,
    });

    const forbiddenWhereabouts = await invoke();
    const forbiddenFleet = await fleetsmartGet(
      new NextRequest('http://localhost/api/fleetsmart/location?plantId=331')
    );
    const forbiddenVan = await velocityGet(
      new NextRequest('http://localhost/api/velocityfleet/location?regNumber=AB12CDE')
    );
    expect(forbiddenWhereabouts.status).toBe(403);
    expect(forbiddenFleet.status).toBe(403);
    expect(forbiddenVan.status).toBe(403);

    getPermissionLevelsForUser.mockResolvedValue({
      'workshop-tasks': 2,
      'admin-vans': 0,
      maintenance: 0,
    });
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
    expect(applyValidationCookieIfNeeded).toHaveBeenCalledWith(expect.anything(), rotated);
    expect(applyValidationCookieIfNeeded.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('WT-WHERE-404 returns 404 for an unknown asset', async () => {
    validateAppSession.mockResolvedValue(
      sessionResult({ status: 'active', profileId: 'actor', failureReason: null })
    );
    getPermissionLevelsForUser.mockResolvedValue({
      'workshop-tasks': 2,
      'admin-vans': 0,
    });
    loadAssetWhereabouts.mockResolvedValue(null);
    const response = await invoke();
    expect(response.status).toBe(404);
  });
});
