import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';

const {
  validateAppSession,
  canEffectiveRoleAccessModule,
  applyValidationCookieIfNeeded,
  createClient,
} = vi.hoisted(() => ({
  validateAppSession: vi.fn(),
  canEffectiveRoleAccessModule: vi.fn(),
  applyValidationCookieIfNeeded: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule,
}));

vi.mock('@/lib/server/app-auth/response', () => ({
  applyValidationCookieIfNeeded,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient,
}));

vi.mock('@/lib/server/fleet-tracker-enrichment', () => ({
  enrichTrackerLocationWithVanNickname: vi.fn(async (value) => value),
}));

vi.mock('@/lib/services/velocityfleet', () => ({
  getVelocityfleetLocationByRegistration: vi.fn(),
  isVelocityfleetError: () => false,
}));

import { GET as fleetsmartGet } from '@/app/api/fleetsmart/location/route';
import { GET as velocityGet } from '@/app/api/velocityfleet/location/route';

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

describe('single-asset tracker endpoint auth proof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: 'supabase-fallback' } } })),
      },
    });
  });

  it('WT-WHERE-TRACKER-AUTH rejects unauthenticated and unauthorized callers', async () => {
    validateAppSession.mockResolvedValue(sessionResult({ status: 'missing' }));
    const unauthFleet = await fleetsmartGet(
      new NextRequest('http://localhost/api/fleetsmart/location?plantId=331')
    );
    const unauthVan = await velocityGet(
      new NextRequest('http://localhost/api/velocityfleet/location?regNumber=AB12CDE')
    );
    expect(unauthFleet.status).toBe(401);
    expect(unauthVan.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
    expect(canEffectiveRoleAccessModule).not.toHaveBeenCalled();

    validateAppSession.mockResolvedValue(
      sessionResult({ status: 'active', profileId: 'actor', failureReason: null })
    );
    canEffectiveRoleAccessModule.mockResolvedValue(false);
    const forbiddenFleet = await fleetsmartGet(
      new NextRequest('http://localhost/api/fleetsmart/location?plantId=331')
    );
    const forbiddenVan = await velocityGet(
      new NextRequest('http://localhost/api/velocityfleet/location?regNumber=AB12CDE')
    );
    expect(forbiddenFleet.status).toBe(403);
    expect(forbiddenVan.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });
});
