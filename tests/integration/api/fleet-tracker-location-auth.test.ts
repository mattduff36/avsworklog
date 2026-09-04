import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';

const { requireSingleAssetTrackerAccess } = vi.hoisted(() => ({
  requireSingleAssetTrackerAccess: vi.fn(),
}));

vi.mock('@/lib/server/fleet-tracker-auth', () => ({
  requireSingleAssetTrackerAccess,
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

describe('single-asset tracker endpoint auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated and unauthorized callers with validation', async () => {
    const missing = sessionResult({ status: 'missing' });
    requireSingleAssetTrackerAccess.mockResolvedValue({
      ok: false,
      status: 401,
      validation: missing,
    });
    const unauthFleet = await fleetsmartGet(
      new NextRequest('http://localhost/api/fleetsmart/location?plantId=331')
    );
    const unauthVan = await velocityGet(
      new NextRequest('http://localhost/api/velocityfleet/location?regNumber=AB12CDE')
    );
    expect(unauthFleet.status).toBe(401);
    expect(unauthVan.status).toBe(401);

    const denied = sessionResult({
      status: 'active',
      profileId: 'viewer',
      failureReason: null,
    });
    requireSingleAssetTrackerAccess.mockResolvedValue({
      ok: false,
      status: 403,
      validation: denied,
    });
    const forbiddenFleet = await fleetsmartGet(
      new NextRequest('http://localhost/api/fleetsmart/location?plantId=331')
    );
    const forbiddenVan = await velocityGet(
      new NextRequest('http://localhost/api/velocityfleet/location?regNumber=AB12CDE')
    );
    expect(forbiddenFleet.status).toBe(403);
    expect(forbiddenVan.status).toBe(403);
  });
});
